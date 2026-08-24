// Proves the G2 gap is CLOSED: observe() redacts on the export path by default, so raw
// peer ids / signalling tokens / bodies never reach the exporter (hub / .p2plog). The
// CONTROL (redact:false) shows the same data leaks unredacted — redaction is load-bearing.

import { observe } from '../packages/p2p-observe/src/observe.ts';
import { StreamFramer } from '../packages/p2p-probe/transport/framing.ts';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

console.log('observe-redaction.test.mjs — redaction on the export path (G2 wired)\n');

const collect = () => {
  let wire = new Uint8Array(0);
  return {
    stream: { write(b) { const n = new Uint8Array(wire.length + b.length); n.set(wire); n.set(b, wire.length); wire = n; return true; } },
    first() { let out = []; new StreamFramer((m) => out.push(JSON.parse(new TextDecoder().decode(m)))).push(wire); return out[0]; },
  };
};

// A row carrying exactly the things that must not leave the device raw.
const RAW_PEER = 'peer-abcdef0123456789';
const RAW_URL = 'wss://signal.example.com/room/42?token=SUPERSECRET';
const sensitive = () => ({ type: 'ws.open', corrId: 'c1', method: 'sig.connect',
  peerId: RAW_PEER, url: RAW_URL, body: { secret: 'do-not-leak' }, t: 0 });

// --- default: redaction ON ---
const on = collect();
const obs = observe({ stream: on.stream, autoSwarm: false });
const input = sensitive();
obs.sink.emit(input);
obs.flusher.flushNow();
obs.stop();
const red = on.first();

check('redactor present by default', obs.redactor !== null);
check('peerId is HASHED, not raw', typeof red.peerId === 'string' && red.peerId.startsWith('ph_') && red.peerId !== RAW_PEER, red.peerId);
check('URL stripped to host — token GONE', red.url === 'wss://signal.example.com' && !JSON.stringify(red).includes('SUPERSECRET'), red.url);
check('body summarised (byteLength/hash/shape), not raw', red.body && typeof red.body === 'object' && 'byteLength' in red.body && !('secret' in red.body), JSON.stringify(red.body));
check('input row NOT mutated (live view keeps raw)', input.peerId === RAW_PEER && input.url === RAW_URL);
// method+corrId (needed for the timeline) still present — redaction removes secrets, not structure.
check('non-sensitive fields preserved (method, corrId)', red.method === 'sig.connect' && red.corrId === 'c1');

// --- CONTROL: redaction OFF (local-only view) → data leaks, proving the default is load-bearing ---
const off = collect();
const obs2 = observe({ stream: off.stream, autoSwarm: false, redact: false });
obs2.sink.emit(sensitive());
obs2.flusher.flushNow();
obs2.stop();
const rawOut = off.first();
check('CONTROL: redactor null when redact:false', obs2.redactor === null);
check('CONTROL: raw peerId reaches exporter when OFF', rawOut.peerId === RAW_PEER, rawOut.peerId);
check('CONTROL: token-bearing URL reaches exporter when OFF', rawOut.url === RAW_URL && JSON.stringify(rawOut).includes('SUPERSECRET'));

console.log(failures === 0 ? '\nAll observe-redaction claims verified.' : `\n${failures} claim(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
