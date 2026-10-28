# Build v0.18.0 with reasoning effort routing and Claude Code tool compatibility.
# Source commit/archive and build/runtime images are pinned for reproducibility.
FROM golang@sha256:d200d2dd76b03a99b52651fd1325aff7dcd35422c35c01bac56571b0507f3deb AS builder
ENV GOMAXPROCS=2
WORKDIR /src
ADD --checksum=sha256:307c5bc4664d2a77fbddbed2fb0c963b3413d66ca3544b75d2b901f750d9a891 https://codeload.github.com/WncFht/devin2api/tar.gz/989c80ce6dc9ffb46b23d7eac98c34fc98f3a2eb /tmp/source.tar.gz
RUN tar -xzf /tmp/source.tar.gz --strip-components=1 -C /src
COPY reasoning-effort.patch schedule-wakeup.patch /tmp/
RUN apk add --no-cache patch \
    && patch -p1 < /tmp/reasoning-effort.patch \
    && patch -p1 < /tmp/schedule-wakeup.patch
RUN go mod download
RUN CGO_ENABLED=0 go test ./internal/api/... ./internal/adapter/devin/... ./internal/app/... ./internal/llm/... ./internal/debuglog/...
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.version=v0.18.0-manifold-effort.2" -o /out/devin-2api ./cmd/devin-2api

# Retain the deployed runtime base, replacing only the executable.
FROM ghcr.io/wncfht/devin2api@sha256:ae8db9975e7ef445b14950f80a70ed153e31eeef4dc9c54505881126e8dc66c7
ARG MANIFOLD_REVISION=local
LABEL org.opencontainers.image.revision=$MANIFOLD_REVISION
COPY --from=builder --chmod=0755 /out/devin-2api /app/devin-2api
RUN chmod 0755 /app/devin-2api && /app/devin-2api -version
