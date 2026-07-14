# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import hashlib
import hmac
import logging
import time

# Django imports
from django.conf import settings
from django.http import HttpRequest

# Third party imports
from rest_framework.request import Request

# Module imports
from plane.utils.ip_address import get_client_ip
from plane.utils.exception_logger import log_exception
from plane.bgtasks.logger_task import process_logs

api_logger = logging.getLogger("plane.api.request")


class RequestLoggerMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def _should_log_route(self, request: Request | HttpRequest) -> bool:
        """
        Determines whether a route should be logged based on the request and status code.
        """
        # Don't log health checks
        if request.path == "/" and request.method == "GET":
            return False
        return True

    def __call__(self, request):
        # get the start time
        start_time = time.time()

        # Get the response
        response = self.get_response(request)

        # calculate the duration
        duration = time.time() - start_time

        # Check if logging is required
        log_true = self._should_log_route(request=request)

        # If logging is not required, return the response
        if not log_true:
            return response

        user_id = (
            request.user.id if getattr(request, "user") and getattr(request.user, "is_authenticated", False) else None
        )

        user_agent = request.META.get("HTTP_USER_AGENT", "")

        # Log the request information
        api_logger.info(
            f"{request.method} {request.path} {response.status_code}",
            extra={
                "path": request.path,
                "method": request.method,
                "status_code": response.status_code,
                "duration_ms": int(duration * 1000),
                "remote_addr": get_client_ip(request),
                "user_agent": user_agent,
                "user_id": user_id,
            },
        )

        # return the response
        return response


class APITokenLogMiddleware:
    """
    Middleware to log External API requests to PostgreSQL.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        self.process_request(request, response)
        return response

    def process_request(self, request, response, request_body=None):
        api_key_header = "X-Api-Key"
        api_key = request.headers.get(api_key_header)

        # If the API key is not present, return
        if not api_key:
            return

        try:
            log_data = {
                # Tokenize the (high-entropy) API key into a stable, non-reversible
                # identifier so logs can be correlated to a token without ever
                # persisting the raw key. A keyed HMAC is used rather than a bare
                # hash so the digest cannot be precomputed from a known key value.
                "token_identifier": hmac.new(
                    settings.SECRET_KEY.encode(), api_key.encode(), hashlib.sha256
                ).hexdigest(),
                "path": request.path,
                "method": request.method,
                # Request/response bodies and raw query strings can contain
                # credentials, customer data and task content. Operational logs
                # intentionally retain metadata only.
                "query_params": None,
                "headers": "{}",
                "body": None,
                "response_body": None,
                "response_code": response.status_code,
                "ip_address": get_client_ip(request=request),
                "user_agent": request.META.get("HTTP_USER_AGENT", None),
            }

            process_logs.delay(log_data=log_data)

        except Exception as e:
            log_exception(e)

        return None
