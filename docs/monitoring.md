# 监控与告警

DoD：**故意 stop 一个容器，5 分钟内 Telegram 收到告警**。

## 架构

| 角色 | 服务 | 位置 |
|---|---|---|
| 探针 + UI | Uptime Kuma | `manifold-kuma`，绑 `127.0.0.1:3001` |
| 通知 | Telegram bot + 邮箱 SMTP | Kuma 内置 |
| 存储 | SQLite | `deploy/data/uptime-kuma/kuma.db` |

为什么不让 Kuma 走公网：监控面板自带的用户列表 / 故障历史是攻击者的好饵 —— 看见你 503 就来撞门。**只开 SSH 隧道**。

## 首次启动

```bash
cd deploy && docker compose up -d kuma
```

### 本机访问

浏览器开 `http://127.0.0.1:3001` —— 第一次进来要求设管理员账号 + 密码。**立刻设**，否则放着就有人扫到 setup endpoint 直接占用。

### 远端访问

在你工作的电脑上跑：

```bash
ssh -L 3001:127.0.0.1:3001 vps
```

挂着不要关，本机浏览器开 `http://127.0.0.1:3001`。退会话隧道就断了，每次进 Kuma 重新开一次。

## 必配的探针

按这张表挨个加（左上 "+ Add New Monitor"）：

| Name | Type | URL / Host | Interval | 备注 |
|---|---|---|---|---|
| sub2api-health | HTTP(s) | `http://sub2api:8080/health` | 60s | 主网关心跳，挂了 = 全员断服 |
| postgres | TCP Port | `postgres` : `5432` | 60s | 数据库 socket 通不代表能查询，但够预警 |
| redis | TCP Port | `redis` : `6379` | 60s | 同上 |
| cpa-1-models | HTTP(s) | `http://cpa-1:8317/v1/models` | 120s | 加 Header `Authorization: Bearer <CPA_1 内网共享秘钥>` |
| cpa-2-models | HTTP(s) | `http://cpa-2:8317/v1/models` | 120s | 同上，换 cpa-2 的秘钥 |
| (公网入口) | HTTP(s) - Keyword | `https://你的域名/health` | 60s | 关键词 `"status":"ok"`；DOMAIN 模式下才加 |

加 cpa-* 探针时勾上 "Ignore TLS Error"（容器名解析不走 TLS）。

### CPA `/v1/models` 探针的 Authorization header 怎么填

打开 Kuma 新建 monitor，选 HTTP(s)，URL 填 `http://cpa-1:8317/v1/models`。展开 **HTTP Options** → **Headers**，添加：

```json
{ "Authorization": "Bearer <CPA-1 内网共享秘钥>" }
```

秘钥从 `deploy/cpa-1/config.yaml` 的 `api-keys:` 那行 copy。

## Telegram 告警

### 创建 bot

1. Telegram 找 [@BotFather](https://t.me/BotFather)
2. `/newbot` → 起名 → 起 username（必须以 `bot` 结尾，例如 `manifold_alert_bot`）
3. BotFather 给你一串 token，长这样：`123456789:ABCdefGHI...` —— 这就是 **Bot Token**
4. 找你刚创建的 bot，对它说一句 `/start`（任何文字都行，目的是让 bot 看到你的 chat）
5. 浏览器打开 `https://api.telegram.org/bot<TOKEN>/getUpdates`，找 `"chat":{"id":<数字>}` —— 这是 **Chat ID**

### 接到 Kuma

Kuma 左侧 **Settings** → **Notifications** → **Setup Notification** → 选 Telegram

| 字段 | 填什么 |
|---|---|
| Friendly Name | telegram-personal |
| Bot Token | 上面拿到的 token |
| Chat ID | 上面拿到的 chat id |
| Default Enabled | ✓ |

按 **Test** 验证收到测试消息再保存。

### 把通知绑到 monitor

回到每个 monitor 编辑页 → 滚到底 **Notifications** → 勾上刚配的 telegram-personal → Save。

省事做法：先在 Settings → Notifications 给 telegram 勾 "Default Enabled"，以后新建 monitor 默认带这个通知，不用每个手动绑。

## 邮件告警（备份通道）

Telegram 偶尔会断（GFW / 自己 ban 自己），所以再配一路邮件。

Settings → Notifications → SMTP

| 字段 | 推荐值 |
|---|---|
| Host | smtp.gmail.com / smtp.fastmail.com / 你的邮箱服务商 |
| Port | 587 (STARTTLS) 或 465 (TLS) |
| Username / Password | 邮箱地址 / 应用专用密码（不是登录密码） |
| From | 同 Username |
| To | 你自己 |

**Gmail 必须用 App Password**，不能用主密码。生成入口：accounts.google.com → Security → 2-Step Verification → App passwords。

## 备份 Kuma 配置

Kuma 配置存在 `deploy/data/uptime-kuma/kuma.db`（SQLite）。`scripts/backup.sh` 当前**没**把它包进去 —— 因为重新配也就 10 分钟。

如果探针很多想留：

```bash
docker exec manifold-kuma sqlite3 /app/data/kuma.db ".backup /app/data/kuma.db.bak"
cp deploy/data/uptime-kuma/kuma.db.bak deploy/data/uptime-kuma-config-$(date +%Y%m%d).db
```

塞到 scripts/backup.sh 的 stage 里也行，目前留着不做。

## 故障演练

每月一次：

- [ ] `docker stop manifold-cpa-1` —— 5 分钟内 Telegram 应该响
- [ ] `docker start manifold-cpa-1` —— 恢复通知也要收到
- [ ] 在 sub2api 后台把 cpa-1 的 admin token 故意填错 —— 看 sub2api-health 是否绿（应该绿，因为 health 不查 CPA）
- [ ] 把 Kuma 自己 stop —— 验证你**不会**收到通知（因为告警发不出来了）。**这是 Kuma 的固有盲区**。

## Kuma 的告警盲区

Kuma 挂了就发不出告警 —— 监控自己挂的事它管不了。三种缓解：

1. **第二个监控**：在 BetterStack / UptimeRobot 免费层加一条只探 `https://你的域名/health` 的探针。两套独立。
2. **Cron 心跳**：让另一台机器每 5 分钟 ping 一次 Kuma 的 `/api/status-page/heartbeat`，连续 3 次失败就发邮件。
3. **Push 模式**：把 Kuma 当 Push 接收端，让备份脚本 / 健康脚本主动 ping 它 —— 探针没按时来 = 告警。

P0 阶段先做 #1。
