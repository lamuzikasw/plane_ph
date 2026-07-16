#!/usr/bin/env bash
set -euo pipefail

compose_file="${PLANE_COMPOSE_FILE:-docker-compose.yml}"
override_file="${PLANE_COMPOSE_OVERRIDE:-}"
env_file="${PLANE_ENV_FILE:-}"
compose_args=(-f "$compose_file")

if [[ -n "$override_file" ]]; then
  compose_args+=(-f "$override_file")
fi
if [[ -n "$env_file" ]]; then
  compose_args=(--env-file "$env_file" "${compose_args[@]}")
fi

check_service() {
  docker compose "${compose_args[@]}" exec -T "$1" python manage.py check_igor_config
}

api_config="$(check_service api)"
worker_config="$(check_service worker)"

if [[ "$api_config" != "$worker_config" ]]; then
  echo "Igor configuration mismatch between api and worker." >&2
  echo "api: $api_config" >&2
  echo "worker: $worker_config" >&2
  exit 1
fi

echo "Igor configuration parity check passed: $api_config"
