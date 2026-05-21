# 镜像升级 Runbook

Manifold 用 `image@sha256:...` 钉死所有上游镜像，所以**升级 = 改 digest**。每条都按这个结构：

- **影响范围**：要重启什么 / 多久中断
- **准备**：上手前要确认的
- **步骤**：逐条命令
- **验证**：怎么知道成了
- **回滚**：失败怎么倒车

> 任何升级**都先在 staging 跑一遍**：复制一份目录 / 不同 compose project 名 `docker compose -p manifold-staging ...`，绿了再到 prod。

---

## 通用方法论

### 怎么拿到一个 tag 的当前 digest

```bash
# 多架构镜像（绝大多数官方镜像都是）
docker manifest inspect postgres:17-alpine | jq -r '.manifests[] | select(.platform.architecture=="amd64" and .platform.os=="linux") | .digest'

# 单架构镜像
docker pull weishaw/sub2api:0.1.130
docker inspect --format='{{index .RepoDigests 0}}' weishaw/sub2api:0.1.130
```

把拿到的 `sha256:...` 字符串填进 compose.yml 对应行，比如：

```yaml
image: weishaw/sub2api@sha256:97fe7910d109de7b663497413f875ba5ba56b1cbdef4c0561d44810a7447600f
```

并把行上面注释里的 tag 和 `(pulled YYYY-MM-DD)` 一起更新。

### 通用回滚

每次升级前先 `git diff deploy/docker-compose.yml | cat > /tmp/upgrade-rollback.patch`，回滚时 `cd deploy && git checkout docker-compose.yml`，然后 `docker compose up -d --force-recreate <service>`。

---

## 索引

