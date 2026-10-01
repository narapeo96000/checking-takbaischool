"""GitHub deployment helper. A token is read from stdin and never saved."""
import base64
import getpass
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

token = getpass.getpass('GitHub token (hidden): ') if sys.stdin.isatty() else sys.stdin.readline().strip()
if not token:
    raise SystemExit('Missing token on stdin')
def request(route, method='GET', payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req=urllib.request.Request('https://api.github.com'+route,data=data,method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json','User-Agent':'checking-takbaischool-installer'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw=response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        print(json.dumps({'error':error.code,'route':route},ensure_ascii=False),flush=True)
        return None
user=request('/user')
repo=request('/repos/narapeo96000/checking-takbaischool')
print(json.dumps({'login':(user or {}).get('login'),'permissions':(repo or {}).get('permissions'),'default_branch':(repo or {}).get('default_branch')},ensure_ascii=False),flush=True)
for raw in sys.stdin:
    command=raw.strip()
    if command=='quit':break
    if command=='push':
        auth=base64.b64encode(('x-access-token:'+token).encode()).decode()
        env=os.environ.copy()
        env.update({'GIT_CONFIG_COUNT':'3','GIT_CONFIG_KEY_0':'http.extraHeader','GIT_CONFIG_VALUE_0':'Authorization: Basic '+auth,'GIT_CONFIG_KEY_1':'http.sslBackend','GIT_CONFIG_VALUE_1':'openssl','GIT_CONFIG_KEY_2':'credential.helper','GIT_CONFIG_VALUE_2':'','GIT_TERMINAL_PROMPT':'0'})
        result=subprocess.run(['git','push','-u','origin','main'],capture_output=True,text=True,env=env)
        output=(result.stdout+result.stderr).replace(token,'[REDACTED]').replace(auth,'[REDACTED]')
        print(json.dumps({'pushExitCode':result.returncode,'output':output}),flush=True)
    elif command=='pages':
        current=request('/repos/narapeo96000/checking-takbaischool/pages')
        if current is None: current=request('/repos/narapeo96000/checking-takbaischool/pages','POST',{'build_type':'workflow'})
        elif current.get('build_type')!='workflow':current=request('/repos/narapeo96000/checking-takbaischool/pages','PUT',{'build_type':'workflow'})
        print(json.dumps({'pages':None if current is None else {'status':current.get('status'),'url':current.get('html_url'),'build_type':current.get('build_type')}},ensure_ascii=False),flush=True)
    elif command=='status':
        runs=request('/repos/narapeo96000/checking-takbaischool/actions/runs?per_page=3')
        print(json.dumps({'runs':[{k:r.get(k) for k in ['name','status','conclusion','html_url']} for r in (runs or {}).get('workflow_runs',[])]}),flush=True)
    else:print(json.dumps({'error':'Unknown command'}),flush=True)
token=''
