import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { configureMcpConnection, connect, type Connection } from './network';
import './mcp.css';
import type { HostedRoom } from './hosting';
import { copyInvitation } from './clipboard';
import { mountArena } from './main';
import { mountArena3D } from './arena3d/main';
import classicStyle from './style.css?inline';
import tableStyle from './arena3d/style.css?inline';
import type { Rules } from './physics';
import { createPairingKey, LIVE_PAIR_PATH, OWNER_LIVE_PATH, pairingChallenge, PAIRING_MS } from './live-pairing';
const app=new App({name:'Jev Pong',version:'1.0.0'}),status=document.getElementById('mcp-status')!;
const play=document.getElementById('mcp-play') as HTMLButtonElement,expand=document.getElementById('mcp-fullscreen') as HTMLButtonElement,web=document.getElementById('mcp-web') as HTMLButtonElement;
let rules:Rules='pong',hosted:HostedRoom|null=null,player:'left'|'right'|'both'|'spectator'='both';
const liveButton=document.getElementById('mcp-live') as HTMLButtonElement;
const pairingStatus=document.getElementById('mcp-pairing')!;
const arenaRoot=document.getElementById('app')!;
const arenaStyle=document.createElement('style');
document.head.append(arenaStyle);
let pairing:AbortController|undefined;
const sharing=document.getElementById('mcp-sharing')!,invitation=document.getElementById('mcp-invite') as HTMLInputElement;
let connectionSummary='';
let controllers:Connection[]=[],autoplay=false,visible=true,origin='',disposed=false,disposeArena:(()=>void)|undefined,displayMode:'inline'|'fullscreen'='inline';
document.documentElement.dataset.mcpApp='true';
function showArena(next:HostedRoom|null,nextRules:Rules){
  stopPlayers();disposeArena?.();
  hosted=next;rules=nextRules;
  delete document.body.dataset.assets;
  delete document.body.dataset.error;
  document.documentElement.dataset.mcpRules=rules;
  arenaStyle.textContent=rules==='table-tennis'?tableStyle:classicStyle;
  disposeArena=rules==='table-tennis'&&hosted?mountArena3D(arenaRoot,{hosted,origin}):mountArena(hosted);
}
function stopPlayers(){controllers.forEach(c=>c.close());controllers=[];}
function syncPlayers(){
  stopPlayers();const sides=player==='both'?['left','right'] as const:player==='spectator'?[]:[player];
  if(autoplay&&visible&&!disposed)controllers=sides.map(side=>connect(side,hosted?{...hosted,token:new URLSearchParams(new URL(hosted.links![side]).hash.slice(1)).get('token')!}:null,rules));
  play.hidden=player==='spectator'||!!hosted?.privateView;play.textContent=player==='both'?(autoplay?'Stop AI players':'Start AI players'):`${autoplay?'Stop':'Start'} ${player} AI player`;
}
function hostContext(ctx:McpUiHostContext){
  if(ctx.theme)applyDocumentTheme(ctx.theme);if(ctx.styles?.variables)applyHostStyleVariables(ctx.styles.variables);if(ctx.styles?.css?.fonts)applyHostFonts(ctx.styles.css.fonts);
  if(ctx.safeAreaInsets){const {top,right,bottom,left}=ctx.safeAreaInsets;document.body.style.padding=`${top}px ${right}px ${bottom}px ${left}px`;}
  if(ctx.availableDisplayModes)expand.hidden=!ctx.availableDisplayModes.includes('fullscreen');
  if(ctx.displayMode==='inline'||ctx.displayMode==='fullscreen'){displayMode=ctx.displayMode;expand.textContent=displayMode==='inline'?'Expand':'Collapse';}
}
const observer=new IntersectionObserver(([entry])=>{
  document.documentElement.dataset.mcpHidden=String(!entry.isIntersecting);
  if(visible===entry.isIntersecting)return;
  visible=entry.isIntersecting;syncPlayers();
});
observer.observe(document.documentElement);
app.onhostcontextchanged=hostContext;
app.ontoolinput=()=>{status.textContent='MCP connected · loading arena…';};
app.ontoolresult=async result=>{
  try{
    if(disposed)return;
    if(result.isError){const detail=result.content?.filter(c=>c.type==='text').map(c=>c.text).join(' ');throw new Error(detail||'Unable to join this game.');}
    const connection=result._meta?.connection as {origin?:string;token?:string;hosted?:HostedRoom}|undefined;
    if(!connection?.origin||!connection.token)throw new Error('Missing game connection from MCP tool.');
    const url=new URL(connection.origin);
    if(url.origin!==connection.origin||url.username||url.password||(url.protocol!=='https:'&&(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname))))throw new Error('Unsupported game origin.');
    if(origin&&origin!==url.origin)throw new Error('Open a new view to change game servers.');
    origin=url.origin;configureMcpConnection(origin,connection.token);
    pairing?.abort();pairing=undefined;pairingStatus.hidden=true;
    liveButton.disabled=false;liveButton.hidden=result._meta?.ownerLive!==true;
    const data=result.structuredContent as {player?:typeof player;autoplay?:boolean;rules?:Rules;players?:Record<string,{mock:boolean}>}|undefined;
    const nextRules=data?.rules==='table-tennis'&&connection.hosted?'table-tennis':'pong';
    if(!disposeArena||hosted?.room!==connection.hosted?.room||nextRules!==rules)showArena(connection.hosted??null,nextRules);
    player=data?.player??'both';autoplay=data?.autoplay===true;syncPlayers();
    invitation.value=typeof result._meta?.invitation==='string'?result._meta.invitation:'';sharing.hidden=!invitation.value;document.getElementById('mcp-invite-side')!.textContent=String(result._meta?.inviteSide??'other');play.disabled=false;web.disabled=false;web.hidden=false;
    const joinWeb=document.getElementById('mcp-join-web') as HTMLAnchorElement;joinWeb.hidden=typeof result._meta?.joinURL!=='string';if(!joinWeb.hidden)joinWeb.href=String(result._meta!.joinURL);
    const mock=data?.players&&Object.values(data.players).every(p=>p.mock);
    connectionSummary=`${player==='both'?'Both players':player==='spectator'?'Spectator':`${player.toUpperCase()} player`} · MCP connected · ${mock?'mock brains':'configured providers'} · shared web arena`;
    play.title=mock?'Connect mock controllers to empty seats.':'Connect controllers to empty seats. Configured providers may incur API charges.';
    document.documentElement.dataset.mcpReady='true';
    void app.updateModelContext({content:[{type:'text',text:`Jev Pong is displayed. Match decisions and score come from the same authoritative server as ${hosted?.links?.spectator??`${origin}/?spectate`}.${hosted?` Room ID: ${hosted.room}.`:''}`}]});
  }catch(error){connectionSummary='';status.textContent=error instanceof Error?error.message:'Unable to open arena';}
};
app.onteardown=async()=>{disposed=true;pairing?.abort();autoplay=false;stopPlayers();clearInterval(controllerStatus);observer.disconnect();disposeArena?.();return {};};
app.onerror=()=>{connectionSummary='';status.textContent='MCP host connection failed';};
function releaseInvitedSeat(){
  if(player!=='both')return;
  // Copying the right-player invitation must actually leave that seat free.
  controllers[1]?.close();controllers=controllers.slice(0,1);player='left';play.textContent=autoplay?'Stop left AI player':'Start left AI player';
  connectionSummary=connectionSummary.replace('Both players','LEFT player');
}
const controllerStatus=setInterval(()=>{
  if(!connectionSummary||disposed)return;
  const problem=controllers.find(c=>c.status!=='CONNECTED'&&c.status!=='CONNECTING');
  status.textContent=problem?`${connectionSummary} · ${problem.status}`:connectionSummary;
},250);
document.getElementById('mcp-copy')!.onclick=async()=>{releaseInvitedSeat();const copied=await copyInvitation(invitation);document.getElementById('mcp-copy')!.textContent=copied?'Copied':'Selected — press ⌘C / Ctrl+C';};
async function pairLiveView(){
  const current=pairing=new AbortController();
  const {signal}=current,room=crypto.randomUUID(),verifier=createPairingKey();
  const request=(path:string,key:string)=>fetch(new URL(path,origin),{
    method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({room,key}),signal,
  });
  liveButton.disabled=true;pairingStatus.hidden=false;pairingStatus.textContent='Preparing the owner sign-in…';
  try{
    const response=await request(LIVE_PAIR_PATH,await pairingChallenge(verifier));
    if(!response.ok)throw new Error(response.status===503?'Owner live matches are unavailable.':'Unable to pair this view. Try again.');
    const url=new URL(OWNER_LIVE_PATH,origin);url.searchParams.set('pair',room);
    pairingStatus.textContent=`Pairing code ${room.slice(0,8)}. Sign in and confirm the match in your browser.`;
    const opened=await app.openLink({url:url.href});
    if(opened.isError)throw new Error('The host could not open the owner sign-in page.');
    const deadline=Date.now()+PAIRING_MS;
    while(!signal.aborted&&Date.now()<deadline){
      const pickup=await request(`${LIVE_PAIR_PATH}/claim`,verifier);
      if(pickup.status===200){
        const {token}=await pickup.json() as {token:string};
        if(signal.aborted)return;
        autoplay=false;player='spectator';sharing.hidden=true;invitation.value='';web.hidden=true;
        showArena({room,token,links:null,privateView:true},'table-tennis');
        syncPlayers();connectionSummary='Private live match · Spectator';
        pairingStatus.hidden=true;
        return;
      }
      if(pickup.status!==202)break;
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
    throw new Error('Pairing expired. Choose Start live match to try again.');
  }catch(error){
    if(!signal.aborted)pairingStatus.textContent=error instanceof Error?error.message:'Unable to pair this view.';
  }finally{
    if(pairing===current){pairing=undefined;liveButton.disabled=false;}
  }
}
liveButton.onclick=()=>void pairLiveView();
play.onclick=()=>{autoplay=!autoplay;syncPlayers();};
expand.onclick=async()=>{await app.requestDisplayMode({mode:displayMode==='inline'?'fullscreen':'inline'});};
web.onclick=()=>void app.openLink({url:hosted?.links?.spectator??`${origin}/?spectate`});
document.addEventListener('click',event=>{const a=(event.target as Element).closest('a');if(!a||!origin)return;event.preventDefault();if(a.id==='mcp-join-web')releaseInvitedSeat();void app.openLink({url:new URL(a.getAttribute('href')!,origin).href});});
await app.connect();const ctx=app.getHostContext();if(ctx)hostContext(ctx);
