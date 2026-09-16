# Shared work items: test rollout

A work item keeps one canonical `Issue`. Each additional project gets an `IssuePlacement` with a distinct UUID and project sequence number. `IssueSequence` reserves numbers under the same advisory lock as native issue creation. Detaching preserves the reserved number; reattaching restores it.

The task sidebar shows **Projects** with links to local identifiers. Users can add projects there, use **Add existing work item** on a project board, or choose additional projects during creation. Removing an additional project removes only that placement.

Title, description, priority, dates, assignees, comments and attachments are shared. Status changes synchronize categories; each project uses a status from its own workflow. A transition fails atomically if a linked project has no corresponding category. Ordering and identifiers stay local. Cycles, modules, labels, estimates and parent/child relations are managed from the original project. Editing shared content is available directly in the work item; the original project owns archive/delete and move operations. Tasks with reserved placements cannot be moved to another original project.

Adding a project requires write access to both the original and destination project. Destination members can access and edit the shared task without access to unrelated tasks in the original project. Guest restrictions are retained. Ordinary project APIs cannot enable the pilot flag.

## Pilot scope

Workspace: `payholder`.
Test project: `c4899f6f-bb85-4fb4-bcda-d493e866d1d2` (`TIMEQA`, Тест времени задач).
Actor: `87950dcf-0325-4722-b507-94e661a3a9e5`.
Companion project: `MPTST`, `[Test] Shared work items`.

After deploying API and web, apply migration `db.0127_issue_placements`. Preview the setup command first:

```sh
python manage.py setup_issue_placement_demo \
  --workspace payholder \
  --project-id c4899f6f-bb85-4fb4-bcda-d493e866d1d2 \
  --actor-id 87950dcf-0325-4722-b507-94e661a3a9e5
```

Repeat with `--apply` to enable only the test project and its companion, copy test membership/workflow into the companion, and create one shared demo task. The command is transactional and idempotent; an unrelated existing `MPTST` project causes it to stop without changes. Its JSON output contains both identifiers.

## Verification

```sh
docker compose -f docker-compose-test.yml run --rm api-tests pytest \
  plane/tests/unit/views/test_issue_placements.py \
  plane/tests/unit/utils/test_issue_move.py \
  plane/tests/unit/serializers/test_issue_datetime_timezone.py \
  plane/tests/unit/serializers/test_issue_completion_requirements.py -q
pnpm --filter=web test helpers/issue-placement.helper.test.ts
pnpm --filter=web check:types
pnpm --filter=web check:lint
pnpm --filter=web build
```

API coverage includes local numbers and grouped board queries, identifier links and metadata, v2/detail endpoints, source/destination permissions, guest/cross-workspace restrictions, shared comments/attachments, workflow mapping and rollback, detach/reattach, search, atomic creation and repeatable demo setup.

This pilot covers project boards and shared task detail. Workspace analytics and external integrations retain their canonical issue model. Bulk operations that require native issues do not accept placement IDs. Workflow updates through direct SQL or queryset bulk updates bypass model synchronization; integrations should use the task API.

## Rollback

Keep the previous image references, Compose override and database dump before deploying. Restore the prior override and restart the affected API/web/worker services to roll back code. Keep migration 0127 in place: it is additive and older code ignores it. Do not reverse the migration or delete reserved sequence rows after creating placements. A code rollback hides the new project placements while retaining original tasks and demo data.

## Deployment on 2026-09-14

Deployed to `root@187.77.70.240`, Compose directory `/opt/plane/plane-app`.
API/worker/beat/migrator image: `local/plane-backend:placements-20260914`.
Web image: `local/plane-frontend:placements-20260914`.
Previous override and database dump: `/opt/plane/backups/placements-20260914/`.
Release build, switch script and live API verification: `/opt/plane/builds/placements-20260914/`.
The release was built from HEAD `54f35b418e` plus this feature, excluding unrelated local Igor changes.

