#!/usr/bin/env bash
# Manifold 一键初始化（bash 版，对应 init.ps1）
#
# 用密码学安全随机数生成所有密钥并填充 deploy/.env 与 deploy/cpa-*/config.yaml。
# 不调任何 API，纯本地操作 —— 把 sub2api / CPA 起起来之前先跑这个。
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

# ─── 3. 每个 CPA 实例的 config.yaml ─────────────────────────
# 自动发现 deploy/cpa-* 目录，免得加新实例还得改脚本
declare -a CPA_SECRETS_REPORT=()
shopt -s nullglob
for dir in "$DEPLOY_DIR"/cpa-*/; do
  cpa_name="$(basename "$dir")"           # e.g. cpa-1
  n="${cpa_name#cpa-}"                    # e.g. 1
  tmpl="${dir}config.example.yaml"
  target="${dir}config.yaml"

  if [[ ! -f "$tmpl" ]]; then
    echo "模板缺失，跳过: $tmpl" >&2
    continue
  fi

  secret=$(hex 32)
  placeholder="REPLACE_WITH_INTERNAL_SHARED_SECRET_${n}"

  if confirm_overwrite "$target"; then
    # 用 awk 做字面替换，避开 sed 对 & 等元字符的特殊处理
    awk -v p="$placeholder" -v s="$secret" \
        '{ gsub(p, s); print }' "$tmpl" > "$target"
    echo "[OK] $target"
    CPA_SECRETS_REPORT+=("  $cpa_name 内网共享秘钥    : $secret")
  else
    echo "[SKIP] $target"
  fi
done
shopt -u nullglob

# ─── 4. 打印关键凭据 ───────────────────────────────────────
admin_email=$(grep -E '^ADMIN_EMAIL=' "$ENV_TARGET" | head -n1 | cut -d= -f2-)

echo ""
echo "=== 关键凭据（请妥善保存，下次脚本可能覆盖）==="
echo "  Admin email           : $admin_email"
echo "  Admin password        : $ADMIN_PASSWORD"
for line in "${CPA_SECRETS_REPORT[@]}"; do
  echo "$line"
done
echo ""
echo "下一步："
echo "  cd deploy"
echo "  docker compose up -d"
echo "  # 等 sub2api 健康检查通过后浏览器开 http://127.0.0.1:8080 用上面 admin 账号登录"
echo "  docker compose exec cpa-1 ./CLIProxyAPI login --provider claude"
echo "  docker compose exec cpa-2 ./CLIProxyAPI login --provider claude"
echo "  # 然后在 sub2api 后台把 cpa-1:8317 / cpa-2:8317 添加为 OpenAI 兼容上游账号"
echo "  # 上游 API Key 分别填上面的两个 CPA 内网共享秘钥"
echo ""
