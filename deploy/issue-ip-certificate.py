#!/usr/bin/env python3
"""Only issue after the owner explicitly accepts the current subscriber agreement."""
import json
import pathlib
import subprocess
import urllib.request

ROOT = pathlib.Path("/opt/project-probe-staging")
DIRECTORY = "https://acme-v02.api.letsencrypt.org/directory"

def main():
    with urllib.request.urlopen(DIRECTORY, timeout=20) as response:
        terms = json.load(response)["meta"]["termsOfService"]
    acceptance = ROOT / "certificate-terms-accepted.txt"
    if not acceptance.exists() or acceptance.read_text().strip() != terms:
        raise SystemExit("Current certificate agreement requires owner acceptance; no account or certificate created")
    args = [str(ROOT / "certbot-venv/bin/certbot"), "certonly", "--non-interactive", "--agree-tos", "--register-unsafely-without-email", "--manual", "--preferred-challenges", "http", "--required-profile", "shortlived", "--ip-address", "39.96.27.134", "--cert-name", "project-probe-ip", "--manual-auth-hook", f"python3 {ROOT}/acme-hook.py auth", "--manual-cleanup-hook", f"python3 {ROOT}/acme-hook.py cleanup", "--config-dir", str(ROOT / "certificates"), "--work-dir", str(ROOT / "acme-work"), "--logs-dir", str(ROOT / "acme-logs"), "--deploy-hook", str(ROOT / "reload-https.sh")]
    subprocess.run(args, check=True)

if __name__ == "__main__":
    main()
