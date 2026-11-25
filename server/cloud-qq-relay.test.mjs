import test from 'node:test';import assert from 'node:assert/strict';
import {createQqRelay} from './cloud-qq-relay.mjs';
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};}
test('QQ relay waits for subscription, replays ordered events and opens one listener',async()=>{
 const rows=new Map(),store={async read(key){return{value:structuredClone(rows.get(key))};},async update(key,fn){const next=fn(structuredClone(rows.get(key)));if(next!==undefined)rows.set(key,next);return structuredClone(rows.get(key));}};
 const ready=deferred(),done=deferred();let callback,opens=0,lifetime;
 const relay=createQqRelay({store,waitUntil:p=>lifetime=p,listen:(_id,cb)=>{opens++;callback=cb;return{ready:ready.promise,done:done.promise,close:()=>done.resolve()};}});
 let opened=false;const opening=relay.open('qr-one','image',180000).then(()=>{opened=true});await new Promise(r=>setTimeout(r,5));assert.equal(opened,false);
 ready.resolve();await opening;assert.equal(await relay.image('qr-one'),'image');await relay.open('qr-one','image',180000);assert.equal(opens,1);
 callback({type:'scanned',payload:{}});callback({type:'authorized',payload:{test:1}});await new Promise(r=>setTimeout(r,5));
 assert.deepEqual((await relay.poll('qr-one')).map(e=>e.type),['scanned','authorized']);assert.deepEqual((await relay.poll('qr-one')).map(e=>e.type),['scanned','authorized']);
 await relay.close('qr-one');done.resolve();await lifetime;assert.equal(rows.get('qq-relay:qr-one').state,'closed');
});
