# 预飞行 Checklist

> 从"服务器买好了"到"`curl https://yesterhaze.codes/health` 返回 200"的总指挥。
> 按顺序执行；任何一步失败先排查再继续，不要跳。
> 预估纯执行 30-45 分钟（不含等待证书签发的 2-3 分钟）。

---

## A. 本机预备（出发前必做）

### A.1 已完成 ✅

- [x] 域名 `yesterhaze.codes` 已购
- [x] `setup-all.sh`、`cpa-health-check.sh`、`apply-branding.sh` 已写并 WSL 测过
- [x] 4 篇法律文档（`docs/legal/`）已起草
- [x] `branding.example.json` 模板已就绪
- [x] 审计日志技术设计已完成

### A.2 现在做（10 分钟）

```powershell
# 1. SSH 密钥对（如未生成过）
ssh-keygen -t ed25519 -C "manifold-deploy" -f $env:USERPROFILE\.ssh\manifold_ed25519
# 私钥放好；公钥稍后上服务器

# 2. GPG 备份密钥对 —— 见 §F，5 分钟搞定，私钥**两份独立**收好
```

### A.3 信息卡（贴这里以免忘）

填入实际值（**不要提交到 git**，私人记笔记本即可）：

```
服务器 IP        : <填>
SSH 端口         : <填，建议改 22000+>
管理员用户名      : <填，例如 admin>
GPG fingerprint  : <填，gpg --list-keys 看>
Cloudflare API   : <如有，备用>
Telegram bot     : token=<填>  chat_id=<填>
rclone 远端名     : <填，例如 r2:manifold-backups>
```

---

## B. 服务器一次性初始化

### B.1 把 SSH 公钥推上去

```powershell
# 本机 PowerShell
type $env:USERPROFILE\.ssh\manifold_ed25519.pub | ssh root@<服务器IP> 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

如果服务器商默认只给 root + 密码，先创业务用户：

```bash
# 服务器（用 root 密码登入）
adduser admin
usermod -aG sudo admin
mkdir -p /home/admin/.ssh && chmod 700 /home/admin/.ssh
# 把同样公钥 cat 进 /home/admin/.ssh/authorized_keys
chown -R admin:admin /home/admin/.ssh
chmod 600 /home/admin/.ssh/authorized_keys
```

### B.2 用 key 登进 admin 用户

```powershell
ssh -i $env:USERPROFILE\.ssh\manifold_ed25519 admin@<服务器IP>
```

进得去就**断开**继续下一步。

### B.3 clone 仓库

```bash
# 服务器，admin 用户
sudo apt-get update && sudo apt-get install -y git
cd ~ && git clone <你的仓库 URL> manifold
cd manifold
```

> 如仓库是私库且没配 deploy key，临时用 PAT 或先在本机 `git archive` 打包再 `scp` 上去。

### B.4 跑 server-bootstrap.sh（加固 + 装 docker）

```bash
sudo bash scripts/server-bootstrap.sh --ssh-port 22000 --user admin
```

期间会改 SSH 端口、装 ufw / fail2ban / unattended-upgrades / docker。**别断终端** —— 改完后**用新窗口**先试新端口能进，再断老窗口：

```powershell
# 本机另起 PowerShell 测
ssh -i $env:USERPROFILE\.ssh\manifold_ed25519 -p 22000 admin@<服务器IP>
# 进得去 → 老窗口可以放心断
```

新端口能进了：把本机 `~/.ssh/config` 加 alias：

```
Host manifold
  HostName <服务器IP>
  Port     22000
  User     admin
  IdentityFile ~/.ssh/manifold_ed25519
