import test from 'node:test';
import assert from 'node:assert/strict';
import {SafeStorage,pickSpreadsheetFile,readFileBytes} from '../assets/browser.js';

test('mobile storage fallback retains pending drafts in this page and reports persistence loss',()=>{
 const store=new SafeStorage(()=>{throw new Error('blocked');});assert.equal(store.persistent,false);store.setItem('drafts','pending');assert.equal(store.getItem('drafts'),'pending');store.removeItem('drafts');assert.equal(store.getItem('drafts'),null);
 const values=new Map();const backend={getItem:k=>values.get(k)??null,setItem(k,v){values.set(k,v);},removeItem:k=>values.delete(k)};const writable=new SafeStorage(()=>backend);assert.equal(writable.persistent,true);backend.setItem=()=>{throw new Error('quota');};writable.setItem('drafts','still pending');assert.equal(writable.getItem('drafts'),'still pending');assert.equal(writable.persistent,false);
});
test('native spreadsheet picker is attached before opening and cleans up on cancel or selection',async()=>{
 const handlers=new Map();let attached=false,removed=false;const input={style:{},files:[],setAttribute(){},addEventListener(type,handler){handlers.set(type,handler);},click(){assert.equal(attached,true);},remove(){removed=true;}};const host={addEventListener(){},removeEventListener(){}};const cancel={addEventListener(){},remove(){}};const doc={createElement:tag=>tag==='input'?input:cancel,body:{append(){attached=true;}},addEventListener(){},removeEventListener(){}};
 const cancelled=pickSpreadsheetFile(doc,host);handlers.get('cancel')();assert.equal(await cancelled,null);assert.equal(removed,true);
 removed=false;const selected=pickSpreadsheetFile(doc,host);const file={name:'students.xlsx'};input.files=[file];handlers.get('change')();assert.equal(await selected,file);assert.equal(removed,true);
});
test('file reading uses the native byte API when available',async()=>{const bytes=new Uint8Array([1,2,3]).buffer;assert.equal(await readFileBytes({arrayBuffer:async()=>bytes}),bytes);});

test('returning focus before a cloud file is ready never discards the later selection',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const handlers=new Map(),hostHandlers=new Map();const input={style:{},files:[],setAttribute(){},addEventListener(type,fn){handlers.set(type,fn);},click(){},remove(){}};
 const cancel={addEventListener(){},remove(){}};const doc={hidden:false,createElement:tag=>tag==='input'?input:cancel,body:{append(){}},addEventListener(){},removeEventListener(){}};const host={addEventListener(type,fn){hostHandlers.set(type,fn);},removeEventListener(){}};let settled=false;const pending=pickSpreadsheetFile(doc,host).then(file=>{settled=true;return file;});hostHandlers.get('focus')?.();t.mock.timers.tick(1000);await Promise.resolve();assert.equal(settled,false);const cloud={name:'cloud.xlsx'};input.files=[cloud];handlers.get('change')();assert.equal(await pending,cloud);
});
