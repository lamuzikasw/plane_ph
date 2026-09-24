import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import ExitStack
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).parents[1] / 'plane-ci-deploy.py')
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def test_rejects_shell_injection_and_non_commit_refs(self):
        for revision in ('main', '../main', 'a' * 40 + ';whoami', 'A' * 40):
            with self.assertRaises(ValueError):
                deploy.validate_arguments(revision, 'b' * 64)

    def test_requires_checksum(self):
        with self.assertRaises(ValueError):
            deploy.validate_arguments('a' * 40, 'bad')
        deploy.validate_arguments('a' * 40, 'b' * 64)

    def test_updates_only_plane_application_images_preserving_environment(self):
        original = 'services:\n' + ''.join(
            f'  {service}:\n    image: local/plane:old\n'
            for service in (*deploy.SERVICES, 'migrator', 'admin', 'space', 'live')
        ) + '    environment:\n      SECRET: unchanged\n'
        result = deploy.replace_images(original, 'a' * 40)
        self.assertEqual(result.count('ci-' + 'a' * 40), 5)
        self.assertIn('  admin:\n    image: local/plane:old', result)
        self.assertIn('      SECRET: unchanged', result)

    def test_unexpected_override_fails_before_switch(self):
        with self.assertRaises(ValueError):
            deploy.replace_images('services:\n', 'a' * 40)

    def test_empty_or_oversized_upload_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                deploy.receive_archive(io.BytesIO(), Path(directory) / 'empty')
            with patch.object(deploy, 'MAX_ARCHIVE', 3), self.assertRaises(ValueError):
                deploy.receive_archive(io.BytesIO(b'toolarge'), Path(directory) / 'large')

    def test_atomic_write_keeps_backup_private(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'override.yaml'
            deploy.atomic_write(destination, 'original')
            deploy.atomic_write(destination, 'updated')
            self.assertEqual(destination.read_text(), 'updated')
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)
            self.assertFalse(destination.with_suffix('.yaml.next').exists())

    def test_failed_health_check_restores_previous_images_without_restoring_database(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as patches:
            root = Path(directory)
            original = 'services:\n' + ''.join(
                f'  {service}:\n    image: local/plane:previous\n'
                for service in (*deploy.SERVICES, 'migrator')
            )
            override = root / 'docker-compose.override.yaml'
            override.write_text(original)
            for name, value in [('APP', root), ('RELEASES', root / 'releases'),
                                ('BACKUPS', root / 'backups')]:
                patches.enter_context(patch.object(deploy, name, value))
            patches.enter_context(patch.object(deploy.os, 'umask'))
            patches.enter_context(patch.object(deploy.shutil, 'disk_usage',
                                               return_value=SimpleNamespace(free=10 * 1024**3)))
            patches.enter_context(patch.object(deploy.sys, 'stdin',
                                               SimpleNamespace(buffer=io.BytesIO(b'images'))))
            runner = patches.enter_context(patch.object(deploy, 'run',
                                              return_value=SimpleNamespace(stdout='a' * 40)))
            composer = patches.enter_context(patch.object(deploy, 'compose'))
            patches.enter_context(patch.object(deploy.urllib.request, 'urlopen',
                                               return_value=io.BytesIO(b'previous index')))
            patches.enter_context(patch.object(deploy, 'healthy', side_effect=[False, True]))
            with self.assertRaisesRegex(RuntimeError, 'Web/API checks failed'):
                deploy.deploy('a' * 40, 'b' * 64)
            restored = override.read_text()
            self.assertEqual(restored.count('local/plane-rollback:'), 5)
            self.assertNotIn('ci-' + 'a' * 40, restored)
            self.assertFalse((root / 'releases/current.json').exists())
            self.assertEqual(sum(call.args[:2] == ('up', '-d')
                                 for call in composer.call_args_list), 2)
            restores = [call for call in runner.call_args_list if 'pg_restore' in call.args]
            self.assertEqual(len(restores), 1)
            self.assertIn('-l', restores[0].args)  # Validate dump; never restore user data.
            commands = [call.args[:2] for call in runner.call_args_list]
            self.assertLess(commands.index(('docker', 'tag')), commands.index(('docker', 'load')))