```

之后用 `ssh manifold` 就行。

### B.5 退出 admin 重登（让 docker 组生效）

```bash
exit
ssh manifold
docker ps   # 不报权限错就 OK
```

---

## C. 配 .env + 拉栈

### C.1 生成密钥 + 初始化 .env

```bash
cd ~/manifold
bash scripts/init.sh
# 打印的 admin password / CPA 内网秘钥 → 立刻抄到信息卡（这次不抄，下次重生成）
```

### C.2 编辑 .env

```bash
nano deploy/.env
```

至少改这些（其它默认即可）：

```bash
# 当前路线：CF Flexible 模式（CF 帮跑 HTTPS，源站 80 端口纯 HTTP）→ DOMAIN 留空
# 以后想自签 LE 证书（CF 切灰云 / 不走 CF）：把 DOMAIN 填上 yesterhaze.codes
DOMAIN=
ACME_EMAIL=Taohu0122@qq.com
GPG_RECIPIENT=<§F 第 2 步算出的 fingerprint 或 email>
RCLONE_REMOTE=<空也行，先跳过，第 7 步再来加>
TELEGRAM_BOT_TOKEN=<§G 第 1 步算出的 token，空则不告警>
TELEGRAM_CHAT_ID=<§G 第 1 步算出的 chat id>
```

`ADMIN_PASSWORD` 由 init.sh 自动生成，**不要手改**。

### C.3 启栈

```bash
cd deploy && docker compose up -d && cd ..
```

### C.4 等 sub2api healthy

```bash
for i in {1..30}; do
  curl -fsS http://127.0.0.1:8080/health >/dev/null 2>&1 && echo OK && break
  sleep 2
done
docker ps --filter name=manifold
```

5 个容器都应该是 `Up (healthy)` 或 `Up` 状态：`manifold-sub2api`、`postgres`、`redis`、`caddy`、`kuma`、`cpa-1`、`cpa-2`。

---

## D. CPA OAuth 登录（**手动浏览器交互，无法自动**）

每个 CPA 实例需要登录上游订阅。OAuth 必须人工浏览器登录：

```bash
# Anthropic OAuth
docker compose -f deploy/docker-compose.yml exec cpa-1 ./CLIProxyAPI -claude-login
# 终端会打印一个 URL → 在本机浏览器打开 → Anthropic 登录 → 回调一段 code → 粘贴到 cpa-1 终端
```

每个 CPA 至少登 anthropic 一次；可选 openai / gemini / antigravity。3 个 CPA 实例都做完后：

```bash
ls -1 deploy/cpa-*/auths/   # 应能看到 claude-*.json / codex-*.json
```

> ⚠️ OAuth token 文件 **绝不入 git**（.gitignore 已屏蔽），**必须备份**（备份脚本已包含）。

---

## E. 一键应用配置

### E.1 sub2api 后台全配置

```bash
bash scripts/setup-all.sh
```

输出会包含发出的 anthropic / openai API key 明文，**抄下来发给内测朋友**或登控制台再发。

### E.2 品牌化 + 法律文档

```bash
cp deploy/branding.example.json deploy/branding.json
nano deploy/branding.json    # 按需调 site_name / home_content / contact_info
bash scripts/apply-branding.sh
```

### E.3 健康巡检 cron

```bash
crontab -e
```

加：

```cron
*/5 * * * * cd /home/admin/manifold && bash scripts/cpa-health-check.sh >> /var/log/manifold-health.log 2>&1
30 3  * * * cd /home/admin/manifold && bash scripts/backup.sh >> /var/log/manifold-backup.log 2>&1
```

---

## F. GPG 密钥生成（备份必需）

### F.1 在**本机**（不是服务器）生成

```powershell
winget install GnuPG.GnuPG   # 已装的跳过

# 主钥（默认是 [SC] 只能签名）
gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key "manifold-backup@yesterhaze.codes" rsa4096 default 5y

gpg --list-keys              # 记下 fingerprint（40 位 hex）

