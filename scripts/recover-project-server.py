"""Recreate the project on a confirmed reset host, preserving LiveSync and its database."""
import getpass
import hashlib
import json
import pathlib
import re
import shlex
import uuid

import paramiko
from cryptography.hazmat.primitives import serialization

ROOT = pathlib.Path(__file__).resolve().parent.parent
SERVER = '/opt/project-probe-staging'
STAGE = SERVER + '/.recovery-next-' + uuid.uuid4().hex
ORIGIN = 'https://39.96.27.134:18443'


def profile(path):
    result = {}
    for raw in path.read_text(encoding='utf-8-sig').splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        key, sep, value = line.partition('=')
        if sep and re.fullmatch('[A-Z][A-Z0-9_]*', key):
            result[key] = value.strip()
    return result


payment = profile(ROOT / '.secrets/alipay/sandbox/payment.env')
for key in ['ALIPAY_SANDBOX_APP_ID', 'ALIPAY_SANDBOX_SELLER_ID']:
    assert re.fullmatch(r'\d{10,32}', payment.get(key, '')), 'Missing sandbox identity'
secrets = {}
for key, name in [('ALIPAY_SANDBOX_PRIVATE_KEY_FILE', 'application-private.pem'), ('ALIPAY_SANDBOX_PUBLIC_KEY_FILE', 'alipay-public.pem')]:
    source = pathlib.Path(payment[key]).resolve()
    assert source.is_relative_to((ROOT / '.secrets/alipay/sandbox').resolve()), 'Not a sandbox key'
    secrets[name] = source.read_bytes()
private = serialization.load_pem_private_key(secrets['application-private.pem'], password=None)
application_public = serialization.load_pem_public_key((source.parent / 'application-public.pem').read_bytes())
platform_public = serialization.load_pem_public_key(secrets['alipay-public.pem'])
assert private.key_size >= 2048 and platform_public.key_size >= 2048
assert private.public_key().public_numbers() == application_public.public_numbers(), 'Sandbox key pair mismatch'
assert private.public_key().public_numbers() != platform_public.public_numbers(), 'Wrong platform verification key'

settings = {
    'MODEL_MODE': 'live', 'MODEL_PROVIDER': 'DashScope',
    'MODEL_NAME': 'deepseek-v4.1-flash', 'MODEL_BASE_URL': 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    'MODEL_TIMEOUT_SECONDS': '40', 'MODEL_FREE_QUOTA_ONLY': 'true',
    'MODEL_FREE_QUOTA_CONFIRMED_MODEL': 'deepseek-v4.1-flash',
    'SPEECH_ENABLED': 'true', 'SPEECH_PAID_ALLOWED': 'true', 'SPEECH_MODEL': 'qwen3-asr-flash',
    'SPEECH_BASE_URL': 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'SPEECH_DAILY_LIMIT': '20',
    'PAYMENT_MODE': 'sandbox', 'PAYMENT_OPERATIONS_ENABLED': 'false',
    'PAYMENT_RECONCILE_ENABLED': 'false', 'PAYMENT_EXPIRY_SYNC_ENABLED': 'true',
    'TRAINING_PRICE_CENTS': '990', 'ORDER_TTL_MINUTES': '30',
    'ALIPAY_SANDBOX_APP_ID': payment['ALIPAY_SANDBOX_APP_ID'],
    'ALIPAY_SANDBOX_SELLER_ID': payment['ALIPAY_SANDBOX_SELLER_ID'],
    'ALIPAY_SANDBOX_MERCHANT_CONFIRMED': 'true',
    'ALIPAY_SANDBOX_PRIVATE_KEY_FILE': '/run/credentials/project-probe-backend.service/application-private.pem',
    'ALIPAY_SANDBOX_PUBLIC_KEY_FILE': '/run/credentials/project-probe-backend.service/alipay-public.pem',
    'ALIPAY_SANDBOX_NOTIFY_URL': ORIGIN + '/api/payments/notify',
    'ALIPAY_SANDBOX_RETURN_URL': ORIGIN + '/payment-return',
    'APP_ORIGIN': ORIGIN, 'SECURE_COOKIE': 'true', 'TRUSTED_PROXY_ADDRESSES': '127.0.0.1,::1',
    'PORT': '18089', 'BIND_ADDRESS': '127.0.0.1', 'DB_USER': 'projectprobe_staging',
    'DB_URL': 'jdbc:postgresql://127.0.0.1:5432/projectprobe_staging',
}

files = {'app.jar': ROOT / 'backend/target/project-probe-1.0.0.jar',
         'server-nginx.conf': ROOT / 'deploy/server-ip-https.conf'}
for path in (ROOT / 'frontend/dist').rglob('*'):
    if path.is_file():
        files['dist/' + path.relative_to(ROOT / 'frontend/dist').as_posix()] = path
manifest = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in files.items()}

