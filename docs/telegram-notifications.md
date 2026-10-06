# Telegram notifications

The integration is disabled by default. Credentials belong in the ignored `apps/api/.env`, never in Git or client code.

```dotenv
TELEGRAM_ENABLED=1
TELEGRAM_BOT_TOKEN=<bot token>
TELEGRAM_BOT_USERNAME=<bot username without @>
# Comma-separated Plane user UUIDs. Empty = no task notifications sent.
TELEGRAM_DELIVERY_USER_IDS=<explicit pilot user UUID>
WEB_URL=http://localhost:3000
```

Apply migrations and recreate local API/worker/beat containers after environment changes:

```sh
docker exec plane-api-1 python manage.py migrate
docker compose -f docker-compose-local.yml up -d --no-deps api worker beat-worker
docker exec plane-api-1 python manage.py telegram_worker
```

The management command polls Telegram locally and dispatches due events. It refuses to start if a webhook already exists; it never removes a webhook. Use one polling command per bot. Celery beat also dispatches every 30 seconds; database locks prevent overlapping sends to a recipient.

Open `/settings/profile/notifications/`, connect Telegram, press Start, and explicitly confirm the displayed Telegram account back in Plane. Links are random, hashed at rest, single-use and expire after 10 minutes. Reusing a Telegram identity already connected to another Plane account is rejected. Unlinking or disabling cancels pending events.

## Local demonstration

```sh
# Create three tasks and an example thread without sending anything.
docker exec plane-api-1 python manage.py seed_telegram_demo --workspace <slug> --user-id <uuid>
# After linking and explicitly enabling this pilot recipient, enqueue sample events.
docker exec plane-api-1 python manage.py seed_telegram_demo --workspace <slug> --user-id <uuid> --emit
```

The emitter creates an assignment, mention, reply to a selected comment inside a thread, and three ordinary comments. It uses real delays and quiet hours. Disable “Working hours only” in the pilot account if testing outside its schedule. It does not shorten delays or bypass delivery limits. Only synthetic demo content is used.

## Delivery rules

- Assignment, new comment mention and direct reply: 60-second grace period.
- Assignments made when a task is created, including the project's default assignee, use the same delivery rules as later assignments. Self-assignment does not trigger a notification. The creation request records the saved assignees before background processing, and delivery rechecks that each recipient is still assigned.
- Ordinary comments: first event opens a 10-minute collection window per person/task; later comments join it, with at least a 60-second grace period.
- Mentions take precedence over replies, which take precedence over ordinary discussions. One person gets at most one alert for a given comment, including subsequent edits. Adding a new recipient by editing a comment can notify that recipient.
- Only assignments to the recipient, their explicit mentions/replies and comments on assigned tasks are enabled initially. Created/subscribed task discussions are opt-in. Telegram never uses automatic mention subscriptions unless the user enables this wider scope.
- Up to six events fit into a digest, bounded by Telegram text limits. Across all workspaces a person receives at most five delivery attempts per rolling 30 minutes (failed, definitively rejected sends do not consume that budget). Overflow stays queued.
- Default schedule: weekdays, 10:00–19:00 Europe/Moscow; users may change timezone/hours or disable scheduling. Paused/overnight events are retained.
- Own actions, revoked project access, internal comments for guests, removed assignments/mentions and deleted comments are rechecked before delivery. Direct replies and mentions are delivered even if Plane marks the comment or in-app notification read. Read ordinary discussions are suppressed; assignment read-state behavior is unchanged. Explicitly archived notifications and notification snoozes are respected for every event type. Already skipped events are not automatically replayed.
- Each numbered digest entry links to its task in the message text. Comment, mention and reply links open the specific comment, including in digests without assignments. The keyboard contains notification controls only, without duplicate navigation buttons.
- “Mute discussions” keeps explicit mentions and replies. Restore muted tasks in Plane. `/pause`, `/resume`, `/stop` control the private bot chat. Pause buttons show an exact date/time in the configured timezone; the next-day option skips weekends when weekday scheduling is enabled. Its timestamp is fixed when displayed; an expired button refreshes instead of silently choosing another date.
- While paused, the clicked message shows the pause deadline and a “Resume notifications” button. Resuming releases queued events subject to their collection delay, working hours, snoozes, retry backoff and delivery limits. The confirmation explains the actual next working time. Updating these controls edits the existing message without sending another notification.
- Definite Telegram 429/5xx failures retry with delay, at most five attempts. A 403 marks the connection blocked. A timeout or worker crash after claiming delivery is recorded as **unconfirmed** and is not automatically repeated: Telegram has no sendMessage idempotency key. This favors avoiding duplicates; inspect Delivery in the settings screen.

## Validation

`plane/tests/unit/views/test_telegram.py` covers account linking, recipient selection, reply targeting, access checks, read state, aggregation, schedule, rate limits, pilot restriction and delivery failures. `plane/tests/unit/views/test_comment_threads.py` covers existing comment behavior. Web tests: `helpers/telegram-settings.test.tsx` and `helpers/comment-reply-create.test.tsx`.

## Production

Set the bot credentials in the server's private `plane.env`, `TELEGRAM_ENABLED=1`, `TELEGRAM_DELIVERY_USER_IDS=*` and `WEB_URL=https://plane.myneogroup.space`. The wildcard permits delivery only to users who explicitly link and confirm Telegram; it does not enroll employees automatically. Old activity is not backfilled when someone connects.

Disable the same bot in the local environment and stop its local poller before enabling production. Keep local connections and demo tasks local; users link their production account through `/settings/profile/notifications/`.

Install `deploy/plane-telegram.service` as `/etc/systemd/system/plane-telegram.service`, run `systemctl daemon-reload`, then `systemctl enable --now plane-telegram`. It runs the management command inside the deployed API container and restarts after container replacement or host reboot. Credentials remain inside the API container environment. Check `systemctl status plane-telegram` and `journalctl -u plane-telegram`; never print the environment or Bot API token. To stop polling, run `systemctl stop plane-telegram`; disable `TELEGRAM_ENABLED` and recreate the API/worker/beat containers to stop all delivery as well.
