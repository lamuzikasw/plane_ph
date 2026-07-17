from pathlib import Path


def test_api_entrypoint_does_not_flush_shared_cache():
    entrypoint = Path(__file__).resolve().parents[3] / "bin" / "docker-entrypoint-api.sh"

    content = entrypoint.read_text(encoding="utf-8")

    assert "manage.py clear_cache" not in content
