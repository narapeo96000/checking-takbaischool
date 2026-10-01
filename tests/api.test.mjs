import test from 'node:test';
import assert from 'node:assert/strict';
import { AppsScriptApi, ApiError } from '../assets/api.js';

const API_URL = 'https://script.google.com/macros/s/Test_deployment_123/exec';
const HOST_ORIGIN = 'https://narapeo96000.github.io';
const GOOGLE_ORIGIN = 'https://n-school-bridge-script.googleusercontent.com';

function source(name) {
  return { name, messages: [], postMessage(message, origin) { this.messages.push({ message, origin }); } };
}

/** A browser-shaped harness with explicit message sources and a controlled clock. */
function browser(t) {
  const descriptors = new Map(['window', 'document', 'location', 'setTimeout', 'clearTimeout'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map(), timers = new Map(), frames = [], apis = [];
  let now = 0, timerId = 0;
  const install = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  install('window', {
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); }
  });
  install('location', { origin: HOST_ORIGIN });
  install('document', {
    createElement(tag) {
      assert.equal(tag, 'iframe');
      return { credentialless: false, contentWindow: source('outer Google iframe'), removed: false, isConnected: false,
        remove() { this.removed = true; this.isConnected = false; } };
    },
    body: { append(frame) { frame.isConnected = true; frames.push(frame); } }
  });
  install('setTimeout', (callback, delay = 0, ...args) => {
    const id = ++timerId; timers.set(id, { callback, args, due: now + delay }); return id;
  });
  install('clearTimeout', id => timers.delete(id));
  t.after(() => {
    for (const api of apis) api.dispose();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return {
    frames, timers,
    api() { const api = new AppsScriptApi(API_URL); apis.push(api); return api; },
    emit(data, origin = GOOGLE_ORIGIN, messageSource = source('unbound window')) {
      for (const callback of listeners.get('message') || []) callback({ data, origin, source: messageSource });
    },
    advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].due; next[1].callback(...next[1].args);
      }
      now = target;
    }
  };
}

function tracked(promise) { promise.catch(() => {}); return promise; }
async function ready(env, api, inner = source('inner Apps Script sandbox')) {
  const connection = tracked(api.connect());
  env.emit({ type: 'CHECKING_READY', channel: api.channel }, GOOGLE_ORIGIN, inner);
  await connection;
  return inner;
}
async function request(api, action, payload = {}) {
  const promise = tracked(api.call(action, payload));
  // call() first awaits connect(); wait for its request to reach postMessage.
  await Promise.resolve();
  await Promise.resolve();
  return { promise, ...api.source.messages.at(-1) };
}

test('handshake rejects hostile origins and wrong channels before binding a Google inner window', async t => {
  const env = browser(t), api = env.api(), inner = source('inner Apps Script sandbox');
  const connection = tracked(api.connect());
  const message = { type: 'CHECKING_READY', channel: api.channel };
  for (const origin of ['https://evil.example', 'https://googleusercontent.com.evil.example', 'https://notgoogleusercontent.com', 'http://n-school-bridge-script.googleusercontent.com', 'https://script.google.com']) {
    env.emit(message, origin, inner);
    assert.equal(api.source, null, `rejected ${origin}`);
  }
  env.emit({ ...message, channel: 'different-connection-nonce' }, GOOGLE_ORIGIN, inner);
  env.emit({ ...message, channel: undefined }, GOOGLE_ORIGIN, inner);
  env.emit({ ...message, type: 'CHECKING_RESPONSE', requestId: 'unsolicited' }, GOOGLE_ORIGIN, inner);
  assert.equal(api.source, null);
  assert.equal(api.origin, null);
  assert.equal(env.timers.size, 1, 'invalid handshakes do not cancel the connection deadline');

  env.emit(message, GOOGLE_ORIGIN, inner);
  await connection;
  assert.equal(api.source, inner);
  assert.equal(api.origin, GOOGLE_ORIGIN);
  assert.equal(env.timers.size, 0);
});

test('connection binds the Google inner sandbox rather than requiring the outer iframe window', async t => {
  const env = browser(t), api = env.api(), inner = source('inner Apps Script sandbox');
  const first = tracked(api.connect()), second = tracked(api.connect());
  assert.equal(env.frames.length, 1, 'concurrent callers share one bridge iframe');
  const frame = env.frames[0], url = new URL(frame.src);
  assert.equal(url.origin, 'https://script.google.com');
  assert.equal(url.searchParams.get('hostOrigin'), HOST_ORIGIN);
  assert.equal(url.searchParams.get('channel'), api.channel);
  assert.equal(frame.hidden, true);
  assert.equal(frame.credentialless, true);
  assert.equal(frame.referrerPolicy, 'no-referrer');
  assert.notEqual(inner, frame.contentWindow);
  env.emit({ type: 'CHECKING_READY', channel: api.channel }, GOOGLE_ORIGIN, inner);
  await Promise.all([first, second]);
  assert.equal(api.source, inner, 'Google HtmlService sends READY from its nested sandbox');
  await api.connect();
  assert.equal(env.frames.length, 1, 'connected callers reuse the authenticated bridge');
});

