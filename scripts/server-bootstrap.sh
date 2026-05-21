#!/usr/bin/env bash
# Manifold 服务器一键加固脚本（Debian / Ubuntu）
#
# 设计目标：租到一台干净 VPS 后跑一次，把这台机器从"裸 SSH+密码"调成
# "只允许 key 登录 + ufw 防火墙 + fail2ban + 自动安全补丁 + 装好 docker"。
#
# 用法（在 VPS 上，以 root 或 sudo 用户身份）：
#   sudo bash scripts/server-bootstrap.sh                    # 用默认参数跑
#   sudo bash scripts/server-bootstrap.sh --ssh-port 2200    # 改 SSH 端口
#   sudo bash scripts/server-bootstrap.sh --dry-run          # 不动文件，只打印会做什么
#
# 退出码：
#   0 成功；1 通用错误；2 参数错误；3 安全前置检查失败（如禁密码前无 key）

set -euo pipefail

# ─── 默认参数 ────────────────────────────────────────────────
SSH_PORT=22                # 不改 SSH 端口的话默认 22；建议改成 1024-65535 间不常用端口
DRY_RUN=0
SKIP_DOCKER=0
ALLOW_ROOT_SSH=0           # 默认禁 root SSH 登录；--allow-root-ssh 才放行（仅 PubkeyAuth）
TARGET_USER=""             # --user 指定要保留 key 登录权限的非 root 用户

# ─── 参数解析 ────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssh-port)        SSH_PORT="$2"; shift 2 ;;
    --dry-run)         DRY_RUN=1; shift ;;
    --skip-docker)     SKIP_DOCKER=1; shift ;;
    --allow-root-ssh)  ALLOW_ROOT_SSH=1; shift ;;
    --user)            TARGET_USER="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

# ─── helpers ────────────────────────────────────────────────
log()  { printf '\033[1;36m[+]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; }

run() {
  # 统一通过这个跑命令，--dry-run 时只打印不执行
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '   DRY: %s\n' "$*"
  else
    "$@"
  fi
}

require_root() {
  if [[ "$EUID" -ne 0 ]]; then
    err "需要 root 权限：sudo bash $0 $*"
    exit 1
  fi
}

require_debian_family() {
  if [[ ! -f /etc/os-release ]]; then
    err "/etc/os-release 不存在，无法识别发行版"
    exit 1
  fi
  # shellcheck source=/dev/null
  . /etc/os-release
  case "${ID_LIKE:-} ${ID:-}" in
    *debian*|*ubuntu*) ;;
    *) err "仅支持 Debian/Ubuntu 系（当前 ID=${ID:-?})"; exit 1 ;;
  esac
  log "OS: ${PRETTY_NAME:-?}"
}

# 在禁密码登录前必须先确认有人持有 key —— 否则改完没人能再登进来
require_authorized_keys() {
  local user="$1" home keypath
  home=$(getent passwd "$user" | cut -d: -f6)
  if [[ -z "$home" || ! -d "$home" ]]; then
    err "用户 $user 不存在或没有 home 目录"
    return 1
  fi
  keypath="$home/.ssh/authorized_keys"
  if [[ ! -s "$keypath" ]]; then
    err "$keypath 不存在或为空 —— 禁密码登录会把你自己锁在门外"
    err "解决：先在另一台机器跑 ssh-copy-id ${user}@<server> 把 key 推上来"
    return 1
  fi
  log "$user 已有 authorized_keys（$(wc -l < "$keypath") 条），安全"
}

# ─── 0. 前置检查 ─────────────────────────────────────────────
require_root "$@"
require_debian_family

# 决定要保护谁的 SSH key 登录权限
if [[ -z "$TARGET_USER" ]]; then
  # 默认取 SUDO_USER（即调用 sudo 的那个非 root 用户）
  TARGET_USER="${SUDO_USER:-root}"
fi
log "目标用户：$TARGET_USER"

if ! require_authorized_keys "$TARGET_USER"; then
  exit 3
fi

# SSH 端口范围
if ! [[ "$SSH_PORT" =~ ^[0-9]+$ ]] || (( SSH_PORT < 1 || SSH_PORT > 65535 )); then
  err "--ssh-port 必须是 1-65535 的整数（当前: $SSH_PORT）"
  exit 2
fi

# ─── 1. apt 更新 + 装基础包 ───────────────────────────────────
log "apt update + 安装基础工具..."
export DEBIAN_FRONTEND=noninteractive
run apt-get update -qq
run apt-get install -y -qq \
  ufw fail2ban unattended-upgrades apt-listchanges \
  curl ca-certificates gnupg lsb-release \
  vim htop tmux jq

# ─── 2. ufw 防火墙 ──────────────────────────────────────────
log "配置 ufw：deny incoming / allow outgoing / 允许 $SSH_PORT、80、443..."
run ufw --force reset >/dev/null   # 重置规则，幂等
run ufw default deny incoming
run ufw default allow outgoing
run ufw allow "$SSH_PORT"/tcp comment 'SSH'
run ufw allow 80/tcp   comment 'HTTP (Caddy will redirect to 443)'
run ufw allow 443/tcp  comment 'HTTPS'
run ufw --force enable

