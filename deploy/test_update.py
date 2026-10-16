"""Exercise update.sh fail-closed orchestration with fake Docker/Git/curl.

No Docker, VPS, credentials, network, or real PostgreSQL restore is used here.
The backup's actual pg_dump/pg_restore still requires VPS acceptance.
Run: python3 -m unittest discover -s deploy -p 'test_update.py' -v
"""
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).with_name('update.sh')
FAKE = '''#!/usr/bin/env python3
import os, pathlib, sys
name=pathlib.Path(sys.argv[0]).name; a=sys.argv[1:]
with open(os.environ['CALL_LOG'],'a') as f: f.write(name+' '+ ' '.join(a)+'\\n')
if name=='docker':
 if 'version' in a: sys.exit(0)
 if 'exec' in a and 'pg_restore' in a:
  data=sys.stdin.buffer.read();sys.exit(0 if data.startswith(b'PGDMP') and os.environ.get('DUMP_MODE')!='corrupt' else 1)
 if 'exec' in a:
  mode=os.environ.get('DUMP_MODE','good')
  if mode=='fail':sys.stdout.write('partial');sys.exit(1)
  if mode!='empty':sys.stdout.write('PGDMP fake CLI fixture only')
 sys.exit(0)
if name=='git':
 if a[:1]==['rev-parse']: print('a'*40)
 elif a[:1]==['diff'] and '--quiet' in a: sys.exit(1 if os.environ.get('DIRTY') else 0)
 elif a[:2]==['stash','pop'] and os.environ.get('STASH_CONFLICT'):sys.exit(1)
 elif a[:1]==['pull'] and os.environ.get('MODIFY_ENV'):pathlib.Path('.env').write_text('UNEXPECTED=changed\\n')
 elif a[:1]==['log']: print('aaaaaaa fixture commit')
 sys.exit(0)
sys.exit(0)
'''


class UpdateSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='qlbs-update-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'deploy').mkdir()
        shutil.copyfile(SOURCE, self.root / 'deploy/update.sh')
        (self.root / '.env').write_text('FIXTURE_ONLY=not-a-secret\n')
        (self.root / 'docker-compose.yml').write_text('services: {}\n')
        ssl = self.root / 'data/ssl'
        ssl.mkdir(parents=True)
        (ssl / 'server.crt').write_text('fixture certificate, not a real certificate')
        (ssl / 'server.key').write_text('fixture key, not a real key')
        self.bin = self.root / 'fake-bin'
        self.bin.mkdir()
        for name in ('docker', 'git', 'curl'):
            path = self.bin / name
            path.write_text(FAKE)
            path.chmod(0o700)
        self.log = self.root / 'calls.log'

    def run_update(self, mode='good', args=None, **extra):
        env = {**os.environ, 'PATH': str(self.bin) + os.pathsep + os.environ['PATH'], 'CALL_LOG': str(self.log), 'DUMP_MODE': mode, **extra}
        for key in ('QLBS_OLD_COMMIT', 'QLBS_UPDATE_REEXEC', 'QLBS_UPDATE_BACKUP_DIR'):
            env.pop(key, None)
        result = subprocess.run(['bash', 'deploy/update.sh', *(args or ['--all', '--no-pull', '--backup'])], cwd=self.root, env=env, text=True, capture_output=True, timeout=15)
        return result, self.log.read_text()

    def assert_no_build(self, calls):
        self.assertNotIn('compose build', calls)
        self.assertNotIn('compose up', calls)
        self.assertNotIn('git pull', calls)

    def test_failed_dump_stops_before_pull_build_and_removes_partial_file(self):
        result, calls = self.run_update('fail', ['--all', '--backup'])
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_no_build(calls)
        self.assertFalse(list(self.root.glob('data/upgrade-backups/**/*.partial')))
        self.assertEqual((self.root / '.env').read_text(), 'FIXTURE_ONLY=not-a-secret\n')

    def test_empty_dump_stops_before_pull_build(self):
        result, calls = self.run_update('empty', ['--all', '--backup'])
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_no_build(calls)

    def test_unreadable_dump_stops_before_pull_build(self):
        result, calls = self.run_update('corrupt', ['--all', '--backup'])
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_no_build(calls)

    def test_success_preserves_config_cert_and_makes_private_snapshot_before_build(self):
        originals = {p: (self.root / p).read_bytes() for p in ['.env', 'docker-compose.yml', 'data/ssl/server.crt', 'data/ssl/server.key']}
        result, calls = self.run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertLess(calls.index('pg_dump'), calls.index('compose build api'))
        self.assertIn('pg_restore --list', calls)
        self.assertIn('compose build web', calls)
        self.assertIn('http://127.0.0.1:4000/health', calls, 'old .env without API_PORT must use default, not terminate under pipefail')
        self.assertIn('http://127.0.0.1:3000/login', calls)
        snapshots = list(self.root.glob('data/upgrade-backups/pre-update-*'))
        self.assertEqual(len(snapshots), 1)
        snapshot = snapshots[0]
        self.assertEqual(stat.S_IMODE(snapshot.stat().st_mode), 0o700)
        for path in ['.env', 'database.dump', 'ssl/server.key']:
            self.assertEqual((snapshot / path).stat().st_mode & 0o077, 0)
        for path, content in originals.items():
            self.assertEqual((self.root / path).read_bytes(), content)
        self.assertEqual((snapshot / '.env').read_bytes(), originals['.env'])
        self.assertEqual((snapshot / 'ssl/server.crt').read_bytes(), originals['data/ssl/server.crt'])

    def test_stash_conflict_stops_before_build_instead_of_warning_and_continuing(self):
        result, calls = self.run_update(args=['--all', '--backup'], DIRTY='1', STASH_CONFLICT='1')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('git stash pop', calls)
        self.assertNotIn('compose build', calls)
        self.assertNotIn('compose up', calls)

    def test_unexpected_env_change_during_pull_stops_before_build(self):
        result, calls = self.run_update(args=['--all', '--backup'], MODIFY_ENV='1')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn('compose build', calls)
        self.assertTrue(list(self.root.glob('data/upgrade-backups/pre-update-*/.env')))


if __name__ == '__main__':
    unittest.main()
