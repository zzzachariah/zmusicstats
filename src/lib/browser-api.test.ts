import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserApi } from './browser-api.ts';
import type { LocalStore } from './browser-storage.ts';
function memory():LocalStore{const data=new Map<string,unknown>();return{async get<T>(key:string){return structuredClone(data.get(key)) as T|undefined;},async set(key,value){data.set(key,structuredClone(value));},async entries<T>(prefix:string){return [...data].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value) as T]);},async clear(){data.clear();}};}
const report=(month:string,count:number)=>({mode:'live',input:{mode:'live',period:{start:month+'-01',end:month+(month.endsWith('09')?'-30':'-31'),timeZone:'Asia/Shanghai'},expectedPlatforms:['netease'],platforms:[{id:'netease',period:{start:month+'-01',end:month+(month.endsWith('09')?'-30':'-31'),timeZone:'Asia/Shanghai'},tracks:[{id:'song',title:'Song',artist:'Artist',count,genres:[]}]}]},issues:[],fetchedAt:'2026-11-25T00:00:00Z'});
test('browser caches each actual month locally and restores it without another cloud read',async()=>{
 const store=memory();let reads=0;
 const nativeFetch=(async(input:RequestInfo|URL)=>{const url=String(input);if(url==='/api/connections')return Response.json({providers:[{id:'netease',connected:true,connectionId:'one',reportScope:'account-one'}]});reads++;return Response.json(report(new URL(url,'https://x.test').searchParams.get('month')!,url.includes('09')?12:38));}) as typeof fetch;
 let api=createBrowserApi({store,nativeFetch});
 const sep=await(await api('/api/report?month=2026-09')).json(),oct=await(await api('/api/report?month=2026-10')).json();
 assert.equal(sep.input.platforms[0].tracks[0].count,12);assert.equal(oct.input.platforms[0].tracks[0].count,38);assert.equal(reads,2);
 api=createBrowserApi({store,nativeFetch});await api('/api/report?month=2026-09');assert.equal(reads,2);
 const saved=await(await api('/api/history/netease/reports')).json();assert.deepEqual(saved.months,['2026-09','2026-10']);
});
test('changing an account cannot reuse the previous account report',async()=>{
 const store=memory();let account='one',reads=0;
 const nativeFetch=(async(input:RequestInfo|URL)=>String(input)==='/api/connections'?Response.json({providers:[{id:'netease',connected:true,connectionId:account,reportScope:account}]}):(reads++,Response.json(report('2026-09',account==='one'?20:80)))) as typeof fetch;
 const api=createBrowserApi({store,nativeFetch});assert.equal((await(await api('/api/report?month=2026-09')).json()).input.platforms[0].tracks[0].count,20);
 account='two';await api('/api/connections');assert.equal((await(await api('/api/report?month=2026-09')).json()).input.platforms[0].tracks[0].count,80);assert.equal(reads,2);
});
test('partial/error results are retried and wrong-month results never enter local storage',async()=>{
 const store=memory();let reads=0;
 const nativeFetch=(async(input:RequestInfo|URL)=>{if(String(input)==='/api/connections')return Response.json({providers:[{id:'netease',connected:true,connectionId:'one'}]});reads++;return Response.json(report('2026-10',22));}) as typeof fetch;
 const api=createBrowserApi({store,nativeFetch});const response=await api('/api/report?month=2026-09');assert.equal(response.status,503);assert.equal((await response.json()).error.code,'REPORT_INVALID');assert.equal((await store.entries('report:')).length,0);await api('/api/report?month=2026-09');assert.equal(reads,2);
});
