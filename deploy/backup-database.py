"""Daily protected PostgreSQL backup; installation is an explicit deployment step."""
import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tempfile
import time

ROOT = pathlib.Path('/opt/project-probe-staging')
PATTERN = re.compile(r'projectprobe_staging-\d{8}T\d{6}Z\.dump')


def prune(directory, keep_days):
    directory = directory.resolve(strict=True)
    files = sorted(p for p in directory.iterdir() if PATTERN.fullmatch(p.name)
                   and p.is_file() and not p.is_symlink())
    for path in files[:-1]:
        if path.resolve().parent != directory:
            raise RuntimeError('Backup path escaped its directory')
        if path.stat().st_mtime < time.time() - keep_days * 86400:
            path.unlink()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--keep-days', type=int, default=14)
    args = parser.parse_args()
    if not 2 <= args.keep_days <= 365:
        parser.error('keep-days must be 2–365')
    if ROOT.resolve(strict=True) != ROOT:
        raise RuntimeError('Unexpected deployment root')
    directory = ROOT / 'backups'
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.is_symlink() or directory.resolve().parent != ROOT:
        raise RuntimeError('Unexpected backup directory')
    os.chmod(directory, 0o700)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    target = directory / f'projectprobe_staging-{stamp}.dump'
    descriptor, name = tempfile.mkstemp(prefix='.backup-', dir=directory)
    temporary = pathlib.Path(name)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dump', '-Fc', 'projectprobe_staging'],
                           stdout=output, stderr=subprocess.PIPE, check=True, timeout=300)
            output.flush()
            os.fsync(output.fileno())
        subprocess.run(['pg_restore', '--list', str(temporary)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=60)
        if target.exists():
            raise RuntimeError('Backup target already exists')
        os.replace(temporary, target)
        prune(directory, args.keep_days)
        print(json.dumps({'file': target.name, 'bytes': target.stat().st_size,
                          'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}))
    finally:
        if temporary.exists() and temporary.resolve().parent == directory.resolve():
            temporary.unlink()


if __name__ == '__main__':
    main()
