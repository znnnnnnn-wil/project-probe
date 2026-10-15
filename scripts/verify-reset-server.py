"""Verify the recovered service and preserve unrelated firewall and container settings."""
import getpass
import json
import pathlib
import shlex

import paramiko

ROOT = pathlib.Path(__file__).resolve().parent.parent
REMOTE = r'''
import subprocess,json,urllib.request,pathlib,socket,ssl,http.client
def run(args,timeout=30):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 return {'code':p.returncode,'output':p.stdout[-7000:],'error':p.stderr[-1000:]}
with urllib.request.urlopen('http://127.0.0.1:18089/api/config',timeout=5) as r:config=json.load(r)
firewall=run(['ufw','status'])
if 'Status: active' in firewall['output']:
 result=run(['ufw','allow','18443/tcp'])
 assert result['code']==0,'Cannot open project port in host firewall'
 firewall=run(['ufw','status'])
sock=socket.create_connection(('127.0.0.1',18443),timeout=5)
with ssl.create_default_context().wrap_socket(sock,server_hostname='39.96.27.134') as secure:
 secure.sendall(b'GET /api/config HTTP/1.1\r\nHost: 39.96.27.134:18443\r\nConnection: close\r\n\r\n')
 response=http.client.HTTPResponse(secure);response.begin()
 assert response.status==200
 local_tls=json.load(response)
assert local_tls==config
result={'status':'PASSED','config':config,'hostFirewall':firewall,'ports':run(['ss','-lntp']),'projectService':run(['systemctl','is-active','project-probe-backend.service']),'containers':run(['docker','ps','--format','{{.Names}} {{.Status}} {{.Ports}}']),'certificateRenewalService':run(['systemctl','show','livesync-cert-renew.service','-p','Result','-p','ExecMainStatus']),'certificateRenewalTimer':run(['systemctl','is-active','livesync-cert-renew.timer']),'localTrustedTlsVerified':True}
print(json.dumps(result))
'''
client = paramiko.SSHClient()
client.load_host_keys(str(ROOT / '.runtime/server-known-hosts'))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
client.connect('39.96.27.134', username='root', password=getpass.getpass('SSH password: '), look_for_keys=False, allow_agent=False, timeout=20)
try:
    stdin, stdout, stderr = client.exec_command('python3 -c ' + shlex.quote(REMOTE), timeout=60)
    output, error = stdout.read().decode(), stderr.read().decode()
    if stdout.channel.recv_exit_status():
        raise RuntimeError(error[-1600:])
    result = json.loads(output)
    target = ROOT / '.runtime/server-reset-recovery'
    (target / 'server-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))
finally:
    client.close()
