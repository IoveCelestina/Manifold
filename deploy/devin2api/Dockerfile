# devin2api 0.18.0 官方发布镜像（ghcr.io/wncfht/devin2api:0.18.0，2026-10-27 取的 digest）。
# 该镜像里 /app/devin-2api 缺执行位（-rw-r--r--，上游 Dockerfile.release 从 CI artifact
# 拷贝二进制时丢了权限），直接用会报 exec permission denied。这里只补执行位，别的不动。
# 升级：换下面的 digest，同步改 docker-compose.yml 里的 image tag，再 docker compose build devin2api。
FROM ghcr.io/wncfht/devin2api@sha256:ae8db9975e7ef445b14950f80a70ed153e31eeef4dc9c54505881126e8dc66c7
RUN chmod 0755 /app/devin-2api && /app/devin-2api -version
