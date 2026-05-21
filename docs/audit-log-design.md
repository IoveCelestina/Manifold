# 审计日志技术设计

> 仅设计文档。代码实现留到服务器上去后开做。

## 1. 设计目标

| 目标 | 说明 |
|---|---|
| **客户纠纷可追溯** | 任意"是不是我扣错钱了 / 我没创建过这个 key / 我没改过密码"问题，都能拉出完整时间线 |
| **合规可审计** | 隐私政策第 5 节承诺审计日志保留 12 个月，必须真存得下 |
| **不污染主库** | sub2api 主库挂了，审计日志不能跟着没；反之亦然 |
| **不改 sub2api 源码** | LGPL 红线，原则不变 |
| **零运行时风险** | 审计写失败**不能**让业务请求失败 |

## 2. 存储方案选型

考虑过的方案：

| 方案 | 优 | 劣 | 评分 |
|---|---|---|---|
| A. 独立 Postgres 数据库 | SQL 查询友好，索引强 | 多养一个 PG，备份/恢复多一份；运行时多一个故障源 | ❌ 早期过重 |
| B. sub2api 主库加表 | 简单 | 违反"独立"要求 | ❌ |
| C. **JSONL 文件，daily rotation** | 极简，append-only 不锁，原生 grep/jq，备份顺手打包 | 复杂查询需要导入 DuckDB | ✅ **采用** |
| D. 专用审计服务（如 Vector + Loki） | 行业最佳 | 早期 5 人内测做这个就是浪费 | ❌ 留到 P2 |

**选 C**：JSONL 文件，每天一个，路径 `deploy/data/audit/audit-YYYY-MM-DD.jsonl`。

每行一个事件，append-only。任何进程能写（持有文件锁短暂占用），任何工具能读。备份脚本顺手把当天没结束的文件 + 昨天起所有归档全打包。

到达瓶颈（大致单日 > 100MB 即每月 3GB 起）再考虑迁 DuckDB / ClickHouse —— 那时业务也起规模了。

## 3. 事件 schema

每行 JSONL：

```json
{
  "ts": "2026-05-21T03:14:15.123Z",
  "event": "billing.deduct",
  "request_id": "bfe65129-6f03-4748-8b74-044663c06072",
  "actor": {
    "id": 42,
    "type": "user",
    "ip": "203.0.113.7",
    "user_agent": "..."
  },
  "subject": {
    "id": 42,
    "type": "user"
  },
  "result": "success",
  "payload": {
    "amount": 0.0012,
    "currency": "USD",
    "model": "claude-sonnet-4-5-20250929",
    "tokens_in": 137,
    "tokens_out": 422,
    "balance_before": 9.5023,
    "balance_after": 9.5011,
    "upstream_account_id": 1
  }
}
```

### 字段表

| 字段 | 类型 | 说明 |
|---|---|---|
| `ts` | ISO 8601 UTC ms | 事件发生时间，**写入者本机时钟** |
| `event` | string | dot-separated 命名空间，见下文事件清单 |
| `request_id` | string \| null | 关联 sub2api / Caddy 一次 HTTP 请求；非 HTTP 触发为 null |
| `actor.id` | int \| null | 触发者；系统 / cron 触发为 null |
| `actor.type` | enum | `user` / `admin` / `system` / `cron` / `script` |
| `actor.ip` | string \| null | 触发者公网 IP；从 Caddy `X-Forwarded-For` 第一段取 |
| `actor.user_agent` | string \| null | UA；用于反滥用，可选 |
| `subject.id` | int \| string | 操作对象 id |
| `subject.type` | enum | `user` / `api_key` / `account` / `order` / `setting` / `cpa_instance` |
| `result` | enum | `success` / `failure` / `partial` |
| `payload` | object | 事件特化字段，详见下文 |

### 事件命名空间

