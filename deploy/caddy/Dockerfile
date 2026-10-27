# Official Caddy release, rebuilt with the patched Go runtime.
FROM golang@sha256:d530cf60723abf1ffae0cd16bb546b379ec0550d2f3815e5b16ed69dbc00fba4 AS builder
ENV GOMAXPROCS=2 GOMEMLIMIT=1GiB GOFLAGS=-p=2
RUN apk add --no-cache git ca-certificates
RUN GOBIN=/usr/local/bin go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7
RUN xcaddy build v2.11.7 --output /usr/bin/caddy

FROM caddy@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
RUN caddy version
