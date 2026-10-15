"""Install isolated application prerequisites; leave existing web containers untouched."""
import getpass
import json
import pathlib
import shlex

import paramiko

ROOT = pathlib.Path(__file__).resolve().parent.parent
REMOTE = r'''
import subprocess,json,pathlib,os
def run(args,timeout=60,env=None):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout,env=env)
 if p.returncode:raise RuntimeError('Command failed: '+args[0]+' '+p.stderr[-700:])
 return p.stdout
assert not pathlib.Path('/opt/project-probe-staging').exists(),'Existing project requires a migration, not bootstrap'
before=json.loads(run(['docker','inspect','--format','{{json .State}}','livesync-nginx']))
mounts=json.loads(run(['docker','inspect','--format','{{json .Mounts}}','livesync-nginx']))
safe=[{'source':m['Source'],'destination':m['Destination'],'type':m['Type'],'readOnly':not m['RW']} for m in mounts]
env=dict(os.environ,DEBIAN_FRONTEND='noninteractive',NEEDRESTART_MODE='l')
run(['apt-get','update'],timeout=240,env=env)
run(['apt-get','install','-y','openjdk-17-jre-headless','postgresql','python3-venv'],timeout=600,env=env)
after=json.loads(run(['docker','inspect','--format','{{json .State}}','livesync-nginx']))
assert before['StartedAt']==after['StartedAt'] and after['Running'],'Existing web service restarted unexpectedly'
versions={}
for name,args in {'java':['java','-version'],'postgres':['psql','--version']}.items():
 p=subprocess.run(args,capture_output=True,text=True,check=True);versions[name]=p.stdout+p.stderr
print(json.dumps({'status':'PREPARED','versions':versions,'existingWebUnchanged':True,'existingWebMounts':safe}))
'''
client = paramiko.SSHClient()
client.load_host_keys(str(ROOT / '.runtime/server-known-hosts'))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
client.connect('39.96.27.134', username='root', password=getpass.getpass('SSH password: '), look_for_keys=False, allow_agent=False, timeout=20)
try:
    stdin, stdout, stderr = client.exec_command('python3 -c ' + shlex.quote(REMOTE), timeout=1000)
    output, error = stdout.read().decode(), stderr.read().decode()
    if stdout.channel.recv_exit_status():
        raise RuntimeError(error[-1600:])
    result = json.loads(output)
    target = ROOT / '.runtime/server-reset-recovery'
    target.mkdir(parents=True, exist_ok=True)
    (target / 'prerequisites.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
finally:
    client.close()
