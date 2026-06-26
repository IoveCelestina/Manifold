# 备份与恢复

DoD：**另一台机器上，能用昨天的备份重建出能用的 sub2api**。

## 备份内容

| 文件 | 内容 | 丢了的后果 |
|---|---|---|
| `postgres.dump` | sub2api 全库 | 全员数据没了 |
| `configs/.env` | JWT/TOTP/postgres 密码 | 所有用户登录态 + 2FA 失效 |
| `data/sub2api/` | sub2api 自带数据 | 不确定，安全起见包进来 |

**不备份**：`data/postgres/`（pg_dump 代替）、`data/redis/`（可重建）。

## 一次性准备

### 1. 装工具

```bash
# Linux
sudo apt install gpg rclone tar

# Windows / pwsh
winget install GnuPG.GnuPG
winget install Rclone.Rclone
# tar 是 Win10+ 自带
```

### 2. 建一对 GPG key

```bash
# 1) 生成主钥（GPG 2.5+ 默认主钥是 [SC] 只能签名，不能加密 —— 第 2 步必须做）
gpg --batch --pinentry-mode loopback --passphrase '' \
    --quick-generate-key "manifold-backup@yourdomain.com" rsa4096 default 5y

# 2) 找出 KeyID 并补一把加密子钥
gpg --list-keys                              # 记下 fingerprint
gpg --batch --pinentry-mode loopback --passphrase '' \
    --quick-add-key <FINGERPRINT> rsa4096 encr 5y

# 3) 导出
gpg --export-secret-keys --armor <FINGERPRINT> > manifold-backup-private.asc   # 立刻找安全地方收好
gpg --export --armor <FINGERPRINT> > manifold-backup-public.asc                # 这个上服务器
```

验证 key 有 `[E]` 加密能力：

```
pub   rsa4096 [SC] ...
sub   rsa4096 [E] ...    ← 必须有这一行
```

**关键**：私钥不能只放服务器自己上。**至少两份独立保管**（密码管理器 + 离线 U 盘 / 第二台机器）。备份机丢了 = 备份全废。

### 3. 配 rclone 异地存储桶

```bash
rclone config
# 推荐：Backblaze B2 (S3 兼容、便宜)，或者 Cloudflare R2 (零出口费)
# 别用 Google Drive / Dropbox，限速不稳定
```

测试一下：

```bash
rclone copy README.md b2:manifold-backups/test.txt
rclone lsf b2:manifold-backups/
rclone deletefile b2:manifold-backups/test.txt
```

## 跑备份

### Linux / WSL

```bash
GPG_RECIPIENT=manifold-backup@yourdomain.com \
RCLONE_REMOTE=b2:manifold-backups \
./scripts/backup.sh
```

### Windows / pwsh 7+

```powershell
.\scripts\backup.ps1 `
    -GpgRecipient 'manifold-backup@yourdomain.com' `
    -RcloneRemote 'b2:manifold-backups'
```

输出最后一行是新备份的绝对路径，可以 capture 给上游脚本用。

## 自动化调度

### Linux cron

```cron
# 每天 03:00 跑全量备份；失败用邮件告警
0 3 * * * cd /opt/manifold && GPG_RECIPIENT=... RCLONE_REMOTE=... ./scripts/backup.sh >> /var/log/manifold-backup.log 2>&1
```

### Windows 任务计划

```powershell
# 跑一次创建每日任务
$action  = New-ScheduledTaskAction -Execute 'pwsh' -Argument '-File C:\path\to\Manifold\scripts\backup.ps1 -GpgRecipient ... -RcloneRemote ...'
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName 'ManifoldBackup' -Action $action -Trigger $trigger -RunLevel Highest
```

## 恢复

### 场景 A：在新机器上从异地备份重建

```bash
# 1. clone 仓库
git clone https://your-repo/manifold.git && cd manifold

# 2. 装好 docker / gpg / rclone / tar，并导入 GPG 私钥
gpg --import manifold-backup-private.asc

# 3. 配好 rclone remote（同上）

# 4. 列出可选的备份
rclone lsf b2:manifold-backups/ | sort -r | head

# 5. 跑恢复（全新机器走默认路径）
RCLONE_REMOTE=b2:manifold-backups ./scripts/restore.sh manifold-2026-05-20T03-00-00.tar.gz.gpg
```

`restore.sh` / `restore.ps1` 会：
1. 拉取 + 解密 + 解包
2. 还原配置
3. `docker compose up -d postgres`
4. `pg_restore --clean --if-exists` 灌库
5. `docker compose up -d` 起完整栈
6. 等 sub2api healthcheck 通过

### 场景 B：在现有环境上回滚（危险）

```bash
./scripts/restore.sh --force --yes /path/to/backup.tar.gz.gpg
```

会先 `docker compose down -v` 清旧卷再恢复。**之前的数据全没**，慎用。

## DR 演练（每月一次必做）

backup 跑得通不代表能恢复。每月在干净环境实测一次：

- [ ] 找另一台机器（或本机另一个目录 clone 一份）
- [ ] 装好 docker / gpg / rclone
- [ ] 导入 GPG 私钥
- [ ] 跑 `restore.sh` 拉最近一份
- [ ] 用 admin 账号登录 sub2api 后台，确认用户列表 / 余额 / API key 都在
- [ ] 用其中一个 user key 跑一次真实的 `/v1/messages` 请求验证上游通

任何一步挂了 = 备份策略破洞，立刻修。

## 密钥轮换

完整可执行步骤见 [docs/runbook.md](runbook.md)，覆盖 POSTGRES_PASSWORD / REDIS_PASSWORD / JWT_SECRET / TOTP_ENCRYPTION_KEY（⚠ 不可换）/ ADMIN_PASSWORD / GPG 备份密钥。
