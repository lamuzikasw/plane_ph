#!/usr/bin/env bash
# Run as root from this directory, passing ONLY the dedicated CI public key file.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run as root' >&2; exit 1; }
[[ $# -eq 1 && -f $1 ]] || { echo 'Usage: install.sh PUBLIC_KEY_FILE' >&2; exit 1; }
ssh-keygen -lf "$1" >/dev/null
key=$(cat "$1")
[[ $key == ssh-ed25519\ * && $key != *$'\n'* ]] || exit 1
cd "$(dirname "$0")"
install -o root -g root -m 0755 plane-ci-gateway /usr/local/bin/plane-ci-gateway
install -o root -g root -m 0755 plane-ci-deploy.py /usr/local/sbin/plane-ci-deploy
deploy_home=$(getent passwd deploy | cut -d: -f6)
[[ -n $deploy_home && -f $deploy_home/.ssh/authorized_keys ]]
key_body=$(awk '{print $2}' "$1")
if ! grep -Fq "$key_body" "$deploy_home/.ssh/authorized_keys"; then
  cp -p "$deploy_home/.ssh/authorized_keys" "$deploy_home/.ssh/authorized_keys.before-plane-ci"
  printf '\nrestrict,command="/usr/local/bin/plane-ci-gateway" %s\n' "$key" >> "$deploy_home/.ssh/authorized_keys"
fi
echo 'Restricted CI key installed for the existing deploy account; SSH policy unchanged.'
