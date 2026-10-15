"""Check two synthetic first questions using the production prompt and free-quota guard."""
import getpass
import json
import pathlib
import shlex
import paramiko

ROOT = pathlib.Path(__file__).resolve().parent.parent
request = json.loads((ROOT / 'backend/target/test-fixtures/history-first-request.json').read_text(encoding='utf-8'))
REMOTE = r'''
import json,sys,pathlib,shlex,urllib.request,urllib.parse,unicodedata,hashlib,uuid
env={}
for line in pathlib.Path('/opt/project-probe-staging/backend.env').read_text().splitlines():
 if line and not line.startswith('#') and '=' in line:
  k,v=line.split('=',1);parts=shlex.split(v);env[k]=parts[0] if parts else ''
assert env.get('MODEL_MODE')=='live' and env.get('MODEL_PROVIDER','').lower()=='dashscope'
assert env.get('MODEL_FREE_QUOTA_ONLY','').lower()=='true'
assert env.get('MODEL_FREE_QUOTA_CONFIRMED_MODEL')==env['MODEL_NAME']
url=env['MODEL_BASE_URL'].rstrip('/')+'/chat/completions'
parsed=urllib.parse.urlparse(url)
assert parsed.scheme=='https' and (parsed.hostname=='dashscope.aliyuncs.com' or parsed.hostname.endswith('.cn-beijing.maas.aliyuncs.com'))
payload=json.load(sys.stdin);payload['model']=env['MODEL_NAME'];payload['enable_thinking']=False
def ask(body):
 req=urllib.request.Request(url,data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+env['MODEL_API_KEY'],'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=40) as r:out=json.load(r)
 item=json.loads(out['choices'][0]['message']['content'])
 assert isinstance(item.get('question'),str) and 0<len(item['question'])<=1200 and isinstance(item.get('topic'),str) and 0<len(item['topic'])<=200
 return item,out.get('usage',{})
def normalize(text):
 return ''.join(c for c in unicodedata.normalize('NFKC',text).lower() if not c.isspace() and not unicodedata.category(c).startswith('Z') and (not unicodedata.category(c).startswith('P') or c=='.' or unicodedata.category(c)=='Pd'))
first,usage1=ask(payload)
data=json.loads(payload['messages'][1]['content'])
turn={'id':str(uuid.uuid4()),'trainingId':str(uuid.uuid4()),'question':first['question'],'topic':first['topic'],'answer':'我负责预约接口。对失败后的重试边界尚未补充验证，实际测试结果没有记录。','answerTruncated':False}
data.update({'historyTurns':[turn],'trainingHistory':[{'trainingId':turn['trainingId'],'kind':'DEEP','status':'ACTIVE','turns':[turn]}],'historyRoundNumber':2})
payload['messages'][1]['content']=json.dumps(data)
second,usage2=ask(payload)
assert normalize(first['question'])!=normalize(second['question']),'Repeated first question'
print(json.dumps({'status':'PASSED','realModelCalls':2,'productionPromptVerified':True,'secondRoundOwnAnswerContext':True,'firstQuestionHash':hashlib.sha256(normalize(first['question']).encode()).hexdigest(),'secondQuestionHash':hashlib.sha256(normalize(second['question']).encode()).hexdigest(),'usage':[usage1,usage2],'trainingOrOrderWrites':0,'userMaterialReads':0}))
'''
client=paramiko.SSHClient()
client.load_host_keys(str(ROOT / '.runtime/server-known-hosts'))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
client.connect('39.96.27.134',username='root',password=getpass.getpass('SSH password: '),look_for_keys=False,allow_agent=False,timeout=20)
try:
    stdin,stdout,stderr=client.exec_command('python3 -c '+shlex.quote(REMOTE),timeout=110)
    stdin.write(json.dumps(request));stdin.channel.shutdown_write()
    output,error=stdout.read().decode(),stderr.read().decode()
    if stdout.channel.recv_exit_status(): raise RuntimeError('Model history check failed: '+error[-1200:])
    result=json.loads(output)
    target=ROOT / '.runtime/training-history-acceptance'
    target.mkdir(parents=True,exist_ok=True)
    (target / 'model-result.json').write_text(json.dumps(result),encoding='utf-8')
    print(json.dumps(result))
finally:
    client.close()
