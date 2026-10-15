"""Publish only hashed payment UI assets; retain the independent HTTPS entry and backend."""
import getpass
import hashlib
import json
import pathlib
import shlex
import uuid

import paramiko

ROOT = pathlib.Path(__file__).resolve().parent.parent
STAGE = '/opt/project-probe-staging/.payment-ui-next-' + uuid.uuid4().hex
files = {'index.html': ROOT / 'frontend/dist/index.html'}
files.update({'assets/' + p.name: p for p in (ROOT / 'frontend/dist/assets').iterdir() if p.is_file()})
manifest = {name: hashlib.sha256(p.read_bytes()).hexdigest() for name, p in files.items()}
REMOTE = r'''
import pathlib,sys,json,hashlib,shutil,os,datetime,urllib.request,subprocess,re
root=pathlib.Path('/opt/project-probe-staging')
assert root.resolve()==root and (root/'dist').resolve()==root/'dist'
payload=json.load(sys.stdin);stage=pathlib.Path(payload['stage'])
assert stage.parent==root and re.fullmatch(r'\.payment-ui-next-[a-f0-9]{32}',stage.name)
assert stage.resolve().parent==root
for name,sha in payload['manifest'].items():
 p=stage/name
 assert p.resolve().is_relative_to(stage) and p.is_file()
 assert hashlib.sha256(p.read_bytes()).hexdigest()==sha
assert 'listen 18443 ssl;' in (root/'server-nginx.conf').read_text(),'Wrong deployment target'
def snapshot():
 return {name:hashlib.sha256((root/name).read_bytes()).hexdigest() for name in ['app.jar','backend.env','server-nginx.conf']}
before=snapshot()
states={name:subprocess.check_output(['docker','inspect','--format','{{.State.StartedAt}}',name],text=True).strip() for name in ['livesync-nginx','livesync-couchdb','project-probe-web']}
backup=root/'releases'/('payment-ui-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(mode=0o700)
shutil.copy2(root/'dist/index.html',backup/'index.html');os.chmod(backup/'index.html',0o600)
try:
 for name in payload['manifest']:
  if name=='index.html':continue
  assert re.fullmatch(r'assets/[A-Za-z0-9_.-]+',name)
  target=root/'dist'/name
  assert target.resolve().is_relative_to(root/'dist')
  shutil.copy2(stage/name,target);os.chmod(target,0o644)
 os.chmod(stage/'index.html',0o644)
 os.replace(stage/'index.html',root/'dist/index.html')
 with urllib.request.urlopen('https://39.96.27.134:18443/',timeout=10) as r:
  assert hashlib.sha256(r.read()).hexdigest()==payload['manifest']['index.html']
 assert before==snapshot(),'Backend/environment/nginx changed'
 for name,started in states.items():
  assert subprocess.check_output(['docker','inspect','--format','{{.State.StartedAt}}',name],text=True).strip()==started
 print(json.dumps({'status':'PUBLISHED','backup':str(backup),'origin':'https://39.96.27.134:18443','indexSha256':payload['manifest']['index.html'],'backendAndRuntimeUnchanged':True,'containersNotRestarted':True,'databaseWrites':0}))
except Exception:
 shutil.copy2(backup/'index.html',root/'dist/index.html');os.chmod(root/'dist/index.html',0o644)
 raise
'''
client = paramiko.SSHClient()
client.load_host_keys(str(ROOT / '.runtime/server-known-hosts'))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
client.connect('39.96.27.134', username='root', password=getpass.getpass('SSH password: '), look_for_keys=False, allow_agent=False, timeout=20)
try:
    sftp = client.open_sftp()
    sftp.mkdir(STAGE, mode=0o700); sftp.mkdir(STAGE + '/assets', mode=0o700)
    for name, path in files.items():
        sftp.put(str(path), STAGE + '/' + name); sftp.chmod(STAGE + '/' + name, 0o644)
    sftp.close()
    stdin, stdout, stderr = client.exec_command('python3 -c ' + shlex.quote(REMOTE), timeout=90)
    stdin.write(json.dumps({'stage': STAGE, 'manifest': manifest})); stdin.channel.shutdown_write()
    output, error = stdout.read().decode(), stderr.read().decode()
    if stdout.channel.recv_exit_status():
        raise RuntimeError('Payment UI release failed: ' + error[-1200:])
    result = json.loads(output)
    target = ROOT / '.runtime/payment-checkout-acceptance'
    target.mkdir(parents=True, exist_ok=True)
    (target / 'release.json').write_text(json.dumps(result), encoding='utf-8')
    print(json.dumps(result))
finally:
    client.close()
