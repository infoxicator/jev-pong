import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import type { Env } from './index';
import type { RoomLinks } from '../src/host-types';
const RESOURCE='ui://jev-pong/arena.html';
/** Stateless HTTPS MCP; every app gets an isolated, mock-only Durable Object room. */
export async function handleMcp(req:Request,env:Env):Promise<Response>{
  const origin=new URL(req.url).origin;
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID','Access-Control-Allow-Methods':'POST, GET, DELETE, OPTIONS','Access-Control-Expose-Headers':'MCP-Session-Id'};
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return new Response('Use Streamable HTTP POST',{status:405,headers:{...cors,Allow:'POST, OPTIONS'}});
  const server=new McpServer({name:'Jev Pong',version:'1.1.0'});
  registerAppTool(server,'open_pong',{
    title:'Open Jev Pong',description:'Open an interactive Pong arena in its own private room. Public hosted brains are always simulated: no paid AI API calls. Set autoplay=true to connect both mock AI players, or click Start AI players in the app. Room expires after 15 minutes.',
    inputSchema:z.object({autoplay:z.boolean().default(false),matchup:z.enum(['jev-vs-jev','jev-vs-luna']).default('jev-vs-jev')}),
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},_meta:{ui:{resourceUri:RESOURCE}},
  },async({autoplay,matchup})=>{
    const limit=await env.ROOM_CREATION.limit({key:req.headers.get('CF-Connecting-IP')??'mcp-local'});
    if(!limit.success)return {isError:true,content:[{type:'text',text:'Room creation limit reached. Try again in a minute.'}]};
    const room=crypto.randomUUID(),stub=env.ROOMS.get(env.ROOMS.idFromName(room));
    const response=await stub.fetch(new Request(`${origin}/init?room=${room}`,{method:'POST',headers:{'X-Matchup':matchup,'X-Real-Room':'false','X-MCP-Room':'true'}}));
    if(!response.ok)throw new Error('Unable to create Pong room');
    const {mcpToken,...links}=await response.json() as RoomLinks&{mcpToken:string};
    const state=await (await stub.fetch(new Request(`${origin}/mcp-status`))).json() as {players:unknown};
    return {content:[{type:'text',text:`Mock ${matchup} arena opened. Room ${room}. Spectator: ${links.spectator}. ${autoplay?'Both AI players will start.':'Click Start AI players to begin.'}`}],
      structuredContent:{origin,autoplay,matchup,room,spectatorURL:links.spectator,players:state.players},
      // These room capabilities are delivered only to the UI, never to model-visible content.
      _meta:{connection:{origin,token:mcpToken,hosted:{room,token:new URLSearchParams(new URL(links.owner).hash.slice(1)).get('token'),links}}}};
  });
  server.registerTool('pong_status',{
    title:'Pong match status',description:'Read score, tick, decisions and connectivity for a public mock room opened with open_pong. Does not start agents or call providers.',
    inputSchema:z.object({room:z.string().uuid()}),annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  },async({room})=>{
    const response=await env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(new Request(`${origin}/mcp-status`));
    if(!response.ok)return {isError:true,content:[{type:'text',text:'MCP room missing or expired. Open a new Pong arena.'}]};
    const state=await response.json() as Record<string,unknown>;
    return {content:[{type:'text',text:JSON.stringify(state)}],structuredContent:state};
  });
  registerAppResource(server,'Jev Pong arena',RESOURCE,{mimeType:RESOURCE_MIME_TYPE},async()=>{
    const resource=await env.ASSETS.fetch(new Request(`${origin}/mcp/mcp-app.html`));
    if(!resource.ok)throw new Error('MCP UI bundle missing');
    return {contents:[{uri:RESOURCE,mimeType:RESOURCE_MIME_TYPE,text:await resource.text(),_meta:{ui:{prefersBorder:false,csp:{connectDomains:[origin.replace(/^http/,'ws')],resourceDomains:[],frameDomains:[]}}}}]};
  });
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  try{
    await server.connect(transport);
    const response=await transport.handleRequest(req);
    const headers=new Headers(response.headers);for(const [key,value] of Object.entries(cors))headers.set(key,value);headers.set('Cache-Control','no-store');
    return new Response(response.body,{status:response.status,headers});
  }finally{await server.close();}
}
