#!/usr/bin/env bash
# Restrict Manifold's public origin ports to Cloudflare's published networks.
#
# The same policy is attached to INPUT and DOCKER-USER because Docker-published
# ports can bypass host INPUT/UFW rules. SSH and all non-web ports are untouched.

set -euo pipefail

readonly CHAIN_NAME="MANIFOLD_CF_ORIGIN"
readonly INSTALL_PATH="/usr/local/sbin/manifold-origin-firewall"
readonly UNIT_NAME="manifold-origin-firewall.service"
readonly UNIT_PATH="/etc/systemd/system/${UNIT_NAME}"

# Source: https://www.cloudflare.com/ips/ (verified 2026-08-11).
readonly -a CF_IPV4=(
  "173.245.48.0/20"
  "103.21.244.0/22"
  "103.22.200.0/22"
  "103.31.4.0/22"
  "141.101.64.0/18"
  "108.162.192.0/18"
  "190.93.240.0/20"
  "188.114.96.0/20"
  "197.234.240.0/22"
  "198.41.128.0/17"
  "162.158.0.0/15"
  "104.16.0.0/13"
  "104.24.0.0/14"
  "172.64.0.0/13"
  "131.0.72.0/22"
)

readonly -a CF_IPV6=(
  "2400:cb00::/32"
  "2606:4700::/32"
  "2803:f800::/32"
  "2405:b500::/32"
  "2405:8100::/32"
  "2a06:98c0::/29"
  "2c0f:f248::/32"
)

log() {
  printf '[origin-firewall] %s\n' "$*"
}

