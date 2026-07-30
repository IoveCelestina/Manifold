#!/usr/bin/env bash
# Manifold 一键初始化（bash 版，对应 init.ps1）
#
# 用密码学安全随机数生成所有密钥并填充 deploy/.env。
# 不调任何 API，纯本地操作 —— 把 sub2api 起起来之前先跑这个。
#
# 用法：
#   scripts/init.sh                # 已存在的目标文件会逐个询问
#   scripts/init.sh --force        # 全部覆盖，不问
#
# 依赖：bash 4+、openssl、sed。Linux/macOS 通用。

set -euo pipefail

# Newly created secret files and temporary replacements are owner-only.
umask 077

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

# 解析自身所在目录，无论从哪里调用都能找到 deploy/
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/deploy"
[[ -d "$DEPLOY_DIR" ]] || { echo "找不到 deploy 目录: $DEPLOY_DIR" >&2; exit 1; }

command -v openssl >/dev/null || { echo "需要 openssl，请先安装" >&2; exit 1; }

# 生成 N 字节随机数的十六进制串（与 init.ps1 的 New-HexSecret 等价）
hex() { openssl rand -hex "$1"; }

confirm_overwrite() {
  local path="$1"
  [[ -e "$path" ]] || return 0
  [[ "$FORCE" -eq 1 ]] && return 0
  read -r -p "[$path] 已存在，覆盖？(y/N) " resp
  [[ "$resp" == "y" || "$resp" == "Y" ]]
}

# 替换 KEY=VAL 形式的一行；只改第一处匹配。
# 全程由 bash 写入，避免把密钥放进 sed/awk 的进程参数。
set_env_value() {
  local file="$1" key="$2" value="$3"
  local line found=0 tmp
  tmp="$(mktemp "${file}.tmp.XXXXXX")"

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$found" -eq 0 && "$line" == "${key}="* ]]; then
      printf '%s=%s\n' "$key" "$value" >>"$tmp"
      found=1
    else
      printf '%s\n' "$line" >>"$tmp"
    fi
  done <"$file"

  if [[ "$found" -ne 1 ]]; then
    rm -f "$tmp"
    echo "模板里没有 $key= 这一行：$file" >&2
    exit 1
  fi

  chmod 600 "$tmp"
  mv -f "$tmp" "$file"
}

# ─── deploy/.env ───────────────────────────────────────────
ENV_TARGET="$DEPLOY_DIR/.env"
ENV_TEMPLATE="$DEPLOY_DIR/.env.example"
[[ -f "$ENV_TEMPLATE" ]] || { echo "找不到 $ENV_TEMPLATE" >&2; exit 1; }

if confirm_overwrite "$ENV_TARGET"; then
  # 仅在确定写文件后生成，避免无用密钥留在进程内存中。
  POSTGRES_PASSWORD=$(hex 24)
  JWT_SECRET=$(hex 32)
  TOTP_ENCRYPTION_KEY=$(hex 32)
  REDIS_PASSWORD=$(hex 24)
  ADMIN_PASSWORD=$(hex 12)

  cp "$ENV_TEMPLATE" "$ENV_TARGET"
  chmod 600 "$ENV_TARGET"
  set_env_value "$ENV_TARGET" POSTGRES_PASSWORD   "$POSTGRES_PASSWORD"
  set_env_value "$ENV_TARGET" JWT_SECRET          "$JWT_SECRET"
  set_env_value "$ENV_TARGET" TOTP_ENCRYPTION_KEY "$TOTP_ENCRYPTION_KEY"
  set_env_value "$ENV_TARGET" REDIS_PASSWORD      "$REDIS_PASSWORD"
  set_env_value "$ENV_TARGET" ADMIN_PASSWORD      "$ADMIN_PASSWORD"
  echo "[OK] $ENV_TARGET"
else
  echo "[SKIP] $ENV_TARGET"
fi

# Existing files are tightened too, including when overwrite was declined.
[[ -f "$ENV_TARGET" ]] && chmod 600 "$ENV_TARGET"

echo ""
echo "管理员凭据已写入 $ENV_TARGET（权限 600；密码不会输出到终端）。"
echo ""
echo "下一步："
echo "  cd deploy"
echo "  docker compose up -d"
echo "  # 等 sub2api 健康检查通过后浏览器开 http://127.0.0.1:8080"
echo ""
