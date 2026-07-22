# 博客部署

博客源码位于 `blog/`，由 `deploy/docker-compose.yml` 构建为 `manifold-blog`，再由 Caddy 将 `blog.zstuacm.xyz` 反向代理到容器的 `3000` 端口。

## 本地验证

```bash
cd blog
npm ci
npm test
```

## 首次部署

1. 将 `blog.zstuacm.xyz` 的 DNS 指向 Manifold 服务器，并确认 80/443 端口可访问。
2. 在服务器更新主仓库。
3. 构建博客并重载 Caddy：

```bash
git pull --ff-only
cd deploy
docker compose build blog
docker compose up -d blog
docker compose up -d --force-recreate caddy
docker compose ps blog caddy
```

验证：

```bash
curl -fsS http://127.0.0.1 -H 'Host: blog.zstuacm.xyz' >/dev/null
curl -fsS https://blog.zstuacm.xyz/ >/dev/null
curl -fsS https://blog.zstuacm.xyz/posts/algorithm-templates >/dev/null
```

## 后续更新

博客内容提交到 Manifold 主仓库后，在服务器执行：

```bash
git pull --ff-only
cd deploy
docker compose up -d --build blog
```

如果通过 `git pull` 更新了 `deploy/Caddyfile`，只需重建 Caddy，不必重启其他服务：

```bash
cd deploy
docker compose up -d --force-recreate caddy
```

原因是 Git 可能通过替换文件 inode 完成更新，旧容器的只读 bind mount 仍指向更新前的文件；单纯执行 `caddy reload` 不一定会读取到新配置。
