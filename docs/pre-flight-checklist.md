# 预飞行 Checklist

> 从"服务器买好了"到"`curl https://zstuacm.xyz/health` 返回 200"的总指挥。
> 按顺序执行；任何一步失败先排查再继续，不要跳。
> 预估纯执行 30-45 分钟（不含等待证书签发的 2-3 分钟）。

---

## A. 本机预备（出发前必做）

### A.1 已完成 ✅

- [x] 域名 `zstuacm.xyz` 已购
- [x] `apply-branding.sh` 已写并 WSL 测过
- [x] `branding.example.json` 模板已就绪
- [x] 审计日志技术设计已完成

### A.2 现在做（10 分钟）

```powershell
# 1. SSH 密钥对（如未生成过）
ssh-keygen -t ed25519 -C "manifold-deploy" -f $env:USERPROFILE\.ssh\manifold_ed25519
# 私钥放好；公钥稍后上服务器

# 2. GPG 备份密钥对 —— 见 §E，5 分钟搞定，私钥**两份独立**收好
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
# ADMIN_EMAIL / ADMIN_PASSWORD 已随机生成到 deploy/.env，不会打印到终端
# 从这个权限为 600 的文件录入密码管理器
```

### C.2 编辑 .env

```bash
nano deploy/.env
```

至少改这些（其它默认即可）：

```bash
# 生产推荐 CF Full (strict)；若暂时仍用 Flexible，也必须完成 §G 的源站白名单
DOMAIN=
# ADMIN_EMAIL / ADMIN_PASSWORD 已由 init.sh 生成，保持原值
ACME_EMAIL=<专用运维邮箱，不要提交真实值>
GPG_RECIPIENT=<§E 第 2 步算出的 fingerprint 或 email>
RCLONE_REMOTE=<空也行，先跳过，第 7 步再来加>
TELEGRAM_BOT_TOKEN=<§F 第 1 步算出的 token，空则不告警>
TELEGRAM_CHAT_ID=<§F 第 1 步算出的 chat id>
```

`ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 由 init.sh 自动生成，**不要改成可猜的固定值**。

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

6 个容器都应该是 `Up (healthy)` 或 `Up` 状态：`manifold-sub2api`、`manifold-chat-demo`、`manifold-postgres`、`manifold-redis`、`manifold-caddy`、`manifold-kuma`。

---

## D. 应用配置

### D.1 sub2api 后台全配置

在 sub2api 后台手动配置：登录 → 加余额 → 建 group → 添加上游 OAuth 账号 → 签发 API key。签发的 anthropic / openai key 明文抄下来发给内测朋友或登控制台再发。

### D.2 品牌化

```bash
cp deploy/branding.example.json deploy/branding.json
nano deploy/branding.json    # 按需调 site_name / home_content / contact_info
bash scripts/apply-branding.sh
```

### D.3 备份 cron

```bash
crontab -e
```

加：

```cron
30 3  * * * cd /home/admin/manifold && bash scripts/backup.sh >> /var/log/manifold-backup.log 2>&1
```

---

## E. GPG 密钥生成（备份必需）

### E.1 在**本机**（不是服务器）生成

```powershell
winget install GnuPG.GnuPG   # 已装的跳过

# 主钥（默认是 [SC] 只能签名）
gpg --batch --pinentry-mode loopback --passphrase '' --quick-generate-key "manifold-backup@zstuacm.xyz" rsa4096 default 5y

gpg --list-keys              # 记下 fingerprint（40 位 hex）

# 加密子钥（[E]）必须显式追加
gpg --batch --pinentry-mode loopback --passphrase '' --quick-add-key <FINGERPRINT> rsa4096 encr 5y
```

验证 `gpg --list-keys` 输出里**必须有 `sub rsa4096 [E]` 这一行**，否则备份脚本加密会失败。

### E.2 私钥安保（关键）

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

### E.3 服务器导入公钥

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

## F. Telegram bot（Kuma 告警共用）

### F.1 创建 bot（5 分钟）

1. Telegram 找 [@BotFather](https://t.me/BotFather)
2. 发 `/newbot` → 起名（如 Manifold Alerts）→ username 必须以 `bot` 结尾（如 `manifold_alert_bot`）
3. 拿到 token：`123456789:ABC-defGHI...`
4. 找你的新 bot 发任何文字（如 `/start`）
5. 浏览器开 `https://api.telegram.org/bot<TOKEN>/getUpdates` → 找 `"chat":{"id":数字,...}` → 这是 chat id

### F.2 测试发送

```bash
curl -sS -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d "chat_id=<CHAT_ID>" -d "text=Manifold test alert from $(hostname)"
```

