# Manifold 上线 TODO

从"本机 PoC 已跑通"到"对外运营"的完整清单。按"不补就翻车"程度排。

---

## 🔴 P0 — 致命阻塞，不补完不要给任何人（含朋友）

### 1. HTTPS + 域名 + Caddy 反向代理 ⏱ 1-2h
- [ ] 买域名（Cloudflare 注册商 + DNS）—— 待选型 / 待付费
- [x] ~~服务器装 Caddy~~ —— Caddy 走 docker，由 compose 拉起
- [x] 改 `deploy/docker-compose.yml`：sub2api 取消 publish host port，挪到 manifold-edge 内网
- [x] 新增 Caddy 服务监听 80/443 转发到 sub2api（含 HTTP/3 QUIC）
- [x] Caddyfile 支持 `DOMAIN=` 两挡模式：留空 = IP 直连 HTTP；填值 = 自动 LE 签证书 + 80 跳 443
- [ ] **DoD**：填上 DOMAIN 后 `curl https://你的域名/health` 返回 200，证书是 Let's Encrypt

### 2. 服务器基础加固 ⏱ 30min
- [ ] `ufw` 只开 22 / 80 / 443
- [ ] SSH：禁密码登录、只 key、改非 22 端口
- [ ] 装 `fail2ban`
- [ ] `unattended-upgrades` 自动打安全补丁
- [ ] **DoD**：`nmap -p- yourdomain.com` 只看到你开的端口

### 3. PostgreSQL 自动备份 ⏱ 1-2h
- [x] `scripts/backup.sh` + `backup.ps1`：pg_dump custom + .env + cpa-*/config + cpa-*/auths + sub2api data → tar.gz → gpg → 可选 rclone 推异地
- [x] `scripts/restore.sh` + `restore.ps1`：全新机器模式默认（`--force` 才覆盖），自动 pg_restore + 启栈
- [x] 至少 7 天滚动 + 月度归档（脚本内置 `RETENTION_DAILY=7` / `RETENTION_MONTHLY=12`）
- [x] **本机实测通过**：pg_dump 869 个 TOC 对象 + 真实 OAuth token + .env + api-keys.json 全部进包；解密 + `pg_restore -l` 能读全部 schema
- [x] 完整运维文档 → 见 [docs/backup-restore.md](backup-restore.md)
- [ ] **DoD（异地）**：服务器到位后配 rclone + GPG 公钥 + cron 03:00 跑，跑一次成功推到 B2/R2
- [ ] **DoD（DR）**：另一台机器上能用昨天的备份重建出能用的 sub2api（每月演练一次）

### 4. 监控 + 告警 ⏱ 1-2h
- [x] Uptime Kuma 自托管（compose 里 `kuma` service，绑 127.0.0.1:3001 + SSH 隧道访问）
- [x] 探针清单 + Telegram bot 配法 → 见 [docs/monitoring.md](monitoring.md)
- [ ] 进 Kuma UI 实际加完 6 个探针 + Telegram + 邮件 SMTP
- [ ] **DoD**：故意 stop 一个容器，5 分钟内收到告警
- [ ] 加一条 BetterStack/UptimeRobot 免费层探 `/health` 防 Kuma 自己挂（盲区缓解）

### 5. OAuth 账号风险预案 ⏱ 视账号数
- [ ] 至少 3 个独立 OAuth 订阅（不同邮箱、不同付款卡）
- [ ] 每个 CPA 设单订阅 RPM 上限 ≤ 60（接近真人速率）
- [ ] cron 监控每账号 5xx 率，超阈值自动置 inactive
- [ ] **DoD**：故意把 cpa-1 token 设废，流量自动切 cpa-2，告警通知

> ⚠️ 这步**不能完全规避封号**，只能延缓。OAuth 共享转售本就是灰色地带。

### 6. 法律基础 ⏱ 1d 自写 / 几千块律师审
- [ ] 服务条款 (ToS)
- [ ] 隐私政策
- [ ] 免责声明（明确"用户自带订阅"或"代理服务"边界）
- [ ] 退款政策
- [ ] **DoD**：首次登录强制同意，存留记录

### 7. 密钥轮换路径 ⏱ 1h
- [x] [docs/runbook.md](runbook.md) 覆盖 POSTGRES_PASSWORD / REDIS_PASSWORD / JWT_SECRET / TOTP_ENCRYPTION_KEY（⚠ 不可换）/ ADMIN_PASSWORD / CPA 内网秘钥 / GPG 备份密钥 / DOMAIN / 整套升级
- [x] **DoD**：每条路径都有"影响范围 / 准备 / 步骤 / 验证 / 回滚"五段

