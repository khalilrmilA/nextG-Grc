#!/usr/bin/env bash
# Baseline hardening for a shipped appliance.
set -euo pipefail

echo "[30-harden] SSH"
cat > /etc/ssh/sshd_config.d/99-appliance.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication yes
PermitEmptyPasswords no
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
MaxAuthTries 4
EOF

echo "[30-harden] firewall"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
# 22 is opened here because the build itself runs over SSH. The rule is removed
# again on the customer's first boot by appliance-ssh-lockdown.service, and
# re-added for 60 minutes only when the console's support flow verifies a signed
# response.
ufw allow 22/tcp comment 'build and support ssh'
ufw allow 80/tcp comment 'web console'
# 443 is deliberately NOT opened: the console is served over plain HTTP on
# 80 and nothing listens on 443. An open port with nothing behind it is
# just an invitation to a scanner.
ufw --force enable

echo "[30-harden] fail2ban"
cat > /etc/fail2ban/jail.d/appliance.conf <<'EOF'
[sshd]
enabled  = true
maxretry = 5
bantime  = 1h
findtime = 10m
EOF
systemctl enable fail2ban

echo "[30-harden] kernel parameters"
cat > /etc/sysctl.d/99-appliance.conf <<'EOF'
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.tcp_syncookies = 1
net.ipv6.conf.all.accept_redirects = 0
kernel.randomize_va_space = 2
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
EOF

# The appliance uses SQLite on the local filesystem, so there is no database
# socket to bind and nothing to restrict here. If a deployment is repointed at
# an external PostgreSQL through DATABASE_URL, that server is the operator's to
# secure, not this image's.

echo "[30-harden] login banner placeholder"
cat > /etc/issue.net <<'EOF'
Authorised access only. All activity is logged.
EOF
echo "Banner /etc/issue.net" >> /etc/ssh/sshd_config.d/99-appliance.conf

echo "[30-harden] removing build-time conveniences"
rm -f /etc/sudoers.d/builder
apt-get -y purge snapd 2>/dev/null || true
apt-get -y autoremove --purge

echo "[30-harden] done"
