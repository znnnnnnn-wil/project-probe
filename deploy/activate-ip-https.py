#!/usr/bin/env python3
"""Enable trusted HTTPS only after issuance; only replace this project's web container."""
import json
import pathlib
import subprocess

ROOT = pathlib.Path("/opt/project-probe-staging")
IMAGE = "ghcr.io/znnnnnnn-wil/codex-companion-web:v0.1.8"

def main():
    cert = ROOT / "certificates/live/project-probe-ip/fullchain.pem"
    subprocess.run(["openssl", "x509", "-in", str(cert), "-checkip", "39.96.27.134", "-noout"], check=True)
    subprocess.run(["openssl", "x509", "-in", str(cert), "-checkend", "86400", "-noout"], check=True)
    mounts = json.loads(subprocess.check_output(["docker", "inspect", "--format", "{{json .Mounts}}", "project-probe-web"], text=True))
    assert any(item["Source"] == str(ROOT / "dist") and item["Destination"] == "/usr/share/nginx/html" for item in mounts), "Container does not belong to this release"
    current = (ROOT / "server-nginx.conf").read_text()
    assert "listen 443 ssl" not in current, "HTTPS already configured; use renewal reload"
    pending = ROOT / "pending-nginx.conf"
    pending.write_text(current + "\n" + (ROOT / "server-ip-https.conf").read_text())
    args = ["--network", "host", "--memory", "64m", "--entrypoint", "nginx", "-v", str(ROOT / "dist") + ":/usr/share/nginx/html:ro", "-v", str(pending) + ":/etc/nginx/conf.d/default.conf:ro", "-v", str(ROOT / "certificates") + ":/certificates:ro"]
    subprocess.run(["docker", "run", "--rm", *args, IMAGE, "-t"], check=True)
    # Validate before stopping our own web container. Existing 80/8081 services are untouched.
    subprocess.run(["docker", "stop", "project-probe-web"], check=True)
    subprocess.run(["docker", "rm", "project-probe-web"], check=True)
    (ROOT / "server-nginx.conf").write_text(pending.read_text())
    args[args.index(str(pending) + ":/etc/nginx/conf.d/default.conf:ro")] = str(ROOT / "server-nginx.conf") + ":/etc/nginx/conf.d/default.conf:ro"
    subprocess.run(["docker", "run", "-d", "--name", "project-probe-web", "--restart", "unless-stopped", *args, IMAGE, "-g", "daemon off;"], check=True)
    profile = ROOT / "backend.env"
    value = profile.read_text().replace("APP_ORIGIN=http://localhost:18088", "APP_ORIGIN=https://39.96.27.134").replace("SECURE_COOKIE=false", "SECURE_COOKIE=true")
    profile.write_text(value)
    profile.chmod(0o600)
    subprocess.run(["systemctl", "restart", "project-probe-backend"], check=True)
    print("HTTPS activated; payment mode unchanged; public TLS and renewal dry-run still require verification")

if __name__ == "__main__":
    main()
