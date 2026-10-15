"""Exercise retention only in a freshly-created synthetic workspace directory."""
import importlib.util
import os
import pathlib
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('backup', ROOT / 'deploy/backup-database.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class RetentionTest(unittest.TestCase):
    def test_only_matching_old_regular_files_are_pruned_and_latest_is_kept(self):
        runtime = ROOT / '.runtime'
        runtime.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='backup-test-', dir=runtime) as name:
            directory = pathlib.Path(name).resolve()
            self.assertEqual(directory.parent, runtime.resolve())
            oldest = directory / 'projectprobe_staging-20200101T000000Z.dump'
            latest = directory / 'projectprobe_staging-20200102T000000Z.dump'
            unrelated = directory / 'other-database.dump'
            nested = directory / 'projectprobe_staging-20200103T000000Z.dump'
            nested.mkdir()
            for file in (oldest, latest, unrelated):
                file.write_bytes(b'synthetic retention fixture')
                os.utime(file, (time.time() - 5 * 86400,) * 2)
            backup.prune(directory, 2)
            self.assertFalse(oldest.exists())
            self.assertTrue(latest.exists())
            self.assertTrue(unrelated.exists())
            self.assertTrue(nested.is_dir())


if __name__ == '__main__':
    unittest.main()