Telegram 收到了 → 把 token / chat id 填到 `deploy/.env`。

### F.3 接到 Kuma

详见 `docs/monitoring.md` 第 60-95 行。简言之：Kuma → Settings → Notifications → Telegram → 同样的 token + chat id。

---

## G. Cloudflare HTTPS + 源站锁定

生产目标是：用户只能访问 Cloudflare 边缘，源站公网的 TCP 80/443 只接受
Cloudflare 官方出口网段。仅开启橙云不等于隐藏源站；若源站端口仍对所有地址开放，
知道源站 IP 的人仍可绕过 Cloudflare 的 WAF、限流和访问日志。

```
用户 ──HTTPS──> Cloudflare ──HTTP/HTTPS──> <ORIGIN_IP>:80/443 ──> Caddy
非 Cloudflare 来源 ──X──> <ORIGIN_IP>:80/443
```

### G.1 DNS 与 TLS

- A/AAAA 记录填写真实 `<ORIGIN_IP>`，并开启 **Proxy（橙云）**。
- 不要把真实源站 IP 写进 Git、Issue、CI 日志或截图。
- Cloudflare SSL/TLS 推荐 **Full (strict)**；确认源站证书有效后再切换。
- 暂时使用 Flexible 时，Cloudflare 到源站仍是明文 HTTP，但下面的来源白名单同样必做。

### G.2 先临时应用，再持久化

`origin-firewall.sh` 同时挂到 `INPUT` 与 `DOCKER-USER`；后者用于拦住会绕过
UFW/INPUT 的 Docker publish 流量。脚本不修改 SSH 或其它端口。

```bash
cd ~/manifold
sudo bash scripts/origin-firewall.sh --apply
sudo bash scripts/origin-firewall.sh --check
```

保持当前 SSH 会话，另开终端完成下一节验证。全部通过后再安装 systemd 持久化：

```bash
sudo bash scripts/origin-firewall.sh --install
systemctl status manifold-origin-firewall.service --no-pager
```

Cloudflare 公布网段变化时，以 <https://www.cloudflare.com/ips/> 为准更新脚本，
先 `--apply` 和回归，再提交并部署。

### G.3 正向与绕过验证

```powershell
# 正常域名仍须成功
curl.exe -fsS --max-time 10 https://zstuacm.xyz/health

# 强制绕开 DNS、直连源站；两条都必须超时或连接失败，不能返回 HTTP
curl.exe -I --connect-timeout 5 --resolve "zstuacm.xyz:80:<ORIGIN_IP>" http://zstuacm.xyz/health
curl.exe -kI --connect-timeout 5 --resolve "zstuacm.xyz:443:<ORIGIN_IP>" https://zstuacm.xyz/health

# SSH 必须仍可用
ssh manifold "true"
```

若正常域名失败，保持 SSH 会话并立即回滚实时规则：

```bash
sudo /usr/local/sbin/manifold-origin-firewall --disable 2>/dev/null \
  || sudo bash scripts/origin-firewall.sh --disable
sudo systemctl disable manifold-origin-firewall.service 2>/dev/null || true
```

---

## H. P0 最终 DoD 验证

逐条勾：

```
[ ] curl https://zstuacm.xyz/health = 200（经 Cloudflare）
[ ] 从非 Cloudflare 网络直连 <ORIGIN_IP>:80/443 超时或被过滤
[ ] scripts/origin-firewall.sh --check 同时通过 IPv4 / IPv6
[ ] SSH 管理端口仍可访问
[ ] backup.sh 跑一次，远端 rclone 推到位
[ ] DR 演练：另一台机器（或同台 ~/restore-test/）从今天备份能起出能用的栈
[ ] Kuma 加完 6 个探针，Telegram 收到测试告警；故意 docker stop sub2api，5min 内告警到
[ ] BetterStack/UptimeRobot 免费层探 /health 加上
[ ] runbook 里 8 条密钥轮换路径过一遍清单（不必都演练，但都通读一次确认无歧义）
```

---

## I. 上线后的"低头看"

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

## J. 常见踩坑

| 症状 | 原因 | 修 |
|---|---|---|
| `curl /health` 401 | 没经 caddy 直接打 sub2api，端口错 | 经域名打，或本机走 `127.0.0.1:8080` |
| LE 签证一直失败 | CF 在橙云 | DNS only 重试 |
| 备份成功但远端没传 | rclone 没 init / RCLONE_REMOTE 拼写错 | `rclone config` + `rclone ls <remote>` 验证 |
| docker compose 拉不到镜像 | digest 钉太死且镜像源被墙 | 服务器换上海 / 香港，或配 mirror |

---

> 真上线了 → 本 checklist 走完即可，无需额外记录。