| 命名空间前缀 | 写入者 | 举例事件 |
|---|---|---|
| `auth.*` | sub2api（经 PG trigger） | `auth.login_success`、`auth.login_failed`、`auth.password_changed`、`auth.totp_enabled` |
| `billing.*` | sub2api（PG trigger） | `billing.topup`、`billing.deduct`、`billing.refund`、`billing.bonus_granted` |
| `key.*` | sub2api（PG trigger） | `key.created`、`key.revoked`、`key.group_changed` |
| `account.*` | sub2api（PG trigger） | `account.created`、`account.updated`、`account.disabled` |
| `setting.*` | sub2api（PG trigger） | `setting.changed`（含 key 名 + 旧值/新值） |
| `cpa_health.*` | `scripts/cpa-health-check` | `cpa_health.degraded`、`cpa_health.force_inactive`、`cpa_health.recovered` |
| `backup.*` | `scripts/backup` | `backup.created`、`backup.uploaded`、`backup.failed` |
| `restore.*` | `scripts/restore` | `restore.attempted`、`restore.completed` |
| `setup.*` | `scripts/setup-all`、`apply-branding` | `setup.account_provisioned`、`setup.branding_applied` |

### 敏感数据脱敏

**绝不写入**：明文密码、明文 API key、TOTP 密钥、JWT、信用卡号、邮箱完整地址（仅记 `act***@example.com`）、请求体内容、响应体内容。

`payload.before` / `payload.after` 仅记**字段名 + 类型 + 长度**，不记值。

## 4. 写入路径

### 4.1 sub2api 业务事件（PG trigger 复制）

不改 sub2api 源码，**在 Postgres 层挂触发器**，把 `users / api_keys / accounts / settings / orders` 等表的 INSERT/UPDATE/DELETE 通过 `pg_notify` 推到 audit-writer 进程。

```
sub2api ----------> Postgres -----[trigger]-----> NOTIFY audit_events
                                                       |
                                                       v
                                            audit-writer (独立小进程)
                                                       |
                                                       v
                                       deploy/data/audit/audit-2026-05-21.jsonl
```

- audit-writer：约 100 行 Go / Python，LISTEN audit_events，把每条 NOTIFY 转成 JSONL 一行追加文件
- 进程崩了：sub2api 业务继续，事件丢失（接受这个权衡。事件丢比业务挂强）
- 进程恢复后：从 `LAST_PROCESSED_LSN` 重新 LISTEN，但 **NOTIFY 已丢的事件不补**（PG NOTIFY 不持久）

如果要 100% 不丢事件，方案升级：用 `wal2json` + `pg_recvlogical` 走 logical replication。早期不做。

### 4.2 我们自己脚本的事件（直接写）

`scripts/{cpa-health-check,backup,restore,setup-all,apply-branding}.sh` 在关键操作前后**直接 append 一行 JSONL** 到当天的 audit 文件：

```bash
# scripts/_audit.sh （新建 helper，被其它脚本 source）
audit_event() {
  local event="$1" result="$2" payload="$3"  # payload 是 JSON 字符串
  local ts="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  local file="${ROOT_DIR}/deploy/data/audit/audit-$(date -u +%Y-%m-%d).jsonl"
  mkdir -p "$(dirname "$file")"
  jq -nc \
    --arg ts "$ts" --arg event "$event" --arg result "$result" \
    --argjson payload "$payload" \
    '{ts:$ts, event:$event, result:$result, actor:{type:"script"}, payload:$payload}' \
    >> "$file"
}
```

写失败时**不阻塞业务**（脚本继续，最多输出一行 warning 到 stderr）。

### 4.3 Caddy access log（轻量增强）

Caddy 已经在 `deploy/Caddyfile` 里 `log { output stdout, format json }`。这一份不是审计日志，但**可以**作为审计日志的 corroborating evidence。

落地：把 Caddy log 同时输出到文件 `deploy/data/audit/caddy-YYYY-MM-DD.jsonl`，备份脚本顺手打包。

## 5. 查询路径

### 5.1 命令行（早期）

```bash
# 某用户最近 24 小时全部活动
jq -c 'select((.actor.id == 42 or .subject.id == 42) and .ts > "'$(date -u -d '24 hours ago' +%FT%TZ)'")' \
  deploy/data/audit/audit-*.jsonl

# 某次扣费的上下游 request_id 链
grep -h '"request_id":"bfe65129"' deploy/data/audit/*.jsonl | jq .

# 某账号何时被 cpa-health-check 强制 inactive
jq -c 'select(.event == "cpa_health.force_inactive" and .subject.id == 3)' \
  deploy/data/audit/audit-*.jsonl
```

