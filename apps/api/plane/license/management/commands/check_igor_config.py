# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import json
from urllib.parse import urlparse

from django.core.management.base import BaseCommand, CommandError

from plane.app.views.external.base import IgorChatEndpoint


class Command(BaseCommand):
    help = "Validate Igor's LLM configuration without exposing or calling the configured API key."

    def handle(self, *_args, **_options):
        api_key, model, base_url, timeout_seconds = IgorChatEndpoint()._get_igor_llm_config()
        provider_host = urlparse(base_url or "https://api.openai.com").hostname
        result = {
            "ready": bool(api_key and model and provider_host),
            "model": model,
            "provider_host": provider_host,
            "timeout_seconds": timeout_seconds,
        }
        output = json.dumps(result, ensure_ascii=False, sort_keys=True)
        if not result["ready"]:
            raise CommandError(output)
        self.stdout.write(output)