---

## 🟡 P1 — 收费前必须补完

### 8. 品牌前端 ⏱ 1-3d
- [ ] **LGPL 红线**：不改 sub2api 源码
- [ ] 推荐路径：Caddy 反代里加 HTML 注入插件（`caddy-replace` 之类）替换 title / logo / 主色
- [ ] **DoD**：用户看到的是 "Manifold" 不是 "Sub2API"

### 9. 用户注册流程 ⏱ 0.5d
- [ ] 开放注册 → 加 Cloudflare Turnstile（sub2api 已支持）
- [ ] 或邀请制 → 用 sub2api 自带邀请码
- [ ] **DoD**：新用户能从公网注册并自动建账号

### 10. 支付集成 ⏱ 1-2d
- [ ] 国内：EasyPay / ZPay / 易支付（避开商户号备案）
- [ ] 海外：Stripe（需海外公司主体）
- [ ] 充值套餐设计 + 退款规则
- [ ] **DoD**：真实充 1 元成功，余额到账

### 11. 客服 / 工单 ⏱ 1h 最简
- [ ] 邮箱 + Telegram/Discord 群
- [ ] 进阶：Crisp 免费层嵌入站点
- [ ] **DoD**：用户出问题能找到你

### 12. 用户帮助文档 ⏱ 1-2d
- [ ] 注册 / 充值 / 拿 key / 用 key 的 step-by-step（带截图）
- [ ] 支持的模型列表（动态从 CPA 拉）
- [ ] 错误码字典（403/404/429/502 对应什么场景）
- [ ] FAQ
- [ ] **DoD**：自己照文档全程不查任何外部资料能完成首次调用

### 13. 审计日志 ⏱ 0.5d
- [ ] 登录历史、充值/扣费、key 创建/删除、管理员操作
- [ ] 持久化独立日志库（不混在 sub2api 主库）
- [ ] **DoD**：任意客户纠纷能拉出完整时间线

### 14. 滚动升级策略 ⏱ 0.5d
- [x] 固定 image tag（**别用 `latest`**） —— 已用 digest 钉死全部 6 个镜像（sub2api / cpa / postgres / redis / caddy / kuma）
- [x] sub2api / CPA / Caddy / Kuma / Redis minor / Postgres minor / **Postgres major** 升级步骤文档化 → 见 [docs/upgrade.md](upgrade.md)
- [x] **DoD**：每个升级路径都有"影响范围 / 准备 / 步骤 / 验证 / 回滚"五段
- [ ] **DoD（实操）**：服务器到位后跑一次真实小版本升级（如 sub2api patch 版）走完流程

---

## 🟢 P2 — 真上规模才需要（>100 DAU 之后）

- [ ] **Cloudflare 套源站**：DDoS 防护 + 隐藏 IP
- [ ] **多区域 CPA**：国内 / 美西 / 欧洲，按用户地域分流
- [ ] **数据看板**：用户增长 / DAU / token 消耗 / 收入
- [ ] **A/B 测试 / 灰度发布**
- [ ] **企业私有化版本**：SLA + 高级支持
- [ ] **CPA OAuth 自动 refresh**：token 过期前自动重新登录

---

## 工时汇总

| 阶段 | 完成定义 | 工时 |
|---|---|---|
| **P0 完成** | 给 3-5 个信任的朋友白名单试用 | 6-8 小时 + 等域名 + 律师审 |
| **P0 + P1 完成** | 真正开放注册、能收费 | 再加 5-7 天 |
| **P0 + P1 + P2 完成** | 当扩张型生意做 | 加 1-2 个月 |

---

## 不在这份清单里的"业务问题"

这些不是工程能解的：

1. **OAuth ToS 风险**：Anthropic/OpenAI 都禁账号共享转售；被识别 = 账号没了 = 所有客户服务中断。技术能延缓但不能根除。**唯一根治：用户自带订阅模型**（你只提供网关，不持有 OAuth）。
2. **现金流模型**：先充值后消费 vs 后付费；定价相对厂商订阅原价的折扣率；退款率预估。
3. **客户预期管理**：明确告知"中转服务"、稳定性 SLA、单账号风险、停服补偿规则。
4. **法律主体**：是否注册公司？哪个司法管辖区？是否申请 ICP/EDI 证？