### 5.2 中期：DuckDB 单文件

跑到一定规模后：

```sql
INSTALL httpfs; LOAD httpfs;
CREATE TABLE audit AS
  SELECT * FROM read_json_auto('deploy/data/audit/audit-*.jsonl');
SELECT actor.id, COUNT(*) FROM audit
  WHERE event = 'auth.login_failed' AND ts > NOW() - INTERVAL 7 DAY
  GROUP BY actor.id ORDER BY 2 DESC LIMIT 20;
```

每天 cron 增量加载新 JSONL → DuckDB 文件。WebUI 留到 P2。

## 6. 保留期与归档

| 阶段 | 位置 | 保留 |
|---|---|---|
| 实时 | `deploy/data/audit/audit-YYYY-MM-DD.jsonl` | 当天 |
| 归档（gzip） | `deploy/data/audit/archive/audit-YYYY-MM-DD.jsonl.gz` | 90 天 |
| 备份对象存储 | rclone 推到 R2 / B2 / S3 | 12 个月（合规要求） |

每天 03:30 cron：

```bash
# rotate.sh （审计自身的 daily 任务）
cd /opt/manifold/deploy/data/audit
gzip --best audit-$(date -u -d 'yesterday' +%F).jsonl   # 当天文件已转到昨天
find . -maxdepth 1 -name '*.jsonl.gz' -mtime +90 -exec mv {} archive/ \;
find archive -name '*.jsonl.gz' -mtime +365 -delete
```

`scripts/backup.sh` 已经会把 `deploy/data/` 全树打包 + GPG + rclone 推远端 —— 审计日志自然搭车，不用额外配。

## 7. 关键不变式

1. **append-only**：absolute never delete / modify a written line. 工具改 schema 时新增字段而非改字段语义。
2. **clock 单调**：写入者机器需 NTP 同步。基础设施层 `chrony` 已配。
3. **写失败不阻塞业务**：审计是 best-effort，但需要在监控里加 alert（"今天没收到任何 auth.* 事件 = 写路径挂了"）。
4. **PII 脱敏**：见 3.敏感数据脱敏 一节。Code review 必查。

## 8. 实施 phases

| Phase | 内容 | 预估工时 |
|---|---|---|
| **Phase 0**：现在 | 本文档 + 在 `scripts/_audit.sh` 起一个 stub | 已完成（仅文档） |
| Phase 1：脚本侧落地 | `scripts/_audit.sh` 真实写入；cpa-health-check / backup / restore / apply-branding / setup-all 嵌进去 | 半天 |
| Phase 2：PG trigger | 写 SQL migration，给 `users / api_keys / accounts / settings / orders` 加触发器；写 audit-writer（Go，~150 行）；compose 多挂一个 service | 1-2 天 |
| Phase 3：rotation + 备份联动 | 写 `scripts/audit-rotate.sh`；接入 backup.sh | 半天 |
| Phase 4：DuckDB 查询 | 写 `scripts/audit-query.sh` 包一层；提供 5-10 个常用 query | 半天 |
| Phase 5：监控接入 | Uptime Kuma 加"24h 未收到 auth.* 事件 = 告警" | 半小时 |

P1 收费前必须完成 Phase 1 + Phase 2。Phase 3-5 可以延后。

## 9. 关于 GDPR / PIPL "用户要求删除"

审计日志是**安全 / 合规义务**，按多数司法管辖区可以**拒绝个人删除请求**（基于"合法利益"或"法定义务"豁免）。但需在隐私政策第 7 节明示这一点。**当前 privacy-policy.md 已覆盖**，无需改动。

用户注销账号 → 主库 PII 删除 / 匿名化；审计日志保留并维持 actor.id 引用（用户已不存在，actor.id 解析时显示"已注销用户 #42"即可）。

---

> **下一步**：服务器上线后实施 Phase 1（脚本侧 audit_event 落地），其它阶段按节奏推进。
