from django.urls import path
from plane.app.views.gitlab import (
    GitLabIntegrationsEndpoint,
    GitLabOAuthStartEndpoint,
    GitLabOAuthCallbackEndpoint,
    GitLabDevelopmentEndpoint,
    GitLabWebhookEndpoint,
)

urlpatterns = [
    path("workspaces/<str:slug>/gitlab-integrations/", GitLabIntegrationsEndpoint.as_view()),
    path(
        "workspaces/<str:slug>/gitlab-integrations/<uuid:integration_id>/connect/", GitLabOAuthStartEndpoint.as_view()
    ),
    path("integrations/gitlab/callback/", GitLabOAuthCallbackEndpoint.as_view()),
    path("integrations/gitlab/<uuid:integration_id>/webhook/", GitLabWebhookEndpoint.as_view()),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/development/",
        GitLabDevelopmentEndpoint.as_view(),
    ),
]
