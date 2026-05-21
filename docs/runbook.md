# 运维 Runbook

可执行步骤手册。出问题不要现想，按这里来。

每个流程都按这个结构：

- **影响范围**：改完哪些组件会重启 / 哪些用户会被影响
- **准备**：动手前确认的前置
- **步骤**：逐条命令
- **验证**：怎么知道成功了
- **回滚**：失败 / 改坏了怎么倒车

> 任何"不停服"流程都先在 staging 跑一次，再到 prod。

---

## 索引

- [POSTGRES_PASSWORD 轮换](#postgres_password-轮换)
- [REDIS_PASSWORD 轮换](#redis_password-轮换)
- [JWT_SECRET 轮换](#jwt_secret-轮换)
- [TOTP_ENCRYPTION_KEY ⚠ 不可轮换](#totp_encryption_key--不可轮换)
- [ADMIN_PASSWORD 重置](#admin_password-重置)
- [CPA 内网共享秘钥轮换](#cpa-内网共享秘钥轮换)
- [GPG 备份密钥轮换](#gpg-备份密钥轮换)
- [ACME_EMAIL / DOMAIN 改动](#acme_email--domain-改动)
- [整套 compose 升级](#整套-compose-升级)

---

## POSTGRES_PASSWORD 轮换

**影响范围**：sub2api 短暂连不上 postgres，需要重启。约 5-15s 服务中断。

**准备**：
- 备份已就位（`scripts/backup.sh --no-upload` 跑一次）
- 选低峰时段
- 新密码：`openssl rand -hex 24`

**步骤**：

```bash
# 1) 在 postgres 里改密码（即时生效，旧密码立刻失效）
NEW_PASS=$(openssl rand -hex 24)
docker exec -i manifold-postgres psql -U sub2api -d sub2api \
  -c "ALTER USER sub2api WITH PASSWORD '$NEW_PASS';"

# 2) 改 .env
sed -i.bak "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$NEW_PASS|" deploy/.env
rm -f deploy/.env.bak

# 3) sub2api 拿新密码起来；postgres 不动，因为容器内的 stored 已经是新的
cd deploy && docker compose up -d --force-recreate sub2api
```

**验证**：

```bash
# 拿到 sub2api 的 health 200
curl -fsS http://127.0.0.1:8080/health  # 或 https://你的域名/health
# 容器日志没有 "password authentication failed"
docker logs manifold-sub2api --tail 50 2>&1 | grep -i "password\|auth" || echo "clean"
```

**回滚**：

```bash
# 如果 sub2api 起不来，把 postgres 密码改回老的
docker exec -i manifold-postgres psql -U sub2api -d sub2api \
  -c "ALTER USER sub2api WITH PASSWORD '$OLD_PASS';"
# 把 .env 也改回去，再重启 sub2api
```

⚠️ ALTER USER 是**即时**的，没改 .env 之前 sub2api 拿旧密码已经连不上 postgres 了。所以步骤 1 和 3 之间窗口越短越好，可以预写一个脚本一次跑完。

---

## REDIS_PASSWORD 轮换

**影响范围**：redis 重启 + sub2api 重启。约 10s。

**准备**：
- 新密码：`openssl rand -hex 24`

**步骤**：

```bash
NEW_PASS=$(openssl rand -hex 24)
sed -i.bak "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$NEW_PASS|" deploy/.env
rm -f deploy/.env.bak

cd deploy && docker compose up -d --force-recreate redis sub2api
```

**验证**：

```bash
docker exec manifold-redis redis-cli -a "$NEW_PASS" ping
# 应该回 PONG。如果回 NOAUTH = 密码不对
```

**回滚**：把 .env 改回旧值，再 `docker compose up -d --force-recreate redis sub2api`。

---

## JWT_SECRET 轮换

**影响范围**：**所有当前登录的用户被踢下线**，必须重新登录。2FA 仍然有效。

**准备**：
- 选最低峰时段（凌晨）
- 通知用户，或者放个临时公告

**步骤**：

```bash
NEW_SECRET=$(openssl rand -hex 32)
sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$NEW_SECRET|" deploy/.env
rm -f deploy/.env.bak

cd deploy && docker compose up -d --force-recreate sub2api
```

**验证**：

```bash
# 老 token 应该返回 401
curl -fsS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer <某个老 access_token>" \
  http://127.0.0.1:8080/api/v1/users/me
# 期望: 401

# 新登录拿到 token，正常工作
curl -fsS http://127.0.0.1:8080/api/v1/auth/login \
  -d '{"email":"admin@...","password":"..."}' -H 'Content-Type: application/json'
# 期望: 拿到 access_token，并能正常调 /me
```

**回滚**：JWT_SECRET 改回旧值，再 `docker compose up -d --force-recreate sub2api`。之前签的 token 又重新有效。

---

## TOTP_ENCRYPTION_KEY ⚠ 不可轮换

**结论：这把 key 一旦投产就不能换。**

**原因**：所有用户的 TOTP secret 在 DB 里都是用这个 key 加密存的。换 key 之后 sub2api 解不出来，所有人 2FA 永远失败 —— 连关掉 2FA 都需要先通过 2FA。

**如果泄露了，唯一的"恢复"动作（极度破坏性）**：

1. 通知所有用户：2FA 即将重置，要求他们登录后重绑
2. 用 admin 权限批量清掉所有用户的 2FA 状态（DB 直接 UPDATE）：

   ```sql
   -- 进 postgres
   docker exec -it manifold-postgres psql -U sub2api -d sub2api
   -- 在 sub2api 里把所有用户的 totp_secret / totp_enabled 清掉（确认表名后再跑）
   UPDATE users SET totp_secret = NULL, totp_enabled = false;
   ```
3. 改 .env 里的 TOTP_ENCRYPTION_KEY 为新值
4. `docker compose up -d --force-recreate sub2api`
5. 所有用户登录时被引导重新绑定 2FA

**这是核弹按钮，按之前确认你真的需要按**。如果只是怀疑泄露，先看审计日志判断；如果只是 .env 泄露但没人用过、还在你掌控里，**不要轻易做这步**。

---

## ADMIN_PASSWORD 重置

**前提**：`.env` 里的 ADMIN_PASSWORD 只在 sub2api 首次启动建 admin 账号时用。之后改密码走两条路：

### 路径 A：admin 自己改（推荐）

```
sub2api 后台 → 用户管理 → 找到自己 → 改密
```

### 路径 B：admin 密码忘了

由于密码哈希在 DB，直接 SQL 改：

```bash
# 1) 在本机生成新密码的 bcrypt hash
NEW_PASS=$(openssl rand -hex 12)
HASH=$(docker run --rm python:3-alpine sh -c \
  "pip install bcrypt -q && python -c \"import bcrypt; print(bcrypt.hashpw(b'$NEW_PASS', bcrypt.gensalt()).decode())\"")
echo "new password: $NEW_PASS"
echo "new hash:     $HASH"

# 2) UPDATE 进 DB（确认列名后再跑，不同 sub2api 版本可能不一样）
docker exec -i manifold-postgres psql -U sub2api -d sub2api <<SQL
UPDATE users SET password_hash = '$HASH' WHERE email = 'admin@manifold.local';
SQL

# 3) 用新密码登录验证
curl -fsS http://127.0.0.1:8080/api/v1/auth/login \
  -d "{\"email\":\"admin@manifold.local\",\"password\":\"$NEW_PASS\"}" \
  -H 'Content-Type: application/json'
```

**注意**：如果 admin 启用了 2FA，路径 B 改完密码还要过 2FA 才能登录。如果连 2FA 也丢了：

```sql
UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE email = 'admin@manifold.local';
```

只清 admin 一个人的 2FA，不影响别人。

---

## CPA 内网共享秘钥轮换

**影响范围**：在过渡窗口期内 sub2api 调对应 CPA 会失败一次 → 自动重试一次 → 成功（如果配了重试）。或者直接 5xx 短暂上升。

**步骤**（以 cpa-1 为例，零中断版）：

```bash
# 1) 生成新秘钥
NEW_SECRET=$(openssl rand -hex 32)

# 2) 编辑 deploy/cpa-1/config.yaml，把 api-keys 改成两条（新旧并存）
#    api-keys:
#      - "OLD_SECRET..."
#      - "NEW_SECRET..."
# CPA 接受 api-keys 列表里**任一**值，所以这一步过渡 sub2api 还能用旧 key 调通

# 3) 重启 cpa-1 让它加载新 config
docker compose restart cpa-1

# 4) 在 sub2api 后台改对应上游账号（设置 → 账号 → cpa-1-* → API Key）填新值
#    或者通过 admin API：
ACCESS=$(curl -s http://127.0.0.1:8080/api/v1/auth/login \
  -d '{"email":"...","password":"..."}' -H 'Content-Type: application/json' \
  | jq -r .data.access_token)
ACC_ID=$(curl -s -H "Authorization: Bearer $ACCESS" \
  "http://127.0.0.1:8080/api/v1/admin/accounts?page_size=100" \
  | jq -r '.data.items[] | select(.name=="cpa-1-anthropic") | .id')
curl -X PUT -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  "http://127.0.0.1:8080/api/v1/admin/accounts/$ACC_ID" \
  -d "{\"credentials\":{\"api_key\":\"$NEW_SECRET\",\"base_url\":\"http://cpa-1:8317\"}}"

# 5) 把旧 key 从 cpa-1/config.yaml 删掉，再 restart cpa-1
docker compose restart cpa-1
```

**验证**：

```bash
# 用任意 user key 实际调一次
curl -fsS http://127.0.0.1:8080/v1/messages \
  -H "Authorization: Bearer <user_key>" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-4-5-20250929","max_tokens":50,"messages":[{"role":"user","content":"ping"}]}'
```

**回滚**：cpa-1/config.yaml 改回单条旧 key，sub2api 后台账号也改回旧 key，重启 cpa-1。

---

## GPG 备份密钥轮换

**触发场景**：
- 私钥怀疑泄露
- 持有人离职
- 定期轮换（5 年默认有效期到了）

**重要**：这不是"删旧用新"，而是"今天起新备份用新 key"。**旧备份用旧 key 解的事实不变** —— 旧私钥要永远保留（哪怕只放离线 U 盘）。

**步骤**：

```bash
# 1) 生成新一对 key（在安全机器上，最好不是 prod 服务器）
gpg --batch --pinentry-mode loopback --passphrase '' \
    --quick-generate-key "manifold-backup-2026@yourdomain.com" rsa4096 default 5y
gpg --list-keys
NEW_FP=<刚生成的 fingerprint>
gpg --batch --pinentry-mode loopback --passphrase '' \
    --quick-add-key $NEW_FP rsa4096 encr 5y

# 2) 导出新私钥 + 公钥
gpg --export-secret-keys --armor $NEW_FP > manifold-backup-2026-private.asc  # 离线收好
gpg --export --armor $NEW_FP > manifold-backup-2026-public.asc

# 3) 服务器上 import 新公钥
scp manifold-backup-2026-public.asc vps:/tmp/
ssh vps "gpg --import /tmp/manifold-backup-2026-public.asc && rm /tmp/manifold-backup-2026-public.asc"

# 4) 改 deploy/.env 的 GPG_RECIPIENT 为新邮箱
sed -i.bak "s|^GPG_RECIPIENT=.*|GPG_RECIPIENT=manifold-backup-2026@yourdomain.com|" deploy/.env

# 5) 跑一次备份验证
./scripts/backup.sh --no-upload

# 6) 在另一台机器导入新私钥，用 restore.sh 解密验证
gpg --import manifold-backup-2026-private.asc
./scripts/restore.sh --force --yes /path/to/new-backup.tar.gz.gpg  # 在隔离环境跑
```

**保留旧私钥**：拷贝到至少两个独立离线介质（U 盘 + 密码管理器）。**永远不删**，否则旧加密备份全废。

---

## ACME_EMAIL / DOMAIN 改动

**ACME_EMAIL 改动**（影响：以后 Let's Encrypt 通知发到新邮箱）

```bash
sed -i.bak "s|^ACME_EMAIL=.*|ACME_EMAIL=new@example.com|" deploy/.env
docker compose up -d --force-recreate caddy   # caddy 重启拉新 env
```

**DOMAIN 改动 / 上线第一次设 DOMAIN**：

```bash
# 1) 先把域名 A 记录指到服务器 IP，DNS 生效（dig +short manifold.com 看到你的 IP）
# 2) 改 .env
sed -i.bak "s|^DOMAIN=.*|DOMAIN=manifold.example.com|" deploy/.env
# 3) 重启 caddy
docker compose up -d --force-recreate caddy
# 4) 看证书签发日志
docker logs manifold-caddy --tail 100 2>&1 | grep -i "certificate\|obtain\|tls"
```

**验证**：

```bash
curl -fsS https://manifold.example.com/health
# 200 + cert issuer = Let's Encrypt
echo | openssl s_client -connect manifold.example.com:443 -servername manifold.example.com 2>/dev/null \
  | openssl x509 -noout -issuer
```

**回滚**：DOMAIN 清空，caddy 重启，退回 HTTP-only `:80` 模式。证书数据保留在 `data/caddy/data`，下次再改回 DOMAIN 立刻能用，不重新签。

---

## 整套 compose 升级

升级 sub2api / CPA / postgres / redis / caddy / kuma 任一镜像版本。

**通用流程**：

```bash
# 1) 先 staging 验证
#    把 deploy/docker-compose.yml 里某个 image 行的 digest 改成新版本
#    复制整个 deploy/ 到 staging 路径，跑 docker compose up -d
#    业务测试 OK 再走下一步

# 2) prod 备份（即使是无状态服务，也要保留回滚点）
./scripts/backup.sh

# 3) prod 改 digest（一个一个改，别一次全升级）
vim deploy/docker-compose.yml

# 4) 拉镜像（不重启）
cd deploy && docker compose pull <service>

# 5) 重建该服务
docker compose up -d --force-recreate <service>

# 6) 看日志 + 探针
docker logs manifold-<service> --tail 100
# 在 Uptime Kuma 看探针 30 秒之内继续绿
```

**postgres 升级（major version 跳跃）特别注意**：postgres major 版本升级（17 → 18）**不能**只换 image 然后重启 —— data 目录格式不兼容。必须走 `pg_dump → 升级 → pg_restore` 流程。这种属于一次性活动，参考 [docs/backup-restore.md](backup-restore.md)。

**回滚**：把 digest 改回老的，`docker compose up -d --force-recreate <service>`。