test('requests and responses remain bound to the accepted source, origin, channel and request ID', async t => {
  const env = browser(t), api = env.api(), inner = await ready(env, api);
  api.token = 'school-session-test-token';
  const payload = { date: '2026-10-01', classroomId: 'm1-1' };
  const sent = await request(api, 'getAttendance', payload);
  assert.equal(sent.origin, GOOGLE_ORIGIN);
  assert.equal(sent.message.type, 'CHECKING_REQUEST');
  assert.equal(sent.message.channel, api.channel);
  assert.deepEqual(sent.message.request.payload, payload);
  assert.equal(sent.message.request.action, 'getAttendance');
  assert.equal(sent.message.request.token, api.token);
  assert.equal(sent.message.request.requestId, sent.message.requestId);
  const response = { type: 'CHECKING_RESPONSE', channel: api.channel, requestId: sent.message.requestId, result: { ok: true, data: { revision: 4, records: [] } } };
  const otherInner = source('another Google sandbox');
  const attempts = [
    [response, 'https://evil.example', inner],
    [response, 'https://another-script.googleusercontent.com', inner],
    [response, GOOGLE_ORIGIN, env.frames[0].contentWindow],
    [response, GOOGLE_ORIGIN, otherInner],
    [{ ...response, channel: 'wrong-nonce' }, GOOGLE_ORIGIN, inner],
    [{ ...response, requestId: 'wrong-request' }, GOOGLE_ORIGIN, inner],
    [{ ...response, type: 'OTHER_RESPONSE' }, GOOGLE_ORIGIN, inner]
  ];
  for (const [message, origin, messageSource] of attempts) {
    env.emit(message, origin, messageSource);
    assert.equal(api.pending.size, 1, 'untrusted response must not settle the request');
  }
  env.emit({ type: 'CHECKING_READY', channel: api.channel }, GOOGLE_ORIGIN, otherInner);
  assert.equal(api.source, inner, 'a second READY cannot replace the bound window');
  env.emit(response, GOOGLE_ORIGIN, inner);
  assert.deepEqual(await sent.promise, { revision: 4, records: [] });
  assert.equal(api.pending.size, 0);
  assert.equal(env.timers.size, 0);
  env.emit(response, GOOGLE_ORIGIN, inner);
  assert.equal(api.pending.size, 0, 'duplicate replies do not create or revive requests');
});

test('a bound backend error is propagated with its code and details', async t => {
  const env = browser(t), api = env.api(), inner = await ready(env, api);
  const sent = await request(api, 'saveAttendance', { records: [] });
  const failure = assert.rejects(sent.promise, error => error instanceof ApiError && error.code === 'FORBIDDEN' && error.message === 'ไม่มีสิทธิ์เข้าถึงห้องเรียนนี้' && error.details.classroomId === 'm1-1');
  env.emit({ type: 'CHECKING_RESPONSE', channel: api.channel, requestId: sent.message.requestId, response: { ok: false, error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์เข้าถึงห้องเรียนนี้', details: { classroomId: 'm1-1' } } } }, GOOGLE_ORIGIN, inner);
  await failure;
  assert.equal(api.pending.size, 0);
  assert.equal(env.timers.size, 0);
});

test('connection timeout removes its iframe and a fresh retry rejects the expired READY', async t => {
  const env = browser(t), api = env.api(), expiredInner = source('expired inner sandbox');
  const first = tracked(api.connect()), expiredChannel = api.channel, expiredFrame = env.frames[0];
  const failed = assert.rejects(first, error => error instanceof ApiError && error.code === 'CONNECTION');
  env.advance(24999);
  assert.equal(expiredFrame.removed, false, 'connection stays available until its deadline');
  env.advance(1);
  await failed;
  assert.equal(expiredFrame.removed, true);
  assert.equal(api.ready, null);
  assert.equal(api.resolveReady, null);
  assert.equal(api.source, null);
  assert.equal(api.origin, null);
  assert.equal(env.timers.size, 0);
  assert.notEqual(api.channel, expiredChannel, 'timeout invalidates the old channel immediately');
  env.emit({ type: 'CHECKING_READY', channel: expiredChannel }, GOOGLE_ORIGIN, expiredInner);
  assert.equal(api.source, null, 'late READY is ignored even before retry starts');

  const retry = tracked(api.connect()), freshInner = source('fresh inner sandbox');
  assert.equal(env.frames.length, 2);
  assert.notEqual(api.channel, expiredChannel);
  assert.equal(new URL(env.frames[1].src).searchParams.get('channel'), api.channel);
  env.emit({ type: 'CHECKING_READY', channel: expiredChannel }, GOOGLE_ORIGIN, expiredInner);
  assert.equal(api.source, null, 'expired READY cannot claim the fresh connection');
  env.emit({ type: 'CHECKING_READY', channel: api.channel }, GOOGLE_ORIGIN, freshInner);
  await retry;
  assert.equal(api.source, freshInner);
  assert.equal(env.timers.size, 0);
});

test('request timeout removes pending state and late replies cannot resolve a later request', async t => {
  const env = browser(t), api = env.api(), inner = await ready(env, api);
  const expired = await request(api, 'statistics', { date: '2026-10-01' });
  const rejected = assert.rejects(expired.promise, error => error instanceof ApiError && error.code === 'TIMEOUT');
  env.advance(60000);
  await rejected;
  assert.equal(api.pending.size, 0);
  const fresh = await request(api, 'statistics', { date: '2026-10-02' });
  assert.notEqual(fresh.message.requestId, expired.message.requestId);
  env.emit({ type: 'CHECKING_RESPONSE', channel: api.channel, requestId: expired.message.requestId, result: { ok: true, data: { date: '2026-10-01' } } }, GOOGLE_ORIGIN, inner);
  assert.equal(api.pending.size, 1, 'late response for expired request cannot settle its successor');
  env.emit({ type: 'CHECKING_RESPONSE', channel: api.channel, requestId: fresh.message.requestId, result: { ok: true, data: { date: '2026-10-02' } } }, GOOGLE_ORIGIN, inner);
  assert.deepEqual(await fresh.promise, { date: '2026-10-02' });
  assert.equal(api.pending.size, 0);
  assert.equal(env.timers.size, 0);
});
