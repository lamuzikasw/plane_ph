# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from unittest.mock import Mock

from django.http import HttpResponse
from django.test import RequestFactory, override_settings

from plane.authentication.middleware.session import SessionMiddleware


@override_settings(
    SESSION_COOKIE_AGE=7_776_000,
    SESSION_COOKIE_DOMAIN=None,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_NAME="session-id",
    SESSION_COOKIE_PATH="/",
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=True,
    SESSION_SAVE_EVERY_REQUEST=True,
)
def test_active_session_cookie_gets_sliding_expiry_on_every_request():
    request = RequestFactory().get("/api/users/me/", HTTP_COOKIE="session-id=active-session")
    request.session = Mock(
        accessed=True,
        modified=False,
        session_key="active-session",
    )
    request.session.is_empty.return_value = False
    request.session.get_expire_at_browser_close.return_value = False
    request.session.get_expiry_age.return_value = 7_776_000

    response = SessionMiddleware(lambda _request: HttpResponse()).process_response(request, HttpResponse())

    request.session.save.assert_called_once_with()
    cookie = response.cookies["session-id"]
    assert cookie.value == "active-session"
    assert cookie["max-age"] == 7_776_000
    assert cookie["secure"] is True
    assert cookie["httponly"] is True


@override_settings(SESSION_SAVE_EVERY_REQUEST=True)
def test_server_error_does_not_rotate_or_delete_active_session():
    request = RequestFactory().get("/api/users/me/", HTTP_COOKIE="session-id=active-session")
    request.session = Mock(
        accessed=True,
        modified=False,
        session_key="active-session",
    )
    request.session.is_empty.return_value = False
    request.session.get_expire_at_browser_close.return_value = False
    request.session.get_expiry_age.return_value = 7_776_000

    response = SessionMiddleware(lambda _request: HttpResponse()).process_response(
        request, HttpResponse(status=503)
    )

    request.session.save.assert_not_called()
    assert "session-id" not in response.cookies