Enabled projects confirmed by live API verification: `TIMEQA` and `MPTST` only.
Demo: `[Тест] Одна задача в двух проектах`.

- `TIMEQA-13`: canonical UUID `e010dd06-d73f-4dba-beae-768ef17de19f`.
- `MPTST-1`: placement UUID `300c2eda-005a-4660-93a0-10262c9ced46`.
- Companion project UUID: `2eee5e5d-78a0-4026-abf8-6c511e352521`.

Verification passed: 32 API tests, 2 client helper tests, TypeScript, web production build, formatting, lint with zero errors, Django system check, migration, live API read of both boards/details/placements and shared edit from MPTST. Web and instance endpoint returned HTTP 200; web container healthy.

The repository-wide i18n sync check still reports pre-existing missing keys outside this feature (including management analytics). All new `issue_projects` keys match across every locale. Browser visual verification remains pending: full Chrome accessibility access was rejected because it also exposes unrelated private tabs, and a provider scoped to the Plane tab is unavailable.

On the follow-up, the user confirmed that a hard refresh made the Projects field appear. The screenshot had shown a tab still running the previous frontend. Reload existing tabs after deploying this release. Two component rendering tests also cover both identifier links and the server-disabled state.

## Workspace rollout on 2026-09-14

After the user confirmed the Projects field appeared and explicitly requested enabling it on every board, `issue_placements_enabled` was enabled on all 33 existing PayHolder projects (31 newly enabled, two already enabled). Archived projects retain their archived status. No work items were attached to additional boards by this configuration change. Project membership and access requirements remain unchanged. New projects still use the model's default until workspace-level enablement is implemented.

## Project picker popup fix

The project picker was rendered in a portal outside the issue side peek. Its mousedown events reached the peek's outside-click handler, which unmounted the task and picker before selection/saving. The picker now uses the existing `data-prevent-outside-click` boundary and registers its open state in the issue detail store, including cleanup on close/unmount. This also preserves the peek while dismissing the nested modal. Removed the misleading external-link icon from checkbox rows.

Added jsdom-backed Vitest interaction tests using the real project picker and peek outside-click hook. The old implementation fails the selection, cancel and failure cases; the fixed implementation passes all three. Seven focused tests pass in total, along with TypeScript, production web build and lint (zero errors). A dedicated Vitest config keeps React Router's development HMR preamble out of DOM unit tests.

With the DOM test configuration in place, the full web suite also passed: 15 test files, 85 tests. Initial server image build was interrupted by SSH disconnect while the host reported load average 139.54; the existing web image was left running pending successful image construction.

The first deployment attempts were blocked until server recovery. Docker's `_ping` and the Plane website returned successfully, but BuildKit stalled resolving the local base image and Docker container queries timed out. A legacy-builder retry also stalled. Both task-owned build clients were interrupted; the live Compose web reference remains `local/plane-frontend:placements-20260914`. Source and compiled client are retained under `/opt/plane/builds/placements-popup-20260914/`, with `switch.py` prepared but not executed. Once Docker recovers: build `local/plane-frontend:placements-popup-20260914`, run that directory's `switch.py`, then run `docker compose --env-file plane.env up -d --no-deps web` from `/opt/plane/plane-app`, and verify the website plus `assets/peek-overview-B3e5dA8F.js`. The standalone `/payholder/browse/SEVA-58/` page avoids the side-peek outside-click handler as an interim route.

## Server recovery and completed popup deployment

On 2026-09-14, the user reported the Plane startup failure screen during severe host overload. The host has four CPUs; load average exceeded 100. API logs recorded repeated Gunicorn worker timeouts between 12:02 and 12:21 UTC. By 12:29 UTC, current CPU idle was 76–80%, the runnable queue was 0–1, and instance requests were completing in 3–8 ms. The underlying cause of the host overload was not established. No global Docker restart, database restore or unrelated service changes were performed.

