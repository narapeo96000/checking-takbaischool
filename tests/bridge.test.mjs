import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('RPC replies run on the bridge window task before posting to the bound host',()=>{
 const origin='https://narapeo96000.github.io',channel='test-bridge-channel',messages=[],listeners=new Map(),tasks=[];let success;
 const host={postMessage(message,target){messages.push({message,target});}};
 const bridge={top:host,addEventListener(type,fn){listeners.set(type,fn);},setTimeout(fn){tasks.push(fn);}};
 const runner={withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},dispatch(){}};
 const html=readFileSync(new URL('../apps-script/Bridge.html',import.meta.url),'utf8');const source=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('<?!= configJson ?>',JSON.stringify({hostOrigin:origin,channel}));
 vm.runInNewContext(source,{window:bridge,google:{script:{run:runner}}});assert.equal(messages[0].message.type,'CHECKING_READY');
 listeners.get('message')({source:host,origin,data:{type:'CHECKING_REQUEST',channel,requestId:'req-1',request:{action:'bootstrap',requestId:'req-1'}}});success({ok:true,data:{version:'test'}});
 assert.equal(messages.filter(item=>item.message.type==='CHECKING_RESPONSE').length,0);assert.equal(tasks.length,1);tasks.shift()();
 const reply=messages[1];assert.equal(reply.target,origin);assert.equal(reply.message.channel,channel);assert.equal(reply.message.requestId,'req-1');assert.equal(reply.message.result.ok,true);
});
