# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.settings.common import ATTACHMENT_MIME_TYPES, ISSUE_ATTACHMENT_MIME_TYPES
from plane.utils.path_validator import resolve_issue_attachment_content_type


def test_html_is_allowed_only_for_downloadable_issue_attachments():
    assert "text/html" in ISSUE_ATTACHMENT_MIME_TYPES
    assert "text/html" not in ATTACHMENT_MIME_TYPES


def test_executable_script_types_remain_blocked():
    assert "application/x-sh" not in ISSUE_ATTACHMENT_MIME_TYPES
    assert "application/x-msdownload" not in ISSUE_ATTACHMENT_MIME_TYPES


def test_html_extension_recovers_missing_or_stale_browser_mime_type():
    assert resolve_issue_attachment_content_type("document.html", "") == "text/html"
    assert resolve_issue_attachment_content_type("document.HTM", False) == "text/html"
    assert resolve_issue_attachment_content_type("document.html", "text/plain") == "text/html"


def test_non_html_extension_keeps_supplied_mime_type():
    assert resolve_issue_attachment_content_type("document.pdf", "application/pdf") == "application/pdf"


@pytest.mark.parametrize("filename", ["0011.md", "README.MD", "notes.markdown"])
@pytest.mark.parametrize(
    "content_type", ["", False, None, "text/plain", "text/x-markdown", "text/markdown", "application/octet-stream"]
)
def test_markdown_attachment_recovers_missing_or_stale_browser_mime_type(filename, content_type):
    resolved_type = resolve_issue_attachment_content_type(filename, content_type)
    assert resolved_type == "text/markdown"
    assert resolved_type in ISSUE_ATTACHMENT_MIME_TYPES


def test_unknown_attachment_extension_does_not_gain_a_mime_type():
    assert resolve_issue_attachment_content_type("document.unknown", "") == ""


def test_markdown_extension_preserves_a_detected_binary_mime_type():
    assert resolve_issue_attachment_content_type("document.md", "application/pdf") == "application/pdf"