- [sub2api 升级](#sub2api-升级)
- [CPA (cli-proxy-api) 升级](#cpa-cli-proxy-api-升级)
- [Caddy 升级](#caddy-升级)
- [Uptime Kuma 升级](#uptime-kuma-升级)
- [Redis minor 升级](#redis-minor-升级)
- [Postgres minor 升级](#postgres-minor-升级)
- [Postgres major 升级（危险）](#postgres-major-升级危险)

---

## sub2api 升级

**影响范围**：sub2api 容器重启，约 10-30s 服务中断（caddy 反代会 502）。数据库 schema 可能变。

**准备**：
- 备份已就位（`scripts/backup.sh` 跑一次，确认产出文件）
- 读 sub2api 的 release notes —— 看是否有 breaking change / 强制 migration
- 拿到新版 digest（用上面"通用方法论"）

**步骤**：

```bash
# 1) 改 compose.yml 里 sub2api 那行的 digest
$EDITOR deploy/docker-compose.yml

# 2) 拉新镜像（这一步可能要等几分钟）
cd deploy && docker compose pull sub2api

# 3) 切过去；--force-recreate 保证用新 image
docker compose up -d --force-recreate sub2api

# 4) 看 migration 日志
docker logs manifold-sub2api --tail 100 -f
# 直到出现 "server started" 或类似消息，Ctrl+C 退出
```

**验证**：

```bash
# health
curl -fsS http://127.0.0.1:8080/health     # 或 https://域名/health

# admin login 能拉 token
curl -fsS -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"'$ADMIN_EMAIL'","password":"'$ADMIN_PASSWORD'"}'

# 用一个真实的 user key 跑一次推理，确认上游链路通
curl -fsS http://127.0.0.1:8080/v1/messages \
  -H "Authorization: Bearer $USER_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-5-20250929","max_tokens":50,"messages":[{"role":"user","content":"ping"}]}'
```

**回滚**：

```bash
# git 改回去最快
cd deploy && git checkout docker-compose.yml
docker compose up -d --force-recreate sub2api

# 如果 migration 已经把 schema 改了 → 旧镜像可能跑不起来
# 这时必须从 scripts/backup.sh 备份恢复，参考 docs/backup-restore.md "场景 B"
```

⚠️ migration 不可逆。如果新版做了破坏性 schema 改，回滚必须走备份恢复路径。

---

## CPA (cli-proxy-api) 升级

**影响范围**：单个 CPA 实例重启。sub2api 该实例对应账号短暂 5xx，但其它 CPA 继续工作（负载均衡分散）。

**准备**：
- 至少 2 个 CPA 实例都健康 —— 不然单点没有 fallback
- 拿到新版 digest

**步骤**：

```bash
# 一次升一个，不要批量
$EDITOR deploy/docker-compose.yml   # 改 cpa-1 那行的 digest
cd deploy && docker compose pull cpa-1
docker compose up -d --force-recreate cpa-1

# 等 5 分钟，确认 cpa-1 上游账号在 sub2api 后台没 5xx 飙升，再升 cpa-2
docker compose up -d --force-recreate cpa-2
```

**验证**：

```bash
# 容器健康
docker ps --filter "name=manifold-cpa-" --format "table {{.Names}}\t{{.Status}}"

# CPA 直接探针（带内网共享秘钥）
SECRET=$(grep -oE '"[0-9a-f]{32,}"' deploy/cpa-1/config.yaml | head -1 | tr -d '"')
docker run --rm --network manifold-upstream curlimages/curl:8 \
  -fsS -H "Authorization: Bearer $SECRET" \
  http://cpa-1:8317/v1/models | head -5
```

**回滚**：和 sub2api 同款 git checkout + force-recreate，但 OAuth token 卷不动，回去就还能用。

⚠️ 升级前**不要**删 `deploy/cpa-*/auths/`，token 丢了要重登 OAuth，**有封号风险**。

---

## Caddy 升级

**影响范围**：caddy 重启，公网 80/443 中断 5-10s。证书数据持久化在 `data/caddy/data/`，不丢。

**准备**：
- 读 Caddy release notes —— Caddyfile 语法偶尔有不兼容改动
- 拿到新版 digest

**步骤**：

```bash
$EDITOR deploy/docker-compose.yml   # 改 caddy 行 digest

# 升级前先用新镜像 validate 一次现 Caddyfile
docker run --rm \
  -v $(pwd)/deploy/Caddyfile:/etc/caddy/Caddyfile:ro \
  -e DOMAIN=${DOMAIN} -e ACME_EMAIL=${ACME_EMAIL} \
  caddy@sha256:<新digest> \
  caddy validate --config /etc/caddy/Caddyfile

# validate 通过再切
cd deploy && docker compose pull caddy
docker compose up -d --force-recreate caddy
```

**验证**：

```bash
# 外网入口正常
curl -fsS https://${DOMAIN}/health
# 证书有效（DOMAIN 模式）
echo | openssl s_client -servername ${DOMAIN} -connect ${DOMAIN}:443 2>/dev/null | openssl x509 -noout -dates
```

**回滚**：git checkout + force-recreate。证书数据在 volume 里，不影响。

---

## Uptime Kuma 升级

**影响范围**：监控面板短暂不可用（约 30s）。**监控数据库 (`data/uptime-kuma/kuma.db`) 升级时会自动 migration**，跨大版本时偶尔不可逆。

**准备**：
- **手动备一份 kuma.db**：
  ```bash
  docker exec manifold-kuma sqlite3 /app/data/kuma.db ".backup /app/data/kuma.db.bak-$(date +%Y%m%d)"
  ```
- 读 release notes 看有没有 DB schema 变化

**步骤**：

```bash
$EDITOR deploy/docker-compose.yml   # 改 kuma 行 digest
cd deploy && docker compose pull kuma
docker compose up -d --force-recreate kuma
```

**验证**：SSH 隧道开起来，浏览器进 `http://127.0.0.1:3001`，确认监控历史 / 通知配置都在。

**回滚**：

```bash
git checkout deploy/docker-compose.yml
docker compose stop kuma
# 如果 schema 已经被新版升级了，旧版起不来 —— 恢复 kuma.db
cp deploy/data/uptime-kuma/kuma.db.bak-YYYYMMDD deploy/data/uptime-kuma/kuma.db
docker compose up -d kuma
```

---

## Redis minor 升级

（如 8.0 → 8.1，不跨 major）

**影响范围**：redis 重启 → sub2api 重启（强制重连）。约 10s。会话 / 限流计数清零。

**准备**：备份不必（redis 状态可重建）。但确认 sub2api 不在跑关键请求。

**步骤**：

```bash
$EDITOR deploy/docker-compose.yml   # redis 行 digest
cd deploy && docker compose pull redis
docker compose up -d --force-recreate redis sub2api
```

**验证**：

```bash
docker exec manifold-redis redis-cli ping       # PONG
docker logs manifold-sub2api --tail 20 | grep -i redis
```

**回滚**：git checkout + force-recreate。AOF 文件 (`data/redis/appendonlydir/`) 跨小版本通常兼容；跨 major 不一定。

---

## Postgres minor 升级

（如 17.10 → 17.11，**绝不跨 major**）

**影响范围**：postgres 重启 → sub2api 短暂连不上 → 重连。约 15-30s。

**准备**：
- **必须**先备份：`./scripts/backup.sh`
- 确认是 minor 升级。看 image tag，`17.10-alpine` → `17.11-alpine` 是 minor；`17` → `18` 是 major（走下一节）

**步骤**：

```bash
$EDITOR deploy/docker-compose.yml   # postgres 行 digest
cd deploy && docker compose pull postgres
docker compose up -d --force-recreate postgres

# 等 healthy
docker inspect -f '{{.State.Health.Status}}' manifold-postgres
# 然后 sub2api 通常会自动重连，但安全起见也走一次
docker compose up -d --force-recreate sub2api
```

**验证**：

```bash
docker exec manifold-postgres pg_isready -U sub2api -d sub2api
curl -fsS http://127.0.0.1:8080/health
```

**回滚**：git checkout + force-recreate。**data 卷向后兼容 minor 版本**，可以安全降级。

---

## Postgres major 升级（危险）

（如 17 → 18）

**影响范围**：要倒数据，**预留至少 30 分钟维护窗口**。期间全服不可用。

**准备**：
- 维护通告（提前 24h）
- 备份就位（`./scripts/backup.sh` 最近 24h 内的，并确认能解密）
- 在 staging 走过完整流程
- 准备好两个版本的 digest（旧、新）

**步骤**：

```bash
# 1) 导旧库
docker exec manifold-postgres pg_dumpall -U sub2api > /tmp/manifold-pgdumpall.sql

# 2) 停整套
cd deploy && docker compose down

# 3) 备份 data 目录（最后保险）
mv data/postgres data/postgres.bak-17

# 4) 改 compose.yml 把 postgres digest 改成新 major 版的
$EDITOR docker-compose.yml

# 5) 起新版 postgres
docker compose up -d postgres
docker inspect -f '{{.State.Health.Status}}' manifold-postgres   # 等 healthy

# 6) 灌数据
cat /tmp/manifold-pgdumpall.sql | docker exec -i manifold-postgres psql -U sub2api

# 7) 起完整栈
docker compose up -d
```

**验证**：

```bash
curl -fsS http://127.0.0.1:8080/health

# sub2api 后台登录 + 查用户列表 + 查 key 列表，确认数据完整
# 用一个 user key 跑真实推理
```

**回滚**（在第 6 步前任何时间）：

```bash
docker compose down
mv data/postgres data/postgres.bak-failed-18
mv data/postgres.bak-17 data/postgres
git checkout docker-compose.yml
docker compose up -d
```

**回滚**（已经灌完数据发现新版有问题）：直接走 `scripts/restore.sh` 从异地备份恢复，老 data 卷已经保留在 `data/postgres.bak-17/`。

⚠️ pg_dumpall 包含全局对象（角色、表空间），是跨 major 唯一推荐路径。**别**直接复制 data 目录跨 major，文件格式不兼容会数据损坏。
