import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { configureMcpConnection, connect, type Connection } from './network';
import './mcp.css';
import { mountArena } from './main';
const app=new App({name:'Jev Pong',version:'1.0.0'}),status=document.getElementById('mcp-status')!;
const play=document.getElementById('mcp-play') as HTMLButtonElement,expand=document.getElementById('mcp-fullscreen') as HTMLButtonElement,web=document.getElementById('mcp-web') as HTMLButtonElement;
let controllers:Connection[]=[],autoplay=false,visible=true,origin='',disposed=false,disposeArena:(()=>void)|undefined,displayMode:'inline'|'fullscreen'='inline';
document.documentElement.dataset.mcpApp='true';
function stopPlayers(){controllers.forEach(c=>c.close());controllers=[];}
function syncPlayers(){stopPlayers();if(autoplay&&visible&&!disposed)controllers=[connect('left'),connect('right')];play.textContent=autoplay?'Stop AI players':'Start AI players';}
function hostContext(ctx:McpUiHostContext){
  if(ctx.theme)applyDocumentTheme(ctx.theme);if(ctx.styles?.variables)applyHostStyleVariables(ctx.styles.variables);if(ctx.styles?.css?.fonts)applyHostFonts(ctx.styles.css.fonts);
  if(ctx.safeAreaInsets){const {top,right,bottom,left}=ctx.safeAreaInsets;document.body.style.padding=`${top}px ${right}px ${bottom}px ${left}px`;}
  if(ctx.availableDisplayModes)expand.hidden=!ctx.availableDisplayModes.includes('fullscreen');
  if(ctx.displayMode==='inline'||ctx.displayMode==='fullscreen'){displayMode=ctx.displayMode;expand.textContent=displayMode==='inline'?'Expand':'Collapse';}
}
const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;document.documentElement.dataset.mcpHidden=String(!visible);syncPlayers();});
observer.observe(document.documentElement);
app.onhostcontextchanged=hostContext;
app.ontoolinput=()=>{status.textContent='MCP connected · loading arena…';};
app.ontoolresult=async result=>{
  try{
    if(disposed)return;
    const connection=result._meta?.connection as {origin?:string;token?:string}|undefined;
    if(!connection?.origin||!connection.token)throw new Error('Missing game connection from MCP tool.');
    const url=new URL(connection.origin);
    if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Unsupported local game origin.');
    if(origin&&origin!==url.origin)throw new Error('Open a new view to change game servers.');
    origin=url.origin;configureMcpConnection(origin,connection.token);
    disposeArena??=mountArena();
    const data=result.structuredContent as {autoplay?:boolean;players?:Record<string,{mock:boolean}>}|undefined;
    autoplay=data?.autoplay===true;syncPlayers();play.disabled=false;web.disabled=false;
    const mock=data?.players&&Object.values(data.players).every(p=>p.mock);
    status.textContent=`MCP connected · ${mock?'mock brains':'configured providers'} · shared web arena`;
    play.title=mock?'Connect mock controllers to empty seats.':'Connect controllers to empty seats. Configured providers may incur API charges.';
    document.documentElement.dataset.mcpReady='true';
    void app.updateModelContext({content:[{type:'text',text:`Jev Pong is displayed. Match decisions and score come from the same authoritative server as ${origin}/?spectate.`}]});
  }catch(error){status.textContent=error instanceof Error?error.message:'Unable to open arena';}
};
app.onteardown=async()=>{disposed=true;autoplay=false;stopPlayers();observer.disconnect();disposeArena?.();return {};};
app.onerror=()=>{status.textContent='MCP host connection failed';};
play.onclick=()=>{autoplay=!autoplay;syncPlayers();};
expand.onclick=async()=>{await app.requestDisplayMode({mode:displayMode==='inline'?'fullscreen':'inline'});};
web.onclick=()=>void app.openLink({url:`${origin}/?spectate`});
document.addEventListener('click',event=>{const a=(event.target as Element).closest('a');if(!a||!origin)return;event.preventDefault();void app.openLink({url:new URL(a.getAttribute('href')!,origin).href});});
await app.connect();const ctx=app.getHostContext();if(ctx)hostContext(ctx);
