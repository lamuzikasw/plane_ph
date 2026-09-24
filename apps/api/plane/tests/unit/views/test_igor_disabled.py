import pytest

from plane.bgtasks.igor_capture_task import process_igor_capture_job

pytestmark = pytest.mark.unit


@pytest.mark.django_db
@pytest.mark.parametrize(
    "action",
    [None, "get_capture_job", "retry_capture_job", "create_capture_tasks", "refine_capture_review"],
)
def test_disabled_igor_rejects_all_chat_actions(session_client, workspace, settings, mocker, action):
    settings.IGOR_ENABLED = False
    dispatch = mocker.patch("plane.app.views.external.base.IgorChatEndpoint._get_llm_work_plan")
    response = session_client.post(
        f"/api/workspaces/{workspace.slug}/igor-chat/",
        {"message": "Покажи мои задачи", "action": action},
        format="json",
    )
    assert response.status_code == 404
    assert response.data["error"] == "igor_disabled"
    dispatch.assert_not_called()


def test_disabled_igor_does_not_process_queued_jobs(settings, mocker):
    settings.IGOR_ENABLED = False
    process = mocker.patch("plane.bgtasks.igor_capture_task._process_igor_capture_job")
    acquire_lock = mocker.patch("plane.bgtasks.igor_capture_task._capture_job_lock")
    process_igor_capture_job.run("workspace", "user", "job")
    process.assert_not_called()
    acquire_lock.assert_not_called()
