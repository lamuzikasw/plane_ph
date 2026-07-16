import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from plane.app.views.external.base import IgorChatEndpoint


@pytest.mark.unit
def test_check_igor_config_reports_safe_configuration(monkeypatch):
    monkeypatch.setattr(
        IgorChatEndpoint,
        "_get_igor_llm_config",
        lambda _self: ("secret-value", "gpt-4o-mini", "https://api.openai.com", 20.0),
    )
    stdout = StringIO()

    call_command("check_igor_config", stdout=stdout)

    result = json.loads(stdout.getvalue())
    assert result == {
        "model": "gpt-4o-mini",
        "provider_host": "api.openai.com",
        "ready": True,
        "timeout_seconds": 20.0,
    }
    assert "secret-value" not in stdout.getvalue()


@pytest.mark.unit
def test_check_igor_config_fails_without_api_key(monkeypatch):
    monkeypatch.setattr(
        IgorChatEndpoint,
        "_get_igor_llm_config",
        lambda _self: (None, "gpt-4o-mini", None, 8.0),
    )

    with pytest.raises(CommandError, match='"ready": false'):
        call_command("check_igor_config")
