# 域名更新

两个入口共用服务器上的 Bash 实现：

- `scripts/update-domains.sh`：在 Linux 服务器运行。
- `scripts/update-domains.ps1`：在本地 Windows 通过 SSH 调用服务器脚本，默认 `manifold:/opt/manifold`。

日常使用 `--add` / `-Add` 增加域名，`--remove` / `-Remove` 删除域名；脚本读取服务器当前 `.env`，自动保留其他域名，不需要手动重填完整列表。每个主域名及其 `www`、`chat`、`blog` 一起增删，多个域名用逗号分隔。

添加的新域名追加到列表末尾，原主域名保持不变；删除主域名后，剩余列表中的第一个成为主域名，用于博客分享图片等绝对链接。至少保留一个域名，但可以在同一次操作中删除全部旧域名并添加新域名。重复添加或删除不存在的域名会跳过；如果结果不变，不写配置、不重启服务。同一个域名不能同时添加和删除。

`--domains` / `-Domains` 保留为高级用法：整体替换全部域名，不能与增删参数同用。`--list` / `-List` 查看当前域名与主域名。所有域名同时提供服务，不做重定向。

## 先准备 DNS

为每个主域名及 `www`、`chat`、`blog` 配置指向当前服务器的 DNS。沿用项目的 Cloudflare 橙云与 Full (strict) 设置。脚本管理本机服务配置，不修改 DNS、注册商、邮件地址、历史文档，或第三方后台中的 OAuth/支付回调地址。

新域名上的浏览器登录状态需要重新建立。若配置过第三方回调地址，应同步到对应后台；它们不是 Caddy 域名列表的一部分。

服务器需先取得包含新脚本、Caddyfile、Compose 和博客配置的仓库版本：

```bash
cd /opt/manifold
git pull --ff-only
```

## 在服务器运行

```bash
# 查看当前域名
bash scripts/update-domains.sh --list

# 预览增加一个域名；保留其他域名
bash scripts/update-domains.sh --add new.example.com --dry-run
bash scripts/update-domains.sh --add new.example.com --deploy

# 删除一个域名及其 www/chat/blog 入口
bash scripts/update-domains.sh --remove old.example.com --deploy

# 一次增加和删除多个域名
bash scripts/update-domains.sh --add new.example.com,second.example.com --remove old.example.com --deploy
```

默认只预览，`--deploy` 才备份、写配置并部署。`--root /opt/manifold` 可以指定仓库目录。脚本需要 Bash 4+ 和 `flock`；部署模式还需要支持 `--wait` 的 Docker Compose v2、支持 `--retry-all-errors` 的 curl 和现有的 `manifold-caddy` / `manifold-blog` 容器。

## 在本地 Windows 运行

```powershell
./scripts/update-domains.ps1 -List
./scripts/update-domains.ps1 -Add new.example.com -DryRun
./scripts/update-domains.ps1 -Add new.example.com -Deploy
./scripts/update-domains.ps1 -Remove old.example.com -Deploy
./scripts/update-domains.ps1 -Add new.example.com,second.example.com -Remove old.example.com -Deploy

# 自定义服务器与目录，并在执行前更新服务器仓库
./scripts/update-domains.ps1 -Add new.example.com -Deploy -Pull `
  -SshHost deploy@server.example.com -RemoteDir /opt/manifold
```

`SSH_HOST`、`DEPLOY_DIR` 可分别提供服务器和目录的默认值。本地脚本也默认只预览，`-Deploy` 才应用域名。它不提交或推送 Git；`-Pull` 只在服务器执行 `git pull --ff-only`。`-DryRun` 不能与 `-Pull` 同用。SSH 使用已有密钥且不交互询问密码。

## 执行过程与回滚

脚本检查域名格式、重复域名及主站/子站冲突，再将五个运行配置写入 `.env`：

| 配置 | 作用 |
| --- | --- |
| `SITE_DOMAINS` | 主站与 www 的 Caddy 入口 |
| `CHAT_DOMAINS` | chat 的 Caddy 入口 |
| `BLOG_DOMAINS` | blog 的 Caddy 入口 |
| `BLOG_TRUSTED_HOSTS` | 博客允许的 Host 列表 |
| `BLOG_SITE_URL` | 博客分享链接的主地址 |

首次运行且 `.env` 未设置域名时，从 Caddyfile 默认值读取当前 `zstuacm.xyz` 和 `zstu.asia` 的双域名配置。后续增删从 `.env` 的 `SITE_DOMAINS` 主域名/www 配对列表恢复当前集合，并保留 `BLOG_SITE_URL` 指定的主域名。若手工写过不同结构的映射，脚本停止并提示使用 `--domains` 明确设置完整列表，避免错误推断。旧的 `DOMAIN` 字段不再参与路由。域名配置不改 Git 跟踪的文件，也不会被后续 `git pull` 覆盖。

部署模式先校验候选 Compose 和 Caddy 配置、构建博客，再重建 **blog 与 caddy**；`--no-deps` 避免连带重建网关或数据库。入口会短暂中断。之后逐一检查主站/WWW 的 `/health`、chat 的 `/api/session/me`、blog 首页，同时验证本机源站 HTTPS 与公网 HTTPS。

备份目录为 `backups/domains-<UTC时间>-<随机后缀>/`，仅当前用户可读。`previous.env` 保存执行前配置，`candidate.env` 保存目标配置；两者含密钥，不能上传或提交。现有 `.env` 不会被当作 shell 脚本执行。发现 Compose override 文件时停止，避免遗漏生产定制配置。

校验/构建失败时，当前 `.env` 与运行容器不变。应用后的重建或访问检查失败时，脚本尝试恢复原 `.env` 和原博客镜像，并以非零状态退出；回滚失败会明确提示备份路径。若公网 DNS 或证书尚未就绪，也会触发回滚，修好后重新执行。

手动恢复配置：

```bash
cp backups/domains-<时间>-<后缀>/previous.env deploy/.env
chmod 600 deploy/.env
cd deploy
docker compose up -d --no-deps --force-recreate --no-build --wait blog caddy
```

脚本不清理证书存储或业务数据。更换域名不会更换 JWT、数据库密码或管理员凭据。
