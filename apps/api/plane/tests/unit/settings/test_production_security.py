# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only

import pytest
from django.core.exceptions import ImproperlyConfigured

from plane.settings.security import validate_production_security


@pytest.mark.unit
@pytest.mark.parametrize(
    "environment",
    [
        {"SECRET_KEY": "short", "CORS_ALLOWED_ORIGINS": "https://plane.example.com"},
        {"SECRET_KEY": "x" * 48, "CORS_ALLOWED_ORIGINS": ""},
        {"SECRET_KEY": "x" * 48, "CORS_ALLOWED_ORIGINS": "http://plane.example.com"},
    ],
)
def test_unsafe_production_configuration_fails_closed(environment):
    with pytest.raises(ImproperlyConfigured):
        validate_production_security(environment)


@pytest.mark.unit
def test_secure_production_configuration_is_accepted():
    validate_production_security(
        {
            "SECRET_KEY": "x" * 48,
            "CORS_ALLOWED_ORIGINS": "https://plane.example.com,https://api.plane.example.com",
        }
    )
