#!/usr/bin/env bash
# Run as root from this directory, passing ONLY the dedicated CI public key file.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
[[ $# -eq 1 && -f $1 ]] || { echo 'Usage: install.sh PUBLIC_KEY_FILE' >&2; exit 1; }
ssh-keygen -lf "$1" >/dev/null
key=$(cat "$1")
[[ $key == ssh-ed25519\ * && $key != *$'\n'* ]] || exit 1
cd "$(dirname "$0")"
id plane-ci >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/plane-ci --shell /bin/bash plane-ci
install -o root -g root -m 0755 plane-ci-gateway /usr/local/bin/plane-ci-gateway
install -o root -g root -m 0755 plane-ci-deploy.py /usr/local/sbin/plane-ci-deploy
install -d -o root -g root -m 0755 /var/lib/plane-ci /var/lib/plane-ci/.ssh
printf 'restrict,command="/usr/local/bin/plane-ci-gateway" %s\n' "$key" > /var/lib/plane-ci/.ssh/authorized_keys
chown root:root /var/lib/plane-ci/.ssh/authorized_keys
chmod 0644 /var/lib/plane-ci/.ssh/authorized_keys
temporary=$(mktemp)
trap 'rm -f "$temporary"' EXIT
printf 'plane-ci ALL=(root) NOPASSWD: /usr/local/sbin/plane-ci-deploy *\n' > "$temporary"
visudo -cf "$temporary"
install -o root -g root -m 0440 "$temporary" /etc/sudoers.d/plane-ci
echo 'Restricted Plane CI account installed.'
