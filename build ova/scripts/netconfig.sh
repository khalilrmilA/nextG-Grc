#!/usr/bin/env bash
# netconfig.sh <dhcp|static> [ip] [prefix] [gateway] [dns,comma,separated]
# Writes /etc/netplan/00-appliance.yaml and applies it.
set -euo pipefail

MODE="${1:-dhcp}"
IP="${2:-}"
PREFIX="${3:-24}"
GW="${4:-}"
DNS="${5:-1.1.1.1,8.8.8.8}"

IFACE="$(ip -o link show | awk -F': ' '$2 != "lo" {print $2; exit}')"
OUT=/etc/netplan/00-appliance.yaml

if [ "${MODE}" = "static" ] && [ -n "${IP}" ] && [ -n "${GW}" ]; then
  echo "[netconfig] static ${IP}/${PREFIX} via ${GW} on ${IFACE}"
  cat > "${OUT}" <<EOF
network:
  version: 2
  renderer: networkd
  ethernets:
    ${IFACE}:
      dhcp4: false
      addresses: [${IP}/${PREFIX}]
      routes:
        - to: default
          via: ${GW}
      nameservers:
        addresses: [${DNS//,/, }]
EOF
else
  echo "[netconfig] DHCP on ${IFACE}"
  cat > "${OUT}" <<EOF
network:
  version: 2
  renderer: networkd
  ethernets:
    ${IFACE}:
      dhcp4: true
EOF
fi

chmod 600 "${OUT}"
netplan apply

# Wait for an address before the caller continues.
for _ in $(seq 1 30); do
  [ -n "$(hostname -I | awk '{print $1}')" ] && break
  sleep 1
done