# 加密子钥（[E]）必须显式追加
gpg --batch --pinentry-mode loopback --passphrase '' --quick-add-key <FINGERPRINT> rsa4096 encr 5y
```

验证 `gpg --list-keys` 输出里**必须有 `sub rsa4096 [E]` 这一行**，否则备份脚本加密会失败。

### F.2 私钥安保（关键）

```powershell
# 导出
gpg --export-secret-keys --armor <FINGERPRINT> > $env:USERPROFILE\Documents\manifold-backup-private.asc
gpg --export        --armor <FINGERPRINT> > $env:USERPROFILE\Documents\manifold-backup-public.asc
```

- `manifold-backup-private.asc`：**两份独立保管**。
  - 一份扔密码管理器（1Password / Bitwarden）的安全笔记
  - 一份扔离线 U 盘 / 另一台机器的加密盘
  - **绝不上服务器**、**绝不入 git**
- `manifold-backup-public.asc`：上服务器、可入 git（无所谓）。

### F.3 服务器导入公钥

```powershell
scp $env:USERPROFILE\Documents\manifold-backup-public.asc manifold:~/
```

```bash
# 服务器
gpg --import ~/manifold-backup-public.asc
gpg --list-keys              # 确认能看到，记下 email 或 fingerprint
gpg --edit-key <FINGERPRINT>  # 提示符里输入：trust → 5 (ultimate) → save
```

把这个 email 或 fingerprint 填到 `deploy/.env` 的 `GPG_RECIPIENT=`。

---

## G. Telegram bot（Kuma + cpa-health-check 共用）

### G.1 创建 bot（5 分钟）

1. Telegram 找 [@BotFather](https://t.me/BotFather)
2. 发 `/newbot` → 起名（如 Manifold Alerts）→ username 必须以 `bot` 结尾（如 `manifold_alert_bot`）
3. 拿到 token：`123456789:ABC-defGHI...`
4. 找你的新 bot 发任何文字（如 `/start`）
5. 浏览器开 `https://api.telegram.org/bot<TOKEN>/getUpdates` → 找 `"chat":{"id":数字,...}` → 这是 chat id

### G.2 测试发送

```bash
curl -sS -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d "chat_id=<CHAT_ID>" -d "text=Manifold test alert from $(hostname)"
```

Telegram 收到了 → 把 token / chat id 填到 `deploy/.env`，重新 `bash scripts/cpa-health-check.sh` 验证告警能发。

### G.3 接到 Kuma

详见 `docs/monitoring.md` 第 60-95 行。简言之：Kuma → Settings → Notifications → Telegram → 同样的 token + chat id。

---

## H. Cloudflare HTTPS（Flexible 模式）

当前路线：**CF 橙云开着 + SSL/TLS 模式 Flexible** —— CF 边缘对用户 HTTPS，CF↔源站走明文 HTTP。源站不需要签证书，`.env` 的 `DOMAIN=` 留空让 Caddy 监听 :80 纯 HTTP。

```
用户 ──HTTPS──> CF 边缘（CF 自动 *.yesterhaze.codes 证书）──HTTP──> 39.104.59.160:80 ──> Caddy ──> sub2api
```

### H.1 DNS 记录

A 记录 `yesterhaze.codes → 39.104.59.160`、**Proxy 橙云 ON**。已设。`www` 同步加一条同样设置（可选）。

### H.2 SSL/TLS 模式必须设 Flexible

CF → `yesterhaze.codes` → SSL/TLS → Overview → 选 **Flexible**

> 错设 Full / Full(strict) 会导致 502：因为源站没装证书，CF 试图 HTTPS 回源会失败。

### H.3 验 HTTPS

```powershell
curl -I https://yesterhaze.codes/health
# 期望 HTTP/2 200；证书 issuer 是 Cloudflare（不是 Let's Encrypt）
```

源站直接打也能通（明文 HTTP）：

```powershell
curl -I http://39.104.59.160/health
# 期望 HTTP/1.1 200，由 Caddy 直接服务
```

### H.4 未来想升级到端到端 HTTPS

