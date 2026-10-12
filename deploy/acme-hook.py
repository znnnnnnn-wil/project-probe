#!/usr/bin/env python3
"""Certbot HTTP-01 hooks: only manage challenge files in the existing web container."""
import os
import re
import subprocess
import sys
import urllib.request

CONTAINER = "deploy-web-1"
ROOT = "/usr/share/nginx/html/.well-known/acme-challenge"
ADDRESS = "39.96.27.134"

def main():
    action = sys.argv[1]
    token = os.environ.get("CERTBOT_TOKEN", "")
    identifier = os.environ.get("CERTBOT_IDENTIFIER", os.environ.get("CERTBOT_DOMAIN", ""))
    if action not in ("auth", "cleanup") or identifier != ADDRESS or not re.fullmatch(r"[A-Za-z0-9_-]{16,256}", token):
        raise ValueError("Invalid challenge scope")
    file = f"{ROOT}/{token}"
    if action == "cleanup":
        subprocess.run(["docker", "exec", CONTAINER, "rm", "-f", file], check=True, capture_output=True)
        return
    validation = os.environ.get("CERTBOT_VALIDATION", "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{16,512}", validation):
        raise ValueError("Invalid validation value")
    subprocess.run(["docker", "exec", CONTAINER, "mkdir", "-p", ROOT], check=True, capture_output=True)
    # noclobber prevents overwriting any pre-existing website file.
    subprocess.run(["docker", "exec", "-i", CONTAINER, "sh", "-c", 'set -C; cat > "$1"', "sh", file], input=validation.encode(), check=True, capture_output=True)
    request = urllib.request.Request(f"http://127.0.0.1/.well-known/acme-challenge/{token}", headers={"Host": ADDRESS})
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 200 or response.read().decode() != validation:
            raise ValueError("Challenge not reachable")

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("ACME hook failed; original web service was not restarted", file=sys.stderr)
        sys.exit(1)