After Docker recovered, the frontend image built successfully and was deployed at approximately 12:30 UTC: `local/plane-frontend:placements-popup-20260914`. Only the `web` service was recreated. The previous web reference is preserved in `/opt/plane/backups/placements-20260914/docker-compose.override.before-popup.yaml`. The image retains earlier hashed assets to support already-open tabs; reload a tab to activate the fixed picker. API and data remain on the prior placement release.

Post-deployment verification passed: web container healthy; public board route, `/api/instances/` and the new picker asset return HTTP 200. The served `peek-overview-B3e5dA8F.js` hash matches the tested build and contains both event guards. An authenticated read-only API check for SEVA-58 returned `can_manage=true` with SPRINT in available projects. All 33 existing PayHolder projects remain enabled. Browser interaction remains covered by the 85 passing web tests rather than a live browser session.

## Board drag fix on 2026-09-14

Dragging a shared work item sent `id` and `project_id` alongside `state_id` and `sort_order`. The placement PATCH allowlist rejected these echoed identifiers with HTTP 400, although direct status-only updates were valid. The endpoint now validates echoed UUIDs against the current placement/project and removes them before applying edits. Attempts to change either identity remain rejected.

Four regression cases cover a move to Backlog, local reordering, and rejection of each mismatched identifier. Before the fix, both valid board operations failed; afterwards all 36 placement/move/date/completion tests passed. The deployment changes only `plane/app/views/issue/placement.py` on top of the preceding backend image, excluding unrelated local edits.

Deployed image: `local/plane-backend:placements-drag-20260914` (API, worker, beat and migrator references). The API, worker and beat services were recreated. The popup frontend remains unchanged. Previous Compose configuration: `/opt/plane/backups/placements-20260914/docker-compose.override.before-drag.yaml`. Build and switch script: `/opt/plane/builds/placements-drag-20260914/`.

Live verification submitted the actual SPRINT-22 drag payload inside an explicitly rolled-back transaction with background tasks mocked. PATCH returned HTTP 204, both SPRINT-22 and SEVA-58 reached Backlog, and only the SPRINT ordering changed. After rollback, original task statuses and ordering were confirmed intact. This verifies the server behavior without moving the user's task as a testing side effect.

## Duplicate card display after status changes

The user reported SPRINT-23 in Backlog and Todo at once, plus a negative In Progress count. A read-only production check found exactly one native issue (`918e1c12-2ca2-4bdb-963f-5c6edd83aea9`), no placement with that project number, and a single matching Todo entry in the grouped board API response. No duplicate database row was deleted or modified.

The placement feature had added a detail fetch after every status PATCH, including ordinary native tasks. That fetch wrote the issue map directly without updating grouped IDs/counts and could overwrite a newer optimistic transition. Removed this extra refresh. The local status and board group continue to update together through the existing mutation path; other projects load their server-mapped statuses through their normal board fetch. Server-side status synchronization remains in place.

Regression tests exercise consecutive moves with a delayed stale read for both native and placement IDs, and rollback after a failed transition. Both delayed-read cases fail against the previous implementation. After the fix: all 88 web tests pass; TypeScript and production build pass; lint reports zero errors with existing base-store and empty mock-class warnings. The isolated release excludes unrelated Igor edits.

Frontend image: `local/plane-frontend:placements-board-20260914`, built from the previous popup image while retaining earlier hashed assets. Compose backup: `/opt/plane/backups/placements-20260914/docker-compose.override.before-board.yaml`. Release folder: `/opt/plane/builds/placements-board-20260914/`. Only the web service is updated; backend remains `placements-drag-20260914`. Reload existing tabs to replace their in-memory board state and load the fixed frontend.

## Login blank-screen investigation (13:36 UTC)

