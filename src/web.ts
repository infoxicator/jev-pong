import './style.css';
import { mountArena } from './main';
import { prepareRoom,showHostingError } from './hosting';
try{
  const hosted=await prepareRoom(),url=new URL(location.href);
  if(hosted?.rules==='table-tennis'&&url.searchParams.has('side')&&!url.searchParams.has('spectate')){
    url.pathname='/arena3d.html';
    location.replace(url);
  }else mountArena(hosted);
}catch(error){showHostingError(error);}
