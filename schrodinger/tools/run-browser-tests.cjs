// Node 22+, installed Chrome. No npm dependencies or changes to your browser profile.
// node schrodinger/tools/run-browser-tests.cjs [--benchmark]
// Set CHROME_BIN to use another Chromium executable.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const root = path.resolve(__dirname, '../..');
const chrome = process.env.CHROME_BIN || (process.platform === 'darwin' ?
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodinger-gpu-tests-'));
const server = http.createServer((req,res) => {
  const filename = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!filename.startsWith(root + path.sep)) {res.writeHead(403).end(); return;}
  fs.readFile(filename, (error,data) => {
    if (error) {res.writeHead(404).end(); return;}
    res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':filename.endsWith('.html')?'text/html':'application/octet-stream');
    res.end(data);
  });
});
async function connect(url) {
  const ws = new WebSocket(url); const pending = new Map(); let id=0;
  await new Promise((resolve,reject) => {ws.onopen=resolve; ws.onerror=reject;});
  ws.onmessage = event => {
    const message=JSON.parse(event.data), item=pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
  };
  return {close:()=>ws.close(), call(method,params={}) {
    return new Promise((resolve,reject)=>{
      const current=++id;
      const timer=setTimeout(()=>{pending.delete(current);reject(new Error('CDP timeout: '+method));},60000);
      pending.set(current,{resolve,reject,timer});ws.send(JSON.stringify({id:current,method,params}));
    });
  }};
}
(async()=>{
 let child, browser;
 try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  child=spawn(chrome,['--headless','--no-first-run','--no-default-browser-check',
    '--remote-debugging-port=0','--user-data-dir='+profile],{stdio:'ignore'});
  let spawnError;child.on('error',error=>{spawnError=error;});
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let i=0;!fs.existsSync(portFile);i++){
    if(spawnError)throw spawnError;
    if(i>200||child.exitCode!==null)throw new Error('Chrome failed to start');
    await delay(50);
  }
  const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split('\n');
  browser=await connect('ws://127.0.0.1:'+port+endpoint);
  const pages=['gpu-tests.html','app-tests.html','fallback-tests.html',
    'fallback-tests.html?unavailable=1','fallback-tests.html?compute=cpu'];
  if(process.argv.includes('--benchmark'))pages.push('gpu-benchmark.html');
  for(const page of pages){
    const {targetId}=await browser.call('Target.createTarget',{url:origin+'/schrodinger/tools/'+page});
    const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    const target=await connect(targets.find(t=>t.id===targetId).webSocketDebuggerUrl);
    let result;
    try {
      const deadline=Date.now()+60000;
      while(Date.now()<deadline){
        const response=await target.call('Runtime.evaluate',{expression:'document.getElementById("results")?.textContent',returnByValue:true});
        const value=response.result?.value;
        if(value && value.trim().startsWith('{')){result=JSON.parse(value);break;}
        await delay(100);
      }
      if(!result)throw new Error(page+': timed out');
      console.log(JSON.stringify({page,...result}));
      if(result.failed)throw new Error(page+': '+result.failed);
    }finally{target.close();await browser.call('Target.closeTarget',{targetId});}
  }
 }catch(error){console.error(error);process.exitCode=1;}
 finally{
  if(browser){try{await browser.call('Browser.close');}catch{}browser.close();}
  if(child && child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
})();