REMOTE = r"""
import pathlib,sys,json,hashlib,subprocess,os,secrets,time,urllib.request,socket,re,shutil
root=pathlib.Path('/opt/project-probe-staging')
data=json.load(sys.stdin);stage=pathlib.Path(data['stage'])
assert root.resolve()==root and stage.parent==root and stage.name.startswith('.recovery-next-')
assert not (root/'backend.env').exists() and not (root/'app.jar').exists(),'Do not overwrite an existing installation'
def run(args,timeout=60,input=None):
 p=subprocess.run(args,input=input,capture_output=True,timeout=timeout)
 if p.returncode:raise RuntimeError('Command failed: '+args[0]+' '+p.stderr.decode(errors='replace')[-800:])
 return p.stdout.decode()
def sql(q):return run(['runuser','-u','postgres','--','psql','-v','ON_ERROR_STOP=1','-At','-d','postgres','-c',q])
before={name:json.loads(run(['docker','inspect','--format','{{json .State}}',name])) for name in ['livesync-nginx','livesync-couchdb']}
for port in [18089,18443]:
 sock=socket.socket();sock.bind(('127.0.0.1',port));sock.close()
assert not sql("SELECT 1 FROM pg_database WHERE datname='projectprobe_staging'").strip(),'Existing database requires recovery'
assert not sql("SELECT 1 FROM pg_roles WHERE rolname='projectprobe_staging'").strip(),'Existing role requires recovery'
for relative,sha in data['manifest'].items():
 p=stage/relative
 assert p.resolve().is_relative_to(stage.resolve()) and p.is_file()
 assert hashlib.sha256(p.read_bytes()).hexdigest()==sha
nginx=pathlib.Path('/opt/obsidian-livesync/config/nginx.conf').read_text()
matches=re.findall(r'^\s*ssl_certificate\s+([^;]+);',nginx,re.M)
cert=None
for value in matches:
 p=pathlib.Path(value.strip().strip('"'))
 if not p.is_absolute() or not str(p).startswith('/etc/letsencrypt/live/'):continue
 try:
  run(['openssl','x509','-in',str(p),'-checkip','39.96.27.134','-noout'])
  run(['openssl','x509','-in',str(p),'-checkend','86400','-noout'])
  cert=p;break
 except RuntimeError:pass
assert cert is not None,'No reusable valid IP certificate'
key=cert.parent/'privkey.pem'
assert key.is_file() and key.resolve().is_relative_to(pathlib.Path('/etc/letsencrypt'))
certificate_info=run(['openssl','x509','-in',str(cert),'-noout','-issuer','-dates','-ext','subjectAltName'])
image=run(['docker','inspect','--format','{{.Config.Image}}','livesync-nginx']).strip()
assert image and not image.startswith('-')
config=(stage/'server-nginx.conf').read_text().replace('listen 443 ssl;', 'listen 18443 ssl;')
config=config.replace('/certificates/live/project-probe-ip/fullchain.pem','/certificates/'+str(cert.relative_to('/etc/letsencrypt')))
config=config.replace('/certificates/live/project-probe-ip/privkey.pem','/certificates/'+str(key.relative_to('/etc/letsencrypt')))
assert 'client_max_body_size 7m;' in config and "wasm-unsafe-eval" in config
(root/'server-nginx.conf').write_text(config);os.chmod(root/'server-nginx.conf',0o644)
credentials=root/'credentials';credentials.mkdir(mode=0o700)
for name in ['application-private.pem','alipay-public.pem']:
 p=stage/name
 assert p.is_file() and (p.stat().st_mode&0o777)==0o600
 os.replace(p,credentials/name)
password=secrets.token_urlsafe(40)
sql("CREATE ROLE projectprobe_staging LOGIN PASSWORD '"+password+"'")
sql('CREATE DATABASE projectprobe_staging OWNER projectprobe_staging')
settings=data['settings'];settings['DB_PASSWORD']=password
assert '\n' not in settings['MODEL_API_KEY'] and settings['MODEL_API_KEY']
settings['SPEECH_API_KEY']=settings['MODEL_API_KEY']
(root/'backend.env').write_text(''.join(k+'='+json.dumps(v)+'\n' for k,v in settings.items()))
os.chmod(root/'backend.env',0o600)
os.replace(stage/'app.jar',root/'app.jar');os.chmod(root/'app.jar',0o644)
os.replace(stage/'dist',root/'dist')
for directory,_,names in os.walk(root/'dist'):
 os.chmod(directory,0o755)
 for name in names:os.chmod(pathlib.Path(directory)/name,0o644)
unit=pathlib.Path('/etc/systemd/system/project-probe-backend.service')
assert not unit.exists()
unit.write_text('''[Unit]
Description=Project Probe backend
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
DynamicUser=yes
WorkingDirectory=/opt/project-probe-staging
EnvironmentFile=/opt/project-probe-staging/backend.env
LoadCredential=application-private.pem:/opt/project-probe-staging/credentials/application-private.pem
LoadCredential=alipay-public.pem:/opt/project-probe-staging/credentials/alipay-public.pem
ExecStart=/usr/bin/java -Xms64m -Xmx320m -jar /opt/project-probe-staging/app.jar
Restart=on-failure
RestartSec=5
MemoryMax=448M
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
UMask=0077

[Install]
WantedBy=multi-user.target
''')
run(['systemctl','daemon-reload'])
run(['systemctl','enable','--now','project-probe-backend.service'])
for _ in range(75):
 try:
  with urllib.request.urlopen('http://127.0.0.1:18089/api/config',timeout=3) as r:health=json.load(r)
  if health.get('modelMode')=='live' and health.get('paymentMode')=='sandbox' and health.get('speechEnabled'):break
 except Exception:pass
 time.sleep(1)
else:raise RuntimeError('Backend health check failed; files preserved')
versions=run(['runuser','-u','postgres','--','psql','-At','-d','projectprobe_staging','-c','SELECT version,success FROM flyway_schema_history ORDER BY installed_rank']).strip().splitlines()
assert '9|t' in versions
args=['--network','host','--memory','64m','--entrypoint','nginx','-v',str(root/'dist')+':/usr/share/nginx/html:ro','-v',str(root/'server-nginx.conf')+':/etc/nginx/conf.d/default.conf:ro','-v','/etc/letsencrypt:/certificates:ro']
run(['docker','run','--rm',*args,image,'-t'])
run(['docker','run','-d','--name','project-probe-web','--restart','unless-stopped',*args,image,'-g','daemon off;'])
hook=pathlib.Path('/etc/letsencrypt/renewal-hooks/deploy/project-probe-reload')
hook.parent.mkdir(parents=True,exist_ok=True)
assert not hook.exists()
hook.write_text('''#!/bin/sh
set -eu
if [ "$(docker inspect --format '{{.State.Running}}' project-probe-web 2>/dev/null || true)" = true ]; then
    docker exec project-probe-web nginx -t
    docker exec project-probe-web nginx -s reload
fi
''');os.chmod(hook,0o700)
for name,old in before.items():
 now=json.loads(run(['docker','inspect','--format','{{json .State}}',name]))
 assert now['Running'] and now['StartedAt']==old['StartedAt'],'Existing service changed'
renew_timers=run(['systemctl','list-timers','--all','--no-pager'])
renew_summary=[line for line in renew_timers.splitlines() if 'cert' in line.lower()]
print(json.dumps({'status':'RESTORED','origin':'https://39.96.27.134:18443','newEmptyDatabase':True,'migrationVersions':versions,'config':health,'existingLiveSyncUnchanged':True,'certificateInfo':certificate_info,'certificateRenewalTimers':renew_summary,'sharedCertificateReloadHook':str(hook),'jarSha256':data['manifest']['app.jar'],'indexSha256':data['manifest']['dist/index.html']}))
"""