die() {
  printf '[origin-firewall] ERROR: %s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || die "must run as root (use sudo)"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

detect_interface() {
  local interface="${MANIFOLD_ORIGIN_INTERFACE:-}"

  if [[ -z "$interface" ]]; then
    interface="$(ip -4 route show default | awk 'NR == 1 { print $5 }')"
  fi

  [[ -n "$interface" ]] || die "could not detect the public interface; set MANIFOLD_ORIGIN_INTERFACE"
  [[ "$interface" =~ ^[A-Za-z0-9_.:-]+$ ]] || die "invalid interface name: $interface"
  ip link show dev "$interface" >/dev/null 2>&1 || die "interface does not exist: $interface"
  printf '%s\n' "$interface"
}

preflight() {
  require_root
  require_command ip
  require_command iptables
  require_command ip6tables

  local binary parent
  for binary in iptables ip6tables; do
    for parent in INPUT DOCKER-USER; do
      "$binary" -w 5 -S "$parent" >/dev/null 2>&1 ||
        die "$binary $parent chain is missing; start Docker before applying the policy"
    done
  done
}

ensure_hook() {
  local binary="$1" parent="$2"
  if ! "$binary" -w 5 -C "$parent" -j "$CHAIN_NAME" >/dev/null 2>&1; then
    "$binary" -w 5 -I "$parent" 1 -j "$CHAIN_NAME"
  fi
}

configure_family() {
  local binary="$1" interface="$2"
  local -a networks=()
  local network

  if [[ "$binary" == "iptables" ]]; then
    networks=("${CF_IPV4[@]}")
  else
    networks=("${CF_IPV6[@]}")
  fi

  if ! "$binary" -w 5 -S "$CHAIN_NAME" >/dev/null 2>&1; then
    "$binary" -w 5 -N "$CHAIN_NAME"
  fi
  "$binary" -w 5 -F "$CHAIN_NAME"

  for network in "${networks[@]}"; do
    "$binary" -w 5 -A "$CHAIN_NAME" -i "$interface" -p tcp \
      -m multiport --dports 80,443 -s "$network" -j ACCEPT
  done

  "$binary" -w 5 -A "$CHAIN_NAME" -i "$interface" -p tcp \
    -m multiport --dports 80,443 -j DROP
  "$binary" -w 5 -A "$CHAIN_NAME" -i "$interface" -p udp \
    --dport 443 -j DROP
  "$binary" -w 5 -A "$CHAIN_NAME" -j RETURN

  ensure_hook "$binary" INPUT
  ensure_hook "$binary" DOCKER-USER
}

check_family() {
  local binary="$1" interface="$2"
  local -a networks=()
  local network parent

  if [[ "$binary" == "iptables" ]]; then
    networks=("${CF_IPV4[@]}")
  else
    networks=("${CF_IPV6[@]}")
  fi

  "$binary" -w 5 -S "$CHAIN_NAME" >/dev/null
  for parent in INPUT DOCKER-USER; do
    "$binary" -w 5 -C "$parent" -j "$CHAIN_NAME" >/dev/null
  done
  for network in "${networks[@]}"; do
    "$binary" -w 5 -C "$CHAIN_NAME" -i "$interface" -p tcp \
      -m multiport --dports 80,443 -s "$network" -j ACCEPT >/dev/null
  done
  "$binary" -w 5 -C "$CHAIN_NAME" -i "$interface" -p tcp \
    -m multiport --dports 80,443 -j DROP >/dev/null
  "$binary" -w 5 -C "$CHAIN_NAME" -i "$interface" -p udp \
    --dport 443 -j DROP >/dev/null
  "$binary" -w 5 -C "$CHAIN_NAME" -j RETURN >/dev/null
}

apply_policy() {
  local interface
  preflight
  interface="$(detect_interface)"
  configure_family iptables "$interface"
  configure_family ip6tables "$interface"
  log "policy applied on ${interface}: TCP 80/443 only from Cloudflare; UDP 443 blocked"
}

check_policy() {
  local interface
  preflight
  interface="$(detect_interface)"
  check_family iptables "$interface"
  check_family ip6tables "$interface"
  log "policy verified on ${interface} for IPv4 and IPv6"
}

disable_family() {
  local binary="$1" parent

  for parent in INPUT DOCKER-USER; do
    while "$binary" -w 5 -C "$parent" -j "$CHAIN_NAME" >/dev/null 2>&1; do
      "$binary" -w 5 -D "$parent" -j "$CHAIN_NAME"
    done
  done

  if "$binary" -w 5 -S "$CHAIN_NAME" >/dev/null 2>&1; then
    "$binary" -w 5 -F "$CHAIN_NAME"
    "$binary" -w 5 -X "$CHAIN_NAME"
  fi
}

disable_policy() {
  require_root
  require_command iptables
  require_command ip6tables
  disable_family iptables
  disable_family ip6tables
  log "live policy disabled; the systemd unit was not removed"
}

install_policy() {
  local interface self_path unit_tmp
  preflight
  require_command install
  require_command systemctl
  interface="$(detect_interface)"
  self_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  unit_tmp="$(mktemp -t manifold-origin-firewall-unit-XXXXXX)"
  trap 'rm -f "$unit_tmp"' EXIT

  install -m 0755 "$self_path" "$INSTALL_PATH"
  printf '%s\n' \
    '[Unit]' \
    'Description=Restrict Manifold origin ports to Cloudflare networks' \
    'Requires=docker.service' \
    'After=network-online.target docker.service' \
    'PartOf=docker.service' \
    '' \
    '[Service]' \
    'Type=oneshot' \
    "Environment=MANIFOLD_ORIGIN_INTERFACE=${interface}" \
    "ExecStart=${INSTALL_PATH} --apply" \
    "ExecStartPost=${INSTALL_PATH} --check" \
    'RemainAfterExit=yes' \
    '' \
    '[Install]' \
    'WantedBy=docker.service' >"$unit_tmp"
  install -m 0644 "$unit_tmp" "$UNIT_PATH"

  systemctl daemon-reload
  systemctl enable "$UNIT_NAME"
  systemctl restart "$UNIT_NAME"
  systemctl is-active --quiet "$UNIT_NAME" || die "${UNIT_NAME} did not become active"
  rm -f "$unit_tmp"
  trap - EXIT
  log "installed ${INSTALL_PATH} and enabled ${UNIT_NAME}"
}

usage() {
  printf 'Usage: %s --apply | --check | --disable | --install\n' "$0"
}

case "${1:-}" in
  --apply) apply_policy ;;
  --check) check_policy ;;
  --disable) disable_policy ;;
  --install) install_policy ;;
  -h|--help) usage ;;
  *) usage >&2; exit 2 ;;
esac
