// Exercise the installed precache offline, including the actual module graph.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const origin='https://cc700.local/';

test('fresh service-worker install can load the complete local module graph offline',async()=>{
 const handlers=new Map(),installed=new Map();
 const key=r=>typeof r==='string'?new URL(r,origin).href:r.url;
 const cache={
  async addAll(requests){for(const req of requests){const u=new URL(req.url);const name=u.pathname==='/'?'index.html':u.pathname.slice(1);installed.set(req.url,new Response(await fs.readFile(path.join(root,name))));}},
  async match(req){return installed.get(key(req))?.clone();},
  async put(req,response){installed.set(key(req),response);},
 };
 function BrowserRequest(url,options){return new Request(new URL(url,origin),options);}
 const self={addEventListener:(kind,fn)=>handlers.set(kind,fn),skipWaiting(){},clients:{claim:async()=>{}}};
 vm.runInNewContext(await fs.readFile(path.join(root,'sw.js'),'utf8'),{self,Request:BrowserRequest,Response,URL,caches:{open:async()=>cache},location:new URL(origin),fetch:async()=>{throw Error('offline');}});
 let install;
 handlers.get('install')({waitUntil:p=>install=p});await install;
 const pending=['js/app.js'],seen=new Set();
 while(pending.length){
  const name=pending.pop();if(seen.has(name))continue;seen.add(name);
  let response;
  handlers.get('fetch')({request:new Request(new URL(name,origin)),respondWith:p=>response=p});
  const result=await response;
  assert(result instanceof Response,`Offline precache misses ${name}`);
  const source=await result.text();
  for(const match of source.matchAll(/\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s+)?['"](\.[^'"]+)['"]/g)){
   pending.push(new URL(match[1],new URL(name,origin)).pathname.slice(1));
  }
 }
 assert(seen.size>5,'actual module graph was not traversed');
});