client = paramiko.SSHClient()
client.load_host_keys(str(ROOT / '.runtime/server-known-hosts'))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
password = getpass.getpass('SSH password: ')
settings['MODEL_API_KEY'] = getpass.getpass('Bailian API key: ')
client.connect('39.96.27.134', username='root', password=password, look_for_keys=False, allow_agent=False, timeout=20)
try:
    sftp = client.open_sftp()
    try:
        sftp.stat(SERVER)
    except FileNotFoundError:
        sftp.mkdir(SERVER, mode=0o755)
    sftp.mkdir(STAGE, mode=0o700)
    directories = {STAGE}
    for name, path in files.items():
        destination = pathlib.PurePosixPath(STAGE) / name
        for directory in reversed(destination.parent.parents):
            if str(directory).startswith(STAGE) and str(directory) not in directories:
                sftp.mkdir(str(directory)); directories.add(str(directory))
        if str(destination.parent) not in directories:
            sftp.mkdir(str(destination.parent)); directories.add(str(destination.parent))
        sftp.put(str(path), str(destination)); sftp.chmod(str(destination), 0o644)
    for name, content in secrets.items():
        with sftp.open(STAGE + '/' + name, 'wb') as f:
            f.write(content)
        sftp.chmod(STAGE + '/' + name, 0o600)
    sftp.close()
    stdin, stdout, stderr = client.exec_command('python3 -c ' + shlex.quote(REMOTE), timeout=180)
    stdin.write(json.dumps({'stage': STAGE, 'manifest': manifest, 'settings': settings})); stdin.channel.shutdown_write()
    output, error = stdout.read().decode(), stderr.read().decode()
    if stdout.channel.recv_exit_status():
        raise RuntimeError('Recovery failed; scoped files preserved. Diagnostic: ' + error[-1400:])
    result = json.loads(output)
    target = ROOT / '.runtime/server-reset-recovery'
    target.mkdir(parents=True, exist_ok=True)
    (target / 'release.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
finally:
    client.close()
