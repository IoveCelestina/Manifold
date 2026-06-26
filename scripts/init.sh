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
# 依赖：bash 4+、openssl、sed、grep。Linux/macOS 通用。

set -euo pipefail

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

# 替换 KEY=VAL 形式的一行；只改第一处匹配。VAL 通过 sed 的替换分隔符 | 写入，
# 因此密钥本身（纯十六进制）不会和分隔符冲突。
set_env_value() {
  local file="$1" key="$2" value="$3"
  # 找不到该 key 就当模板坏了，直接报错而不是悄悄追加
  grep -qE "^${key}=" "$file" || { echo "模板里没有 $key= 这一行：$file" >&2; exit 1; }
  sed -i.bak -E "s|^${key}=.*|${key}=${value}|" "$file"
  rm -f "${file}.bak"
}

# ─── 1. 生成全部密钥（字节数与 init.ps1 对齐） ─────────────────
POSTGRES_PASSWORD=$(hex 24)
JWT_SECRET=$(hex 32)
TOTP_ENCRYPTION_KEY=$(hex 32)
REDIS_PASSWORD=$(hex 24)
ADMIN_PASSWORD=$(hex 12)

# ─── 2. deploy/.env ────────────────────────────────────────
ENV_TARGET="$DEPLOY_DIR/.env"
ENV_TEMPLATE="$DEPLOY_DIR/.env.example"
[[ -f "$ENV_TEMPLATE" ]] || { echo "找不到 $ENV_TEMPLATE" >&2; exit 1; }

if confirm_overwrite "$ENV_TARGET"; then
  cp "$ENV_TEMPLATE" "$ENV_TARGET"
  set_env_value "$ENV_TARGET" POSTGRES_PASSWORD   "$POSTGRES_PASSWORD"
  set_env_value "$ENV_TARGET" JWT_SECRET          "$JWT_SECRET"
  set_env_value "$ENV_TARGET" TOTP_ENCRYPTION_KEY "$TOTP_ENCRYPTION_KEY"
  set_env_value "$ENV_TARGET" REDIS_PASSWORD      "$REDIS_PASSWORD"
  set_env_value "$ENV_TARGET" ADMIN_PASSWORD      "$ADMIN_PASSWORD"
  echo "[OK] $ENV_TARGET"
else
  echo "[SKIP] $ENV_TARGET"
fi

# ─── 3. 打印关键凭据 ───────────────────────────────────────
admin_email=$(grep -E '^ADMIN_EMAIL=' "$ENV_TARGET" | head -n1 | cut -d= -f2-)

echo ""
echo "=== 关键凭据（请妥善保存，下次脚本可能覆盖）==="
echo "  Admin email           : $admin_email"
echo "  Admin password        : $ADMIN_PASSWORD"
echo ""
echo "下一步："
echo "  cd deploy"
echo "  docker compose up -d"
echo "  # 等 sub2api 健康检查通过后浏览器开 http://127.0.0.1:8080 用上面 admin 账号登录"
echo ""
