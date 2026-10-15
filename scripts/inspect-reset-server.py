"""Inspect the user-confirmed replacement host without reading application secrets."""
import base64
import getpass
import hashlib
import json
import pathlib
import shlex

import paramiko

ROOT = pathlib.Path(__file__).resolve().parent.parent
FINGERPRINT = 'SHA256:q/9VA3sqvqSyxEqovor9eS4VSdD3TW5QltVMmJ2tI6g'


class ConfirmedHost(paramiko.MissingHostKeyPolicy):
    def missing_host_key(self, client, hostname, key):
        fingerprint = 'SHA256:' + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip('=')
        if hostname != '39.96.27.134' or fingerprint != FINGERPRINT:
            raise paramiko.SSHException('Replacement host fingerprint mismatch')
        client.get_host_keys().add(hostname, key.get_name(), key)


REMOTE = r'''
import pathlib,subprocess,json
def run(args):
 p=subprocess.run(args,capture_output=True,text=True,timeout=30)
 return {'code':p.returncode,'output':p.stdout[-10000:],'error':p.stderr[-1000:]}
root=pathlib.Path('/opt/project-probe-staging')
result={'os':pathlib.Path('/etc/os-release').read_text(),'resources':run(['free','-m']),'disk':run(['df','-h','/']), 'ports':run(['ss','-lntp']), 'software':{},'projectExists':root.exists()}
for name,args in {'java':['java','-version'],'docker':['docker','ps','--format','{{.Names}} {{.Status}} {{.Ports}}'],'postgres':['psql','--version'],'nginx':['nginx','-v'],'backend':['systemctl','is-active','project-probe-backend.service']}.items():
 try:result['software'][name]=run(args)
 except FileNotFoundError:result['software'][name]={'installed':False}
if root.exists():
 result['projectFiles']=[{'name':p.name,'directory':p.is_dir(),'size':p.stat().st_size,'mode':oct(p.stat().st_mode & 0o777)} for p in root.iterdir()]
 releases=root/'releases'
 result['releases']=[p.name for p in releases.iterdir()] if releases.exists() else []
print(json.dumps(result))
'''

client = paramiko.SSHClient()
client.set_missing_host_key_policy(ConfirmedHost())
client.connect('39.96.27.134', username='root', password=getpass.getpass('SSH password: '), look_for_keys=False, allow_agent=False, timeout=20)
try:
    client.save_host_keys(str(ROOT / '.runtime/server-known-hosts'))
    stdin, stdout, stderr = client.exec_command('python3 -c ' + shlex.quote(REMOTE), timeout=60)
    output, error = stdout.read().decode(), stderr.read().decode()
    if stdout.channel.recv_exit_status():
        raise RuntimeError(error[-1200:])
    result = json.loads(output)
    target = ROOT / '.runtime/server-reset-recovery'
    target.mkdir(parents=True, exist_ok=True)
    (target / 'inventory.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
finally:
    client.close()