User screenshot points to `/payholder/projects/e8adf175-36a2-4a0c-a92d-dc8553300b0c/issues/d46569cb-2eb0-40ba-9ba2-5351542e8c4f`. Production services are running, web healthy, host load approximately 2.4 on four CPUs. Public root and instance endpoint return 200 in 28–39 ms; unauthenticated current-user check returns the expected 401. No service restarts or code changes were made for this investigation.

The affected browser's access-log entries show roughly 180 reloads of the same deep URL, mostly 304, without missing assets. A separate headless Chrome with an empty profile successfully renders the login form at both root and this deep URL (the latter redirects to login with next_path). React hydration warnings occur but do not prevent the form rendering in the isolated session. This does not establish the cause of the user's reload loop. User was asked whether the root login form opens in incognito to distinguish saved-browser state from an account-specific path.

## Board group reconciliation on 2026-09-15

SPRINT-2 appeared in Todo and Done after a drag while both cards displayed Done. A read-only database check found one native issue (`c375cc65-008f-4edf-8024-7f9fdfb2a3c6`) in Done and no placement with SPRINT sequence 2. Regression tests reproduced duplicate columns when a detail read changes task data independently of grouped IDs, and when pagination appends a moved task without removing its earlier group membership.

The board now reconciles loaded membership with task data during edits and pagination, retains newer local edits over older page records, and computes count changes once per task/group. Tests cover already duplicated cards, consecutive edits, unloaded source counts, and multiple assignee swimlanes including unloaded cards. All 101 workspace web tests passed; isolated release tests, TypeScript and production build passed. Lint had no errors and 15 existing base-store warnings. The Markdown upload test now imports the built service package to satisfy TypeScript project boundaries.

Local code commit: `40a958cf2c`. Deployment: `local/plane-frontend:board-groups-20260915`, updating only web. Backend remains `local/plane-backend:markdown-20260915`. Prior frontend: `local/plane-frontend:markdown-20260915`. Build and switch script: `/opt/plane/builds/board-groups-20260915/`; Compose backup: `/opt/plane/backups/board-groups-20260915/docker-compose.override.yaml`.

Post-deployment verification: web healthy, public SPRINT board and instance API HTTP 200, served `store-context-GInUdGHd.js` SHA256 `548a050b8efb22e08a186233c61f3a7e7849647fae4d74bed07d7d1423b7c3d2` matches the tested build. Reload existing tabs to activate the new code. GitHub publication requires the user's pending explicit confirmation after automatic approval review limited the previous approval to the Markdown commit.

## Igor launcher overlap fix on 2026-09-16

The collapsed Igor launcher used z-index 40 while the date and date-range popovers use 30, covering the deadline confirmation button near the bottom-right corner. Lowered only the collapsed launcher to z-index 20; the expanded chat retains its existing layer. Existing unrelated Igor changes in the workspace were excluded from the isolated release.

Deployed frontend: `local/plane-frontend:igor-layer-20260916`, based on `board-groups-20260915`. Only web was recreated. Backup: `/opt/plane/backups/igor-layer-20260916/docker-compose.override.yaml`; build: `/opt/plane/builds/igor-layer-20260916/`.

Validation: formatting, lint, generated route types, TypeScript, and production build passed. Web healthy; board and instance API returned HTTP 200. Published `layout-D2yIqf8A.js` SHA256 `da5f3de72023074e8a0bd5a42943cb360bf80e0790d17810a472beb807af8c6f` matches the isolated build and contains the launcher z-index 20. The open calendar was not reloaded because it had an unsaved draft; post-update browser overlap verification remains unperformed. Reload existing tabs after saving or cancelling the draft.

## Comment counts on cards on 2026-09-16

Added a compact, localized comment icon/count to the shared card properties beside attachment/link indicators. Zero/missing counts are hidden; clicking follows the normal card action. The badge has an accessible label, uses existing theme tokens, and does not imply unread status.

