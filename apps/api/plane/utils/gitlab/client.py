"""GitLab API client. Repository operations are deliberately GET-only."""

from urllib.parse import urlsplit

import requests
from rest_framework.exceptions import ValidationError


class GitLabError(Exception):
    def __init__(self, code: str, status: int = 503):
        self.code = code
        self.status = status
        super().__init__(code)


def validate_base_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path.rstrip("/")
    ):
        raise ValidationError({"base_url": "Use the HTTPS origin of your GitLab server."})
    try:
        parsed.port
    except ValueError:
        raise ValidationError({"base_url": "Invalid port."})
    return value.rstrip("/")


def decode_response(response: requests.Response):
    codes = {401: "token_invalid", 403: "access_denied", 404: "not_found", 429: "rate_limited"}
    if not 200 <= response.status_code < 300:
        raise GitLabError(codes.get(response.status_code, "unavailable"), response.status_code)
    try:
        return response.json()
    except ValueError:
        raise GitLabError("invalid_response")


class GitLabClient:
    def __init__(self, base_url: str, token: str, *, session: requests.Session | None = None):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.session = session

    def get(self, path: str, params: dict | None = None):
        if not self.token:
            raise GitLabError("token_invalid", 401)
        try:
            transport = self.session if self.session is not None else requests
            response = transport.get(
                f"{self.base_url}/api/v4/{path.lstrip('/')}",
                headers={"Authorization": f"Bearer {self.token}"},
                params=params,
                timeout=(15, 20),
                allow_redirects=False,
            )
        except requests.RequestException:
            raise GitLabError("unavailable") from None
        return decode_response(response), response.headers

    def one(self, path: str):
        data, _ = self.get(path)
        if not isinstance(data, dict):
            raise GitLabError("invalid_response")
        return data

    def all(self, path: str, params: dict | None = None) -> list[dict]:
        items = []
        page = 1
        for _ in range(200):
            data, headers = self.get(path, {**(params or {}), "per_page": 100, "page": page})
            if not isinstance(data, list):
                raise GitLabError("invalid_response")
            items.extend(data)
            next_page = headers.get("X-Next-Page", headers.get("x-next-page"))
            if next_page == "" or (next_page is None and len(data) < 100):
                return items
            try:
                next_number = int(next_page) if next_page else page + 1
            except (TypeError, ValueError):
                raise GitLabError("invalid_response") from None
            if next_number <= page:
                raise GitLabError("invalid_response")
            page = next_number
        # Do not silently truncate historical runs or marker discovery.
        raise GitLabError("pagination_limit")


def oauth_token(integration, **parameters) -> dict:
    from plane.license.utils.encryption import decrypt_data

    try:
        response = requests.post(
            f"{integration.base_url}/oauth/token",
            data={
                "client_id": integration.client_id,
                "client_secret": decrypt_data(integration.client_secret_encrypted),
                **parameters,
            },
            timeout=(15, 20),
            allow_redirects=False,
        )
    except requests.RequestException:
        raise GitLabError("unavailable") from None
    result = decode_response(response)
    if not isinstance(result, dict) or not result.get("access_token"):
        raise GitLabError("invalid_response")
    return result
