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
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
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

如果只改了 `deploy/Caddyfile`，无需重启整个栈：

```bash
cd deploy
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```
