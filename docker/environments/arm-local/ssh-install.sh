#!/usr/bin/env bash
# setup-sshd.sh — install & start OpenSSH in a Docker container
set -euo pipefail

# Expect Debian/Ubuntu base
if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script expects a Debian/Ubuntu image (apt-get not found)"; exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# Install server (and sftp server), then clean caches to save space
apt-get update
apt-get install -y --no-install-recommends openssh-server openssh-sftp-server ca-certificates
apt-get clean
rm -rf /var/lib/apt/lists/*

# Ensure runtime dirs exist
mkdir -p /var/run/sshd /var/log/ssh

# Set root password (change if you like)
echo 'root:root' | chpasswd

# Hardened/explicit sshd settings (edit if you have a config.d layout)
SSHD_CFG="/etc/ssh/sshd_config"
[ -f "${SSHD_CFG}.orig" ] || cp -a "$SSHD_CFG" "${SSHD_CFG}.orig"

# Permit root login via password (your original intent)
if grep -qE '^\s*PermitRootLogin' "$SSHD_CFG"; then
  sed -i -E 's/^\s*#?\s*PermitRootLogin\s+.*/PermitRootLogin yes/' "$SSHD_CFG"
else
  echo 'PermitRootLogin yes' >> "$SSHD_CFG"
fi

# Ensure password auth is enabled (often default, but make explicit)
if grep -qE '^\s*PasswordAuthentication' "$SSHD_CFG"; then
  sed -i -E 's/^\s*#?\s*PasswordAuthentication\s+.*/PasswordAuthentication yes/' "$SSHD_CFG"
else
  echo 'PasswordAuthentication yes' >> "$SSHD_CFG"
fi

# Make pam_loginuid non-fatal in containers (avoids noisy messages)
sed -i -E 's@^session\s+required\s+pam_loginuid\.so@session optional pam_loginuid.so@' /etc/pam.d/sshd || true

# Create host keys if missing
ssh-keygen -A

# Start/restart sshd (service helper exists on Debian/Ubuntu images)
if command -v service >/dev/null 2>&1; then
  service ssh restart || service ssh start
elif [ -x /usr/sbin/sshd ]; then
  # Fallback: start directly (foreground would block; background is fine)
  /usr/sbin/sshd || true
fi

echo "✔ OpenSSH is installed and running."
echo "   Try: ssh root@localhost -p 3456   (password: root)"
