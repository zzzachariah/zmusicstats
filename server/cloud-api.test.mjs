import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createCloudApi } from './cloud-api.mjs';
function fixture(){
 const records=new Map(),store={async read(key){return{value:structuredClone(records.get(key)??null)};},async update(key,fn){const next=fn(structuredClone(records.get(key)??null));if(next!==undefined)records.set(key,structuredClone(next));return structuredClone(records.get(key));}};
 let finishReport;const adapters={configured:{netease:true,qq:true,apple:true},async createQr(){return {key:'UPSTREAM-QR-SECRET',qrImage:'data:image/png;base64,YQ==',expiresAt:Date.now()+180000};},async checkQr(){return{state:'connected',credential:{kind:'gateway',secret:'UPSTREAM-AUTH-SECRET'}};},async account(){return{nickname:'Test account',subject:'test-user'};},async history(){return{months:['2026-08','2026-09']};},async report(provider,credential,month){return new Promise(resolve=>{finishReport=()=>resolve({platform:{id:provider,period:{start:month+'-01'},tracks:[]},issues:[]});});}};
 const app=createCloudApi({store,adapters,env:{CLOUD_SESSION_SECRET:randomBytes(32).toString('base64url')}});
 const call=(path,method='GET',cookie,body)=>app(new Request('https://zmusicstats.vercel.app'+path,{method,headers:{Origin:'https://zmusicstats.vercel.app',...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}));
 return{records,app,call,finish:()=>finishReport?.()};
}
test('cloud authentication is isolated across sessions and never exposes credentials',async()=>{
 const f=fixture(); const start=await f.call('/api/connections');const cookie=start.headers.get('set-cookie').split(';')[0];assert.match(start.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);
 const qr=await(await f.call('/api/auth/netease/qr','POST',cookie,{})).json();assert.ok(!JSON.stringify(qr).includes('UPSTREAM'));
 await f.call('/api/auth/netease/qr/'+qr.id,'GET',cookie);
 const connections=await(await f.call('/api/connections','GET',cookie)).json();assert.equal(connections.providers[0].account.nickname,'Test account');assert.equal(connections.providers[0].connected,true);assert.ok(!JSON.stringify(connections).includes('SECRET'));
 const second=await f.call('/api/connections');const cookie2=second.headers.get('set-cookie').split(';')[0];assert.equal((await(await f.call('/api/auth/netease/qr/'+qr.id,'GET',cookie2)).json()).error.code,'QR_NOT_FOUND');
 assert.ok([...f.records.keys()].every(key=>!key.startsWith('report:')));
 const response=await f.app(new Request('https://zmusicstats.vercel.app/api/auth/netease/qr',{method:'POST',headers:{Origin:'https://evil.example',cookie}}));assert.equal(response.status,403);
});
test('disconnect prevents a pending monthly read from returning or restoring old data',async()=>{
 const f=fixture(),start=await f.call('/api/connections'),cookie=start.headers.get('set-cookie').split(';')[0];
 const qr=await(await f.call('/api/auth/netease/qr','POST',cookie,{})).json();await f.call('/api/auth/netease/qr/'+qr.id,'GET',cookie);
 const pending=f.call('/api/report?month=2026-09','GET',cookie);await new Promise(r=>setTimeout(r,5));
 await f.call('/api/connections/netease','DELETE',cookie);f.finish();const response=await pending;assert.equal(response.status,409);
 assert.ok(![...f.records.values()].some(value=>value.platforms||value.tracks||value.report));
});