当前模式的代价：**CF↔源站这段是明文**，能被路径上任何监听者看到。对朋友试用阶段够用；正式收费前建议升级：

| 升级到 | 怎么做 |
|---|---|
| **CF Full(strict) + CF Origin 证书** | CF → SSL/TLS → Origin Server → 生成 15 年证书 → 下载 cert.pem + key.pem 到 `deploy/data/caddy-certs/` → Caddyfile 加 `tls /path/to/cert.pem /path/to/key.pem` → CF 模式切 Full(strict) |
| **CF Full(strict) + 自签 LE** | CF 切灰云 → `.env` 填 `DOMAIN=yesterhaze.codes` → Caddy 自动 LE 签证 → 签下后切回橙云 + Full(strict) |
| **不走 CF** | CF 灰云（仅 DNS） → 同上 LE 自签流程 |

任一升级路线都不动 Caddyfile 现有结构，看着选。

---

## I. P0 最终 DoD 验证

照 `docs/TODO.md` P0 部分逐条勾：

```
[ ] curl https://yesterhaze.codes/health = 200（CF Flexible：证书 issuer 是 Cloudflare）
[ ] nmap -p- yesterhaze.codes 只看到 22000 / 80 / 443（其余 stealth）
[ ] backup.sh 跑一次，远端 rclone 推到位
[ ] DR 演练：另一台机器（或同台 ~/restore-test/）从今天备份能起出能用的栈
[ ] Kuma 加完 6 个探针，Telegram 收到测试告警；故意 docker stop sub2api，5min 内告警到
[ ] BetterStack/UptimeRobot 免费层探 /health 加上
[ ] cpa-health-check.sh cron 跑 1 次后 state file 写入；故意改 STRIKES=1 + 把 cpa-2 设 schedulable:false，看到自动 inactive + Telegram
[ ] 控制台首次登录强制弹 4 份法律文档同意
[ ] runbook 里 8 条密钥轮换路径过一遍清单（不必都演练，但都通读一次确认无歧义）
```

每条勾完后改 TODO.md。

---

## J. 上线后的"低头看"

第一周每天早上 5 分钟：

```bash
# 巡检过去 24h
ssh manifold

# 1. 容器全活？
docker ps --filter name=manifold --format 'table {{.Names}}\t{{.Status}}'

# 2. 健康巡检最近一次结果？
tail -20 /var/log/manifold-health.log

# 3. 备份昨晚跑了吗？
ls -lh ~/manifold/backups/$(date -d yesterday +%F)*.tar.gz.gpg

# 4. Kuma 有没新故障？
# 本机 ssh -L 3001:127.0.0.1:3001 manifold，浏览器 http://127.0.0.1:3001
```

任何异常立刻处理；周末单独跑一次 DR 演练（每月一次满足 DoD）。

---

## K. 常见踩坑

| 症状 | 原因 | 修 |
|---|---|---|
| `curl /health` 401 | 没经 caddy 直接打 sub2api，端口错 | 经域名打，或本机走 `127.0.0.1:8080` |
| LE 签证一直失败 | CF 在橙云 | DNS only 重试 |
| 备份成功但远端没传 | rclone 没 init / RCLONE_REMOTE 拼写错 | `rclone config` + `rclone ls <remote>` 验证 |
| Kuma 探针 cpa-1 通不了 | header `Authorization` 没填 | 重看 monitoring.md 第 50 行 |
| OAuth 登录浏览器跳回 localhost | CPA OAuth 默认 callback 是 127.0.0.1 | 本机起隧道 `ssh -L 8989:127.0.0.1:8989 manifold`，回调点到 localhost:8989 重试 |
| docker compose 拉不到镜像 | digest 钉太死且镜像源被墙 | 服务器换上海 / 香港，或配 mirror |

---

> 真上线了 → 在 `docs/TODO.md` 把 P0 整段勾掉，进 P1 阶段。
