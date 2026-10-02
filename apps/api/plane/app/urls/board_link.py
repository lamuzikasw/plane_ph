from django.urls import path
from plane.app.views.board_link import BoardLinkCreateEndpoint, BoardLinkDetailEndpoint

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/board-links/",
        BoardLinkCreateEndpoint.as_view(),
        name="board-link-create",
    ),
    path("board-links/<slug:token>/", BoardLinkDetailEndpoint.as_view(), name="board-link-detail"),
]
