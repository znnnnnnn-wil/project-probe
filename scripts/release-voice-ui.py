"""Publish browser VAD and its WASM security headers; no backend/environment/database changes."""
import getpass
import hashlib
import json
import pathlib
import shlex
import uuid
import paramiko

ROOT = pathlib.Path(__file__).resolve().parent.parent
STAGE = '/opt/project-probe-staging/.voice-next-' + uuid.uuid4().hex
files = {'dist/' + p.relative_to(ROOT / 'frontend/dist').as_posix(): p
         for p in (ROOT / 'frontend/dist').rglob('*') if p.is_file()}
files['server-nginx.conf'] = ROOT / 'deploy/server-ip-https.conf'
manifest = {name: hashlib.sha256(p.read_bytes()).hexdigest() for name, p in files.items()}
REMOTE = r'''
import pathlib,sys,json,hashlib,shutil,os,datetime,urllib.request,subprocess
root=pathlib.Path('/opt/project-probe-staging')
assert root.resolve()==root and (root/'dist').resolve()==root/'dist'
assert (root/'server-nginx.conf').resolve()==root/'server-nginx.conf'
payload=json.load(sys.stdin)
stage=pathlib.Path(payload['stage'])
assert stage.parent==root and stage.name.startswith('.voice-next-') and len(stage.name)==44
assert stage.resolve().parent==root
for name,sha in payload['manifest'].items():
 p=stage/name
 assert p.resolve().is_relative_to(stage) and p.is_file()
 assert hashlib.sha256(p.read_bytes()).hexdigest()==sha
def config():
 with urllib.request.urlopen('http://127.0.0.1:18089/api/config',timeout=5) as r:return json.load(r)
before=config()
assert before.get('speechEnabled') and before.get('modelMode')=='live' and before.get('paymentMode')=='sandbox'
backup=root/'releases'/('vad-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(mode=0o700)
shutil.copytree(root/'dist',backup/'dist')
shutil.copy2(root/'server-nginx.conf',backup/'server-nginx.conf');os.chmod(backup/'server-nginx.conf',0o600)
assert 'server_name 39.96.27.134;' in (root/'server-nginx.conf').read_text()
def nginx(args):subprocess.run(['docker','exec','project-probe-web','nginx']+args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
for directory,_,names in os.walk(backup/'dist'):
 os.chmod(directory,0o700)
 for name in names:os.chmod(pathlib.Path(directory)/name,0o600)
try:
 for source in (stage/'dist').rglob('*'):
  if source.is_file() and source.name!='index.html':
   target=root/'dist'/source.relative_to(stage/'dist')
   assert target.resolve().is_relative_to(root/'dist')
   target.parent.mkdir(parents=True,exist_ok=True)
   shutil.copy2(source,target);os.chmod(target,0o644)
 assert (root/'dist/index.html').resolve()==root/'dist/index.html'
 new_config=(stage/'server-nginx.conf').read_bytes()
 assert b"'wasm-unsafe-eval'" in new_config and b"'unsafe-eval'" not in new_config and b'proxy_pass http://127.0.0.1:18089;' in new_config
 (root/'server-nginx.conf').write_bytes(new_config)
 nginx(['-t']);nginx(['-s','reload'])
 os.chmod(stage/'dist/index.html',0o644)
 os.replace(stage/'dist/index.html',root/'dist/index.html')
 with urllib.request.urlopen('https://39.96.27.134/',timeout=10) as r:
  assert hashlib.sha256(r.read()).hexdigest()==payload['manifest']['dist/index.html']
 assert before==config(),'Runtime configuration changed'
 print(json.dumps({'status':'PUBLISHED','backup':str(backup),'nginxWasmHeadersUpdated':True,'backendRestarted':False,'runtimeSettingsUnchanged':True,'indexSha256':payload['manifest']['dist/index.html']}))
except Exception:
 shutil.copy2(backup/'dist/index.html',root/'dist/index.html');os.chmod(root/'dist/index.html',0o644)
 (root/'server-nginx.conf').write_bytes((backup/'server-nginx.conf').read_bytes());nginx(['-t']);nginx(['-s','reload'])
 raise
'''
client = paramiko.SSHClient()
client.load_host_keys(str(ROOT / '.runtime/server-known-hosts'))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
client.connect('39.96.27.134', username='root', password=getpass.getpass('SSH password: '),
               look_for_keys=False, allow_agent=False, timeout=20)
try:
    sftp = client.open_sftp()
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
    sftp.close()
    stdin, stdout, stderr = client.exec_command('python3 -c ' + shlex.quote(REMOTE), timeout=90)
    stdin.write(json.dumps({'stage': STAGE, 'manifest': manifest})); stdin.channel.shutdown_write()
    output, error = stdout.read().decode(), stderr.read().decode()
    if stdout.channel.recv_exit_status(): raise RuntimeError('UI release failed: ' + error[-1600:])
    result = json.loads(output)
    destination = ROOT / '.runtime/vad-acceptance'
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'release.json').write_text(json.dumps(result), encoding='utf-8')
    print(json.dumps(result))
finally:
    client.close()