# ─── 3. fail2ban ────────────────────────────────────────────
log "配置 fail2ban sshd jail..."
JAIL_LOCAL=/etc/fail2ban/jail.local
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "   DRY: 会写 $JAIL_LOCAL，端口 $SSH_PORT"
else
  cat > "$JAIL_LOCAL" <<EOF
# Manifold server-bootstrap.sh 生成 —— 保留可改
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port    = $SSH_PORT
backend = systemd
EOF
fi
run systemctl enable --now fail2ban
run systemctl restart fail2ban

# ─── 4. unattended-upgrades 自动安全补丁 ───────────────────
log "启用 unattended-upgrades（仅 security 通道）..."
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "   DRY: 写 /etc/apt/apt.conf.d/20auto-upgrades + 50unattended-upgrades.local"
else
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade   "1";
APT::Periodic::AutocleanInterval    "7";
EOF
  # 重启策略：不自动重启（避免半夜服务断），用户手动决定
  cat > /etc/apt/apt.conf.d/50unattended-upgrades.local <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
fi
run systemctl enable --now unattended-upgrades

# ─── 5. SSH 加固 ────────────────────────────────────────────
# 思路：所有 Manifold 的改动都写到 /etc/ssh/sshd_config.d/ 下的独立片段，
# 不动主 sshd_config，方便以后回滚和发行版升级。
SSHD_DROPIN=/etc/ssh/sshd_config.d/99-manifold.conf
log "写 SSH 加固片段 $SSHD_DROPIN..."

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "   DRY: PasswordAuthentication no / PermitRootLogin $([[ $ALLOW_ROOT_SSH -eq 1 ]] && echo prohibit-password || echo no) / Port $SSH_PORT"
else
  PERMIT_ROOT="no"
  (( ALLOW_ROOT_SSH == 1 )) && PERMIT_ROOT="prohibit-password"

  cat > "$SSHD_DROPIN" <<EOF
# Manifold server-bootstrap.sh 生成；如需回滚直接删除本文件并重启 sshd。
Port $SSH_PORT
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin $PERMIT_ROOT
PubkeyAuthentication yes
UsePAM yes
EOF

  # 改完立刻校验语法，错了立刻删除片段以免下次重启 sshd 起不来
  if ! sshd -t 2>/tmp/sshd-test.err; then
    err "sshd -t 校验失败：$(cat /tmp/sshd-test.err)"
    err "已删除 $SSHD_DROPIN，请人工排查"
    rm -f "$SSHD_DROPIN"
    exit 1
  fi
fi

# SELinux/SSH 端口策略：Debian/Ubuntu 默认不带 SELinux semanage，所以仅 ufw 放行即可
run systemctl reload ssh || run systemctl reload sshd

# ─── 6. Docker engine + compose plugin ─────────────────────
if [[ "$SKIP_DOCKER" -eq 1 ]]; then
  log "--skip-docker 跳过 docker 安装"
else
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    log "docker + compose plugin 已就位（$(docker --version)）"
  else
    log "安装 docker（官方仓库）..."
    run install -m 0755 -d /etc/apt/keyrings
    if [[ "$DRY_RUN" -eq 0 ]]; then
      # ID 在 require_debian_family 里被 source 过来了
      curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
        | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
      chmod a+r /etc/apt/keyrings/docker.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/${ID} $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list
    fi
    run apt-get update -qq
    run apt-get install -y -qq \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    run systemctl enable --now docker
    # 把目标用户加 docker 组，免每次 sudo
    if [[ "$TARGET_USER" != "root" ]]; then
      run usermod -aG docker "$TARGET_USER"
      warn "$TARGET_USER 已加 docker 组，需要重新登录才生效"
    fi
  fi
fi

# ─── 7. sanity check ────────────────────────────────────────
echo ""
log "===== sanity check ====="
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "（dry-run 模式，不实际检查）"
  exit 0
fi

ufw status verbose | head -20
echo ""
systemctl is-active fail2ban   && echo "  fail2ban: active"
systemctl is-active unattended-upgrades && echo "  unattended-upgrades: active"
systemctl is-active ssh 2>/dev/null \
  || systemctl is-active sshd 2>/dev/null \
  && echo "  ssh: active"
[[ "$SKIP_DOCKER" -eq 0 ]] && (systemctl is-active docker && echo "  docker: active")

echo ""
log "完成。建议立刻在 *另一个终端* 用 key 登录确认能进来再断当前会话："
echo "    ssh -p $SSH_PORT $TARGET_USER@<server-ip>"
echo ""
warn "如果改了 SSH 端口，记得在本机 ~/.ssh/config 加："
echo "    Host manifold"
echo "      HostName <server-ip>"
echo "      Port     $SSH_PORT"
echo "      User     $TARGET_USER"
