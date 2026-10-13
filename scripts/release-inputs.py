"""Publish resume deduplication without changing runtime model/payment settings."""
import getpass
import hashlib
import json
import pathlib
import shlex
import uuid

import paramiko

ROOT = pathlib.Path(__file__).resolve().parent.parent
STAGE = '/opt/project-probe-staging/.inputs-next-' + uuid.uuid4().hex
files = {'app.jar': ROOT / 'backend/target/project-probe-1.0.0.jar',
         'server-nginx.conf': ROOT / 'deploy/server-ip-https.conf'}
for path in (ROOT / 'frontend/dist').rglob('*'):
    if path.is_file():
        files['dist/' + path.relative_to(ROOT / 'frontend/dist').as_posix()] = path
manifest = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in files.items()}

REMOTE = r'''
import pathlib,sys,json,hashlib,subprocess,shutil,os,datetime,time,urllib.request,shlex
root=pathlib.Path('/opt/project-probe-staging')
assert str(root.resolve())=='/opt/project-probe-staging'
payload=json.load(sys.stdin)
stage=pathlib.Path(payload['stage'])
assert stage.parent==root and stage.name.startswith('.inputs-next-') and len(stage.name)==45
assert stage.resolve().parent==root
for relative,sha in payload['manifest'].items():
 p=stage/relative
 assert p.resolve().is_relative_to(stage.resolve()) and p.is_file()
 assert hashlib.sha256(p.read_bytes()).hexdigest()==sha
assert (root/'dist').resolve()==root/'dist'
assert (root/'backend.env').resolve()==root/'backend.env'
assert (root/'server-nginx.conf').resolve()==root/'server-nginx.conf'
service='project-probe-backend.service'
def run(args):return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60).stdout
def sql(q):return run(['runuser','-u','postgres','--','psql','-d','projectprobe_staging','-At','-c',q])
def active():
 return sum(int(sql(q).strip()) for q in ["SELECT COUNT(*) FROM trainings WHERE status='GENERATING' AND lease_until>(extract(epoch from now())*1000)::bigint", "SELECT COUNT(*) FROM extraction_limits WHERE lease_until>(extract(epoch from now())*1000)::bigint", "SELECT COUNT(*) FROM input_limits WHERE lease_until>(extract(epoch from now())*1000)::bigint"])
def snapshot():
 return [hashlib.sha256(sql(q)).hexdigest() for q in ['SELECT id,amount_cents,mode,app_id,seller_id,product_code,training_limit,lifetime FROM purchase_orders ORDER BY id','SELECT id,order_id,deep_used,retest_used,training_limit,training_used,lifetime FROM training_packages ORDER BY id']]
assert active()==0,'Active generation; do not interrupt'
old_nginx=(root/'server-nginx.conf').read_text()
assert 'server_name 39.96.27.134;' in old_nginx and 'proxy_pass http://127.0.0.1:18089;' in old_nginx
new_nginx=(stage/'server-nginx.conf').read_text()
assert 'client_max_body_size 7m;' in new_nginx and "media-src 'self' blob:" in new_nginx
tag=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=root/'releases'/('resume-dedup-'+tag)
backup.mkdir(mode=0o700)
for name in ['app.jar','backend.env','server-nginx.conf']:
 shutil.copy2(root/name,backup/name);os.chmod(backup/name,0o600)
shutil.copytree(root/'dist',backup/'dist')
for directory,_,names in os.walk(backup/'dist'):
 os.chmod(directory,0o700)
 for name in names:os.chmod(pathlib.Path(directory)/name,0o600)
try:
 run(['systemctl','stop',service])
 assert active()==0,'Generation started during release; restart old backend'
 before=snapshot()
 with (backup/'database.dump').open('wb') as dump:
  os.chmod(backup/'database.dump',0o600)
  subprocess.run(['runuser','-u','postgres','--','pg_dump','-Fc','projectprobe_staging'],stdout=dump,stderr=subprocess.PIPE,check=True,timeout=60)
 os.replace(stage/'app.jar',root/'app.jar');os.chmod(root/'app.jar',0o644)
 run(['systemctl','start',service])
 for attempt in range(65):
  try:
   with urllib.request.urlopen('http://127.0.0.1:18089/api/config',timeout=3) as r:config=json.load(r)
   if config.get('speechEnabled') and config.get('resumeImportEnabled') and config.get('modelMode')=='live' and config.get('paymentMode')=='sandbox':break
  except Exception:pass
  time.sleep(1)
 else:raise RuntimeError('Backend health check failed')
 assert sql("SELECT success FROM flyway_schema_history WHERE version='8'").strip()==b't','V8 migration not confirmed'
 assert hashlib.sha256((root/'backend.env').read_bytes()).digest()==hashlib.sha256((backup/'backend.env').read_bytes()).digest(),'Runtime settings changed'
 assert before==snapshot(),'Existing order or entitlement metadata changed'
 for source in (stage/'dist').rglob('*'):
  if source.is_file() and source.name!='index.html':
   target=root/'dist'/source.relative_to(stage/'dist')
   assert target.resolve().is_relative_to(root/'dist')
   target.parent.mkdir(parents=True,exist_ok=True)
   shutil.copy2(source,target);os.chmod(target,0o644)
 # Keep the mounted config inode; replace the page entry only after assets exist.
 (root/'server-nginx.conf').write_text(new_nginx)
 run(['docker','exec','project-probe-web','nginx','-t'])
 shutil.copy2(stage/'dist/index.html',root/'dist/index.html');os.chmod(root/'dist/index.html',0o644)
 run(['docker','exec','project-probe-web','nginx','-s','reload'])
 print(json.dumps({'status':'PUBLISHED','backup':str(backup),'ordersAndEntitlementsUnchanged':True,'migration':'V8','config':config,'jarSha256':payload['manifest']['app.jar'],'indexSha256':payload['manifest']['dist/index.html'],'runtimeSettingsUnchanged':True}))
except Exception:
 for name in ['app.jar','backend.env','server-nginx.conf']:
  shutil.copy2(backup/name,root/name)
 os.chmod(root/'app.jar',0o644);os.chmod(root/'backend.env',0o600)
 for source in (backup/'dist').rglob('*'):
  if source.is_file():
   target=root/'dist'/source.relative_to(backup/'dist')
   assert target.resolve().is_relative_to(root/'dist')
   target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target);os.chmod(target,0o644)
 run(['systemctl','restart',service])
 run(['docker','exec','project-probe-web','nginx','-t'])
 run(['docker','exec','project-probe-web','nginx','-s','reload'])
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
    stdin, stdout, stderr = client.exec_command('python3 -c ' + shlex.quote(REMOTE), timeout=180)
    stdin.write(json.dumps({'stage': STAGE, 'manifest': manifest})); stdin.channel.shutdown_write()
    output = stdout.read().decode(); error = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if code:
        raise RuntimeError('Release failed; diagnostic: ' + error[-1600:])
    result = json.loads(output)
    output = ROOT / '.runtime/resume-dedup-acceptance'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'release.json').write_text(json.dumps(result), encoding='utf-8')
    print(json.dumps(result))
finally:
    client.close()