Board queries now include `comment_count` using a correlated aggregate over nondeleted comments on the canonical issue, without extra HTTP requests per card or join multiplication. Ordinary and shared tasks use the same count. Successful comment creation/deletion updates the cached count and all loaded placements, preserving the issue timestamp. Opening a discussion reloads its complete comment list to remove stale deleted IDs from the cache. No database migration.

Validation: 102 isolated web tests, TypeScript, production web build and focused lint/format checks passed. Three isolated API tests passed, covering zero/deleted comments, one-query counting, and native/shared grouped and ungrouped board responses.

Deployed API `local/plane-backend:comments-20260916` and web `local/plane-frontend:comments-20260916`; only API and web were recreated. Worker/beat/migrator retain the Markdown image. Rollback configuration: `/opt/plane/backups/comments-20260916/docker-compose.override.yaml`; build: `/opt/plane/builds/comments-20260916/`. Final frontend overlay: `/opt/plane/builds/comments-client-final-20260916.tar.gz`. Earlier hashed assets are retained.

Production read-only verification checked 66 rows / 62 canonical tasks with state/assignee grouping on SPRINT (17 tasks with comments), plus the shared-work-item test board. Every count matched an independent database aggregation. Board and instance API returned HTTP 200. Served `properties-CWvEN5Q_.js` SHA256 `9347d810dac52b23c10b61f07d86b3008d8be0c98f4efe07e3a1027340876f7c` matches the build. No test comments were posted in production. Existing tabs require refresh.

Native Chrome verification in a fresh production tab also passed: accessible card labels include “Комментарии: 1” on SPRINT-54 and “Комментарии: 4” on SPRINT-1. Screenshot review confirmed compact badges beside existing card indicators; cards without comments have no empty badge. No existing task or discussion was edited during this check.

### Comment badge navigation — 2026-09-16

- Clicking the comment icon/count opens the standard side peek and focuses/scrolls to the discussion after comments and activity load; mobile routes use `#comments`.
- Discussion navigation temporarily selects the comments filter without changing saved activity preferences. Normal card clicks retain normal task navigation.
- Validation: 107 web tests, type checking, production build, focused lint (0 warnings/errors); separately verified the publication snapshot (13 frontend tests and 3 API tests on a fresh isolated test DB).
- Deployed web image: `local/plane-frontend:comment-navigation-20260916`; API remains `local/plane-backend:comments-20260916`. Override backup: `/opt/plane/backups/comment-navigation-20260916/docker-compose.override.yaml`.
- Native Chrome QA: clicked SPRINT-54 comment badge on the production board in a separate tab. Side peek opened directly at Activity with the existing comment visible and focus inside the discussion. No comments were created or changed. HTTP 200 and both containers running.
- Source publication contains the comment counter/navigation and its tests only. Existing unrelated placement/Igor working changes remain outside the commit; the deployment uses the existing deployed baseline plus the navigation change.

## Consolidated source release — 2026-09-17

The user authorized publishing all outstanding application changes to GitHub and production. This consolidates shared work items and their project picker, Igor's 4–5-package specification decomposition and active-job recovery, and the board detail-read fix. Detail reads now reconcile already-loaded board membership and counts atomically with the card data, including assignee swimlanes; unrelated tasks are not inserted into filtered boards.

Validation: 120 web tests and 180 focused API tests passed, along with TypeScript and a production web build configured for `https://plane.myneogroup.space`. The API tests used a newly recreated isolated test database; the first run encountered an outdated reused test schema. Django reports no missing model migrations. Frontend lint reports zero errors with 33 existing warnings. Local dependency cache `.pnpm-store/` is excluded from version control.

Production release tag: `consolidated-20260917`. The prepared rollout uses the existing backend/frontend images as runtime bases, replaces application source and compiled client with this release, retains old hashed browser assets, and backs up the Compose override and database before switching API, worker, beat-worker and web. Production already has migration `db.0127_issue_placements`; no project flags or work item records need manual changes.
