import type { Rules } from './physics';
export interface RoomLinks {room:string;expiresAt:number;owner:string;left:string;right:string;spectator:string}
export interface HostedRoom {room:string;token:string;links:RoomLinks|null;rules?:Rules;privateView?:true}
