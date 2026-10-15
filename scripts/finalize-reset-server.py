"""Back up the recovered deployment and verify synthetic project persistence after restart."""
import getpass
import json
import pathlib
import shlex

import paramiko

ROOT = pathlib.Path(__file__).resolve().parent.parent
REMOTE = r'''
import json,pathlib,subprocess,urllib.request,http.cookiejar,uuid,time,datetime,shutil,os
root=pathlib.Path('/opt/project-probe-staging')
assert root.resolve()==root
def run(args,timeout=60):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError('Command failed: '+args[0]+' '+p.stderr[-500:])
 return p.stdout
def active():
 return int(run(['runuser','-u','postgres','--','psql','-At','-d','projectprobe_staging','-c',"SELECT COUNT(*) FROM trainings WHERE status='GENERATING' AND lease_until>(extract(epoch from now())*1000)::bigint"]).strip())
assert active()==0,'Do not interrupt active training'
states={name:json.loads(run(['docker','inspect','--format','{{json .State}}',name]))['StartedAt'] for name in ['livesync-nginx','livesync-couchdb']}
base='https://39.96.27.134:18443'
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def request(path,data=None):
 payload=json.dumps(data).encode() if data is not None else None
 req=urllib.request.Request(base+'/api'+path,data=payload,headers={'Origin':base,'Content-Type':'application/json'})
 with opener.open(req,timeout=10) as r:
  body=r.read()
  return json.loads(body) if body else None
request('/auth/register',{'username':'reset-persistence-'+str(uuid.uuid4()),'password':str(uuid.uuid4())+str(uuid.uuid4())})
project=request('/projects',{'name':'重启持久化合成项目','responsibility':'仅用于部署验收的合成描述','resume':'合成材料，不含真实个人信息。'})
assert active()==0
backup=root/'releases'/('recovery-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
backup.mkdir(mode=0o700,parents=True)
for name in ['app.jar','backend.env','server-nginx.conf']:
 shutil.copy2(root/name,backup/name);os.chmod(backup/name,0o600)
shutil.copytree(root/'credentials',backup/'credentials')
for p in (backup/'credentials').iterdir():os.chmod(p,0o600)
os.chmod(backup/'credentials',0o700)
shutil.copytree(root/'dist',backup/'dist')
for directory,_,names in os.walk(backup/'dist'):
 os.chmod(directory,0o700)
 for name in names:os.chmod(pathlib.Path(directory)/name,0o600)
with (backup/'database.dump').open('wb') as output:
 os.chmod(backup/'database.dump',0o600)
 subprocess.run(['runuser','-u','postgres','--','pg_dump','-Fc','projectprobe_staging'],stdout=output,stderr=subprocess.PIPE,check=True,timeout=60)
run(['systemctl','restart','project-probe-backend.service'])
for _ in range(75):
 try:
  loaded=request('/projects/'+project['id'])
  if loaded.get('resume')==project['resume'] and loaded.get('responsibility')==project['responsibility']:break
 except Exception:pass
 time.sleep(1)
else:raise RuntimeError('Synthetic project did not survive backend restart')
request('/auth/logout',{})
for name,started in states.items():
 state=json.loads(run(['docker','inspect','--format','{{json .State}}',name]))
 assert state['Running'] and state['StartedAt']==started,'LiveSync changed'
run(['/etc/letsencrypt/renewal-hooks/deploy/project-probe-reload'])
print(json.dumps({'status':'PASSED','backup':str(backup),'databaseDumpBytes':(backup/'database.dump').stat().st_size,'syntheticProjectPersistedAfterRestart':True,'unrelatedContainersUnchanged':True,'sharedCertificateReloadHookExecuted':True,'realUserMaterialReads':0,'modelCalls':0,'orderOrEntitlementWrites':0,'fullDatabaseRestoreDrill':False}))
'''
client = paramiko.SSHClient()
client.load_host_keys(str(ROOT / '.runtime/server-known-hosts'))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
client.connect('39.96.27.134', username='root', password=getpass.getpass('SSH password: '), look_for_keys=False, allow_agent=False, timeout=20)
try:
    stdin, stdout, stderr = client.exec_command('python3 -c ' + shlex.quote(REMOTE), timeout=180)
    output, error = stdout.read().decode(), stderr.read().decode()
    if stdout.channel.recv_exit_status():
        raise RuntimeError(error[-1600:])
    result = json.loads(output)
    target = ROOT / '.runtime/server-reset-recovery'
    (target / 'persistence-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
finally:
    client.close()
