// Independent ACP JSON-RPC adapter, compatible with fframestudio bridge /acp.
// Token exists only in volatile page memory. Permission and file requests fail closed.
export function connectHermes({bridge='http://127.0.0.1:7878',token,onUpdate=()=>{},onStatus=()=>{}}){
  const u=new URL(bridge);
  if(u.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('Hermes bridge must use a local loopback URL');
  if(typeof token!=='string'||!token.length)throw Error('A local bridge token is required');
  const ws=new WebSocket(`${bridge.replace(/^http/,'ws').replace(/\/$/,'')}/acp?agent=hermes`,[`fframestudio.${token}`]);
  let nextId=1,sessionId=null,closed=false;const pending=new Map();
  function send(o){if(ws.readyState!==WebSocket.OPEN)throw Error('Bridge not connected');ws.send(JSON.stringify({jsonrpc:'2.0',...o}));}
  const request=(method,params,timeout=30000)=>new Promise((resolve,reject)=>{
    const id=nextId++,t=setTimeout(()=>{pending.delete(id);reject(Error(`${method} timed out`))},timeout);
    pending.set(id,{resolve,reject,t});try{send({id,method,params})}catch(e){clearTimeout(t);pending.delete(id);reject(e)}
  });
  const open=new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',()=>reject(Error('Bridge connection failed')),{once:true});ws.addEventListener('close',()=>reject(Error('Bridge refused or closed connection')),{once:true});});
  ws.addEventListener('message',event=>{
    let m;try{m=JSON.parse(event.data)}catch{return}
    if(m.id!==undefined&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.t);m.error?p.reject(Error(m.error.message||'ACP error')):p.resolve(m.result);return}
    if(m.id!==undefined&&m.method){
      // ACP agents may request local commands and filesystem writes. Do not automatically approve.
      if(m.method==='session/request_permission')send({id:m.id,result:{outcome:{outcome:'cancelled'}}});
      else send({id:m.id,error:{code:-32601,message:'Engine Atlas does not grant agent files or terminals'}});
      return;
    }
    if(m.method==='session/update')onUpdate(m.params?.update);
    if(m.method==='_fframestudio/stderr')onStatus(m.params?.text||'');
  });
  ws.addEventListener('close',()=>{closed=true;for(const p of pending.values()){clearTimeout(p.t);p.reject(Error('Hermes disconnected'))}pending.clear();onStatus('Disconnected from local Hermes')});
  async function start(){await open;await request('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'engine-atlas',title:'Engine Atlas',version:'0.1.0'}});const me=await fetch(`${bridge}/me`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json());if(!me.ok||!me.root)throw Error('Local bridge rejected credentials');const session=await request('session/new',{cwd:me.root,mcpServers:[]});sessionId=session.sessionId;return session}
  return{start,prompt:(question)=>{if(!sessionId)throw Error('Hermes session not initialized');return request('session/prompt',{sessionId,prompt:[{type:'text',text:question}]},120000)},cancel:()=>sessionId&&send({method:'session/cancel',params:{sessionId}}),close:()=>ws.close(),get closed(){return closed}};
}