# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

from django.core.exceptions import ImproperlyConfigured


def validate_production_security(environment):
    """Reject credentials and origin settings that are unsafe in production."""
    raw_secret = (environment.get("SECRET_KEY") or "").strip()
    insecure_secrets = {
        "60gp0byfz2dvffa45cxl20p1scy9xbpf6d8c5y0geejgkyp1b5",
        "change-this-key-on-deployment",
        "secret-key",
    }
    if len(raw_secret) < 32 or raw_secret in insecure_secrets:
        raise ImproperlyConfigured(
            "Production requires a persistent, non-placeholder SECRET_KEY of at least 32 characters"
        )

    origins = [
        origin.strip()
        for origin in (environment.get("CORS_ALLOWED_ORIGINS") or "").split(",")
        if origin.strip()
    ]
    if not origins:
        raise ImproperlyConfigured("Production requires an explicit CORS_ALLOWED_ORIGINS allowlist")
    if any(origin.startswith("http://") for origin in origins) and environment.get("ALLOW_INSECURE_HTTP") != "1":
        raise ImproperlyConfigured(
            "Production CORS origins must use HTTPS; set ALLOW_INSECURE_HTTP=1 only for an intentional local deployment"
        )
