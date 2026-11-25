import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createTransientStore } from './cloud-store.mjs';
import { BlobPreconditionFailedError } from '@vercel/blob';
function memoryBlob(){
 const rows=new Map();let sequence=0;
 return { rows, sdk: {
 async get(path,options){assert.equal(options.headers['Accept-Encoding'],'identity');assert.equal(options.useCache,false);const item=rows.get(path);return item?{statusCode:200,stream:new Response(item.body).body,blob:{etag:item.etag}}:null;},
 async put(path,body,options){const old=rows.get(path);if((old&&!options.allowOverwrite)||(options.ifMatch&&old?.etag!==options.ifMatch))throw new BlobPreconditionFailedError();const etag=String(++sequence);rows.set(path,{body,etag,options});return{etag};}
 }};
}
test('cloud login records are encrypted, bound to their path, expire and retry concurrent updates',async()=>{
 let now=1000;const blob=memoryBlob();const store=createTransientStore({secret:randomBytes(32).toString('base64url'),sdk:blob.sdk,now:()=>now});
 await store.update('session:alice',()=>({credential:'secret-cookie-ALICE',count:0,expiresAt:5000}));
 assert.ok(![...blob.rows.values()][0].body.includes('ALICE'));
 assert.equal([...blob.rows.values()][0].options.access,'private');assert.equal([...blob.rows.values()][0].options.ttlDays,1);
 await Promise.all(Array.from({length:5},()=>store.update('session:alice',value=>({...value,count:value.count+1}))));
 assert.equal((await store.read('session:alice')).value.count,5);
 assert.equal((await store.read('session:bob')).value,null);
 now=6000;assert.equal((await store.read('session:alice')).value,null);
 await store.update('session:alice',()=>({expiresAt:9000,count:0}));
 assert.equal((await store.read('session:alice')).value.count,0);
});
test('ciphertext copied between records cannot be decrypted',async()=>{
 const blob=memoryBlob(),store=createTransientStore({secret:randomBytes(32).toString('base64url'),sdk:blob.sdk});
 await store.update('a',()=>({expiresAt:Date.now()+5000}));await store.update('b',()=>({expiresAt:Date.now()+5000}));
 const [a,b]=[...blob.rows.keys()];blob.rows.get(b).body=blob.rows.get(a).body;
 await assert.rejects(store.read('b'));
});
