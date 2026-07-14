#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
COMPOSE_FILE=${PLANE_COMPOSE_FILE:-"$SCRIPT_DIR/docker-compose.yml"}
ENV_FILE=${PLANE_ENV_FILE:-"$SCRIPT_DIR/plane.env"}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Plane deployment stopped: environment file not found: $ENV_FILE" >&2
  exit 1
fi

read_env_value() {
  local key=$1
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1
}

SECRET_KEY_VALUE=$(read_env_value "SECRET_KEY")
LIVE_SECRET_KEY_VALUE=$(read_env_value "LIVE_SERVER_SECRET_KEY")
CORS_VALUE=$(read_env_value "CORS_ALLOWED_ORIGINS")

if [[ -z "$SECRET_KEY_VALUE" || "$SECRET_KEY_VALUE" == "change-this-key-on-deployment" || "$SECRET_KEY_VALUE" == "60gp0byfz2dvffa45cxl20p1scy9xbpf6d8c5y0geejgkyp1b5" ]]; then
  echo "Plane deployment stopped: SECRET_KEY in plane.env is missing or insecure." >&2
  exit 1
fi

if [[ -z "$LIVE_SECRET_KEY_VALUE" || "$LIVE_SECRET_KEY_VALUE" == "change-this-key-on-deployment" ]]; then
  echo "Plane deployment stopped: LIVE_SERVER_SECRET_KEY in plane.env is missing or insecure." >&2
  exit 1
fi

if [[ -z "$CORS_VALUE" ]]; then
  echo "Plane deployment stopped: CORS_ALLOWED_ORIGINS in plane.env is missing." >&2
  exit 1
fi

exec docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
