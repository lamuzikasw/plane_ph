#!/usr/bin/env python3
"""Root-owned entry point. Installed manually; never executed from an uploaded release."""

import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

APP = Path('/opt/plane/plane-app')
RELEASES = Path('/opt/plane/releases')
BACKUPS = Path('/opt/plane/backups')
SITE = 'https://plane.myneogroup.space'
SERVICES = ('api', 'worker', 'beat-worker', 'web')
MAX_ARCHIVE = 1024 * 1024 * 1024


def validate_arguments(revision, index_hash):
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('Expected a full Git commit SHA')
    if not re.fullmatch(r'[0-9a-f]{64}', index_hash):
        raise ValueError('Expected an index.html SHA256')


def replace_images(original, revision):
    return replace_image_map(original, {
        service: f'local/plane-{"frontend" if service == "web" else "backend"}:ci-{revision}'
        for service in (*SERVICES, 'migrator')
    })


def replace_image_map(original, images):
    result = original
    for service, image in images.items():
        pattern = rf'(^  {re.escape(service)}:\n    image: )[^\n]+'
        result, count = re.subn(
            pattern, rf'\g<1>{image}', result, flags=re.M
        )
        if count != 1:
            raise ValueError(f'Expected exactly one image override for {service}')
    return result


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def compose(*args, **kwargs):
    return run(str(APP / 'compose-safe.sh'), *args, cwd=APP, **kwargs)


def atomic_write(path, content):
    temporary = path.with_suffix(path.suffix + '.next')
    temporary.write_text(content)
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def receive_archive(stream, destination):
    size = 0
    with destination.open('xb') as output:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_ARCHIVE:
                raise ValueError('Release archive exceeds 1 GiB')
            output.write(chunk)
    if size == 0:
        raise ValueError('Empty release archive')


def healthy(index_hash, attempts=36):
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(SITE + '/', timeout=10) as response:
                digest = hashlib.sha256(response.read()).hexdigest()
            with urllib.request.urlopen(SITE + '/api/instances/', timeout=10) as response:
                api_ok = response.status == 200
            states = [
                run('docker', 'inspect', '--format', '{{.State.Running}}',
                    f'plane-app-{name}-1', capture_output=True, text=True).stdout.strip()
                for name in SERVICES
            ]
            if digest == index_hash and api_ok and all(state == 'true' for state in states):
                return True
        except (OSError, subprocess.CalledProcessError):
            pass
        time.sleep(5)
    return False


def interrupt(signum, _frame):
    raise RuntimeError(f'Deployment interrupted by signal {signum}')


def deploy(revision, index_hash):
    validate_arguments(revision, index_hash)
    os.umask(0o077)
    RELEASES.mkdir(parents=True, exist_ok=True)
    with (RELEASES / 'deploy.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if shutil.disk_usage(RELEASES).free < 5 * 1024**3:
            raise RuntimeError('Less than 5 GiB free; clean up old Plane releases first')
        name = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + revision[:12]
        release = RELEASES / name
        release.mkdir()
        archive = release / 'images.tar.gz'
        print(f'Receiving release {name}', flush=True)
        receive_archive(sys.stdin.buffer, archive)
        run('gzip', '-t', str(archive))
        override = APP / 'docker-compose.override.yaml'
        original = override.read_text()
        updated = replace_images(original, revision)
        # Preserve actual running images BEFORE docker load can replace a tag.
        # This also makes a repeated deployment of the same commit rollback-safe.
        previous_images = {}
        for service in SERVICES:
            image_id = run('docker', 'inspect', '--format', '{{.Image}}',
                           f'plane-app-{service}-1', capture_output=True, text=True).stdout.strip()
            previous_images[service] = f'local/plane-rollback:{name}-{service}'
            run('docker', 'tag', image_id, previous_images[service])
        previous_images['migrator'] = previous_images['api']
        rollback_override = replace_image_map(original, previous_images)
        # Point the current config at those exact same images as well. A failed
        # load/migration must not make a later restart use a replaced SHA tag.
        atomic_write(override, rollback_override)
        run('docker', 'load', '-i', str(archive))
        for component in ('backend', 'frontend'):
            label = run(
                'docker', 'inspect', '--format',
                '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
                f'local/plane-{component}:ci-{revision}', capture_output=True, text=True
            ).stdout.strip()
            if label != revision:
                raise RuntimeError(f'Unexpected {component} image revision')
        archive.unlink()  # Images are in Docker; do not retain a second large copy.

        backup = BACKUPS / name
        backup.mkdir(parents=True)
        atomic_write(backup / 'docker-compose.override.yaml', rollback_override)
        atomic_write(backup / 'source-override.yaml', original)
        with (backup / 'image-ids.txt').open('w') as output:
            compose('images', stdout=output)
        # Read DB credentials inside its container, never into Actions logs.
        print(f'Backing up database to {backup}', flush=True)
        with (backup / 'database.dump').open('xb') as output:
            run('docker', 'exec', 'plane-app-plane-db-1', 'sh', '-c',
                'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" '
                '-d "$POSTGRES_DB" -Fc', stdout=output)
        with (backup / 'database.dump').open('rb') as source:
            run('docker', 'exec', '-i', 'plane-app-plane-db-1', 'pg_restore', '-l',
                stdin=source, stdout=subprocess.DEVNULL)
        with urllib.request.urlopen(SITE + '/', timeout=15) as response:
            old_index_hash = hashlib.sha256(response.read()).hexdigest()
        candidate = release / 'compose.yaml'
        atomic_write(candidate, updated)
        environment = {**os.environ, 'PLANE_COMPOSE_OVERRIDE': str(candidate)}
        print('Applying migrations while the previous version is still running', flush=True)
        compose('run', '--rm', '--no-deps', 'api', 'python', 'manage.py', 'migrate',
                '--noinput', env=environment)
        switched = False
        try:
            switched = True
            atomic_write(override, updated)
            compose('up', '-d', '--no-deps', *SERVICES)
            if not healthy(index_hash):
                raise RuntimeError('Web/API checks failed or served the wrong web release')
            worker = compose('exec', '-T', 'worker', 'celery', '-A', 'plane', 'inspect',
                             'ping', '--timeout=10', capture_output=True, text=True, timeout=90)
            if 'pong' not in worker.stdout:
                raise RuntimeError('Celery worker did not answer ping')
            metadata = {'revision': revision, 'index_sha256': index_hash,
                        'backup': str(backup), 'release': name}
            atomic_write(release / 'release.json', json.dumps(metadata, indent=2) + '\n')
            atomic_write(RELEASES / 'current.json', json.dumps(metadata, indent=2) + '\n')
            print(f'Deployed {revision}; API, web revision and worker checks passed', flush=True)
        except BaseException:
            if switched:
                print('Release failed. Restoring previous application images.', flush=True)
                atomic_write(override, rollback_override)
                compose('up', '-d', '--no-deps', *SERVICES)
                if not healthy(old_index_hash):
                    print('ROLLBACK HEALTH CHECK FAILED: operator action required', file=sys.stderr)
                else:
                    print('Previous application version is healthy again', flush=True)
                print('Database was NOT restored; migrations must be backward compatible.', flush=True)
            raise


if __name__ == '__main__':
    for deployment_signal in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(deployment_signal, interrupt)
    if len(sys.argv) != 3:
        sys.exit('Usage: plane-ci-deploy COMMIT_SHA INDEX_SHA256')
    deploy(*sys.argv[1:])
