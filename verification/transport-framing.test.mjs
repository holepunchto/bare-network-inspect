// Proves the transport generalization layer (packages/bare-probe/transport/,
// packages/bare-probe/adapters/hyperswarm.ts) holds its contract:
//
//   (a) StreamFramer round-trip: N envelopes, arbitrary chunk boundaries
//       (mid-frame split AND two-frames-in-one-chunk), reassembles to
//       exactly N whole messages, in order.
//       CONTROL: the SAME arbitrarily-chunked byte stream, fed WITHOUT the
//       framer (naive "one chunk == one message"), produces corrupted/
//       misaligned output — proves framing is load-bearing, not vacuous.
//   (b) instrumentHyperswarmStream against a FAKE NoiseSecretStream: write
//       tap (bytes + bufferedAmount-analog + return value + this), data tap
//       reassembles via framing, identity from remotePublicKey.
//       CONTROL: disabled = genuine no-op (same guarantee as WebRTC/WS).
//   (c) capabilitiesAllowIdentityDrop + @holepunchto/bare-protocol's checkIdentityDrop:
//       both permit drop for the 1:1 hyperswarm stream and refuse it for a
//       multiplexed descriptor — proving L0 needed ZERO changes to support
//       the new transport.
//   (d) shared adapter contract: all three TRANSPORT_REGISTRY entries expose
//       the identical {name, capabilities, instrument()} shape, and disabling
//       each is a verified no-op — one seam, three transports.
//
// UNVERIFIABLE HERE: `pear`/`bare` are installed (bare v1.28.0, measured this
// session), but there is no live Hyperswarm connection, no second peer, and
// no independent network topology available (CLAUDE.md: one NAT'd interface
// here). The FAKE duplex stream below mirrors NoiseSecretStream's documented
// method shape; this file verifies the WRAPPER + FRAMING logic only, not
// real on-device Hyperswarm/UDX behaviour.

import { StreamFramer, encodeFrame, createFramer } from '../packages/bare-probe/transport/framing.ts';
import { capabilitiesAllowIdentityDrop, HYPERSWARM_CAPABILITIES } from '../packages/bare-probe/transport/capabilities.ts';
import { instrumentHyperswarmStream, publicKeyToPeerId } from '../packages/bare-probe/adapters/hyperswarm.ts';
import { TRANSPORT_REGISTRY } from '../packages/bare-probe/transport/contract.ts';
import { checkIdentityDrop } from '../packages/bare-protocol/src/identity.ts';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  PASS  ' + m)) : (fail++, console.log('  FAIL  ' + m)); };

console.log('transport-framing.test.mjs — Hyperswarm adapter + transport generalization\n');

// ---------------------------------------------------------------------------
// (a) StreamFramer round-trip under arbitrary chunk boundaries + CONTROL
// ---------------------------------------------------------------------------
console.log('(a) StreamFramer — arbitrary chunk boundaries reassemble exactly N messages, in order:\n');
{
  const messages = [
    'short',
    JSON.stringify({ corrId: 'c1', msgId: 'm1', method: 'blocks.fetch', kind: 'req' }),
    'x'.repeat(500), // long enough to itself span multiple small chunks
    '',
    JSON.stringify({ corrId: 'c2', kind: 'res', payload: { blocks: [1, 2, 3] } }),
  ];
  const N = messages.length;

  const frames = messages.map((m) => encodeFrame(m));
  let full = new Uint8Array(0);
  for (const f of frames) {
    const merged = new Uint8Array(full.length + f.length);
    merged.set(full, 0);
    merged.set(f, full.length);
    full = merged;
  }

  // Arbitrary chunk boundaries: deliberately include a split that lands
  // INSIDE the 4-byte length prefix (chunk size 2), a split mid-payload
  // (chunk size 7), and large chunks that coalesce 2+ frames together.
  function chunkAt(buf, sizes) {
    const chunks = [];
    let i = 0, si = 0;
    while (i < buf.length) {
      const size = sizes[si % sizes.length];
      chunks.push(buf.slice(i, i + size));
      i += size;
      si++;
    }
    return chunks;
  }

  for (const sizes of [[2, 7, 1000], [3], [1], [1000], [5, 5, 5, 5, 5, 5, 5]]) {
    const received = [];
    const framer = new StreamFramer((bytes) => received.push(new TextDecoder().decode(bytes)));
    for (const chunk of chunkAt(full, sizes)) framer.push(chunk);

    ok(received.length === N, `chunk sizes ${JSON.stringify(sizes)}: exactly ${N} messages recovered (got ${received.length})`);
    ok(JSON.stringify(received) === JSON.stringify(messages), `chunk sizes ${JSON.stringify(sizes)}: content AND order match the originals exactly`);
    ok(framer.pending === 0, `chunk sizes ${JSON.stringify(sizes)}: zero bytes left pending after a complete stream`);
  }

  // Split EXACTLY inside the length prefix (after 2 of its 4 bytes) as an
  // explicit boundary case, not just covered incidentally by the loop above.
  {
    const received = [];
    const framer = new StreamFramer((bytes) => received.push(new TextDecoder().decode(bytes)));
    framer.push(full.slice(0, 2));   // half of the very first length prefix
    framer.push(full.slice(2, 3));   // rest of the length prefix, arriving alone
    framer.push(full.slice(3));      // everything else in one big chunk
    ok(JSON.stringify(received) === JSON.stringify(messages), 'length-prefix split byte-by-byte still reassembles correctly');
  }
}

// CONTROL: WITHOUT the framer, the same arbitrarily-chunked stream (raw,
// unframed application bytes, chunked at OS-like boundaries) does NOT
// recover the original messages when treated as "one chunk == one message" —
// proves the framer is doing real work, not vacuously passing because the
// test data happened to be small enough to always arrive whole.
console.log('\n(a) CONTROL — WITHOUT framing, the same split stream is corrupted/misaligned:\n');
{
  const messages = ['first-message', 'second-message', 'third-message'];
  const raw = messages.join(''); // no delimiters at all: what a naive concatenated write looks like on the wire
  const bytes = new TextEncoder().encode(raw);
  // Chunk at fixed 6-byte boundaries — guaranteed NOT to land on message boundaries.
  const naiveChunks = [];
  for (let i = 0; i < bytes.length; i += 6) naiveChunks.push(bytes.slice(i, i + 6));

  const naivelyDecoded = naiveChunks.map((c) => new TextDecoder().decode(c));
  ok(naivelyDecoded.length !== messages.length, `CONTROL: naive "one chunk == one message" yields ${naivelyDecoded.length} chunks, not the original ${messages.length} messages`);
  ok(JSON.stringify(naivelyDecoded) !== JSON.stringify(messages), 'CONTROL: naive chunk contents do NOT match the original messages (proves reassembly is necessary, not optional)');
}

// ---------------------------------------------------------------------------
// (b) instrumentHyperswarmStream against a fake NoiseSecretStream duplex
// ---------------------------------------------------------------------------
console.log('\n(b) instrumentHyperswarmStream — write tap, framed data tap, intrinsic identity:\n');

class MemorySink {
  constructor() { this.events = []; }
  emit(e) { this.events.push(e); }
}

// Mirrors the real API surface: .write(buf), .on('data'|'close', cb),
// .remotePublicKey, .writableLength (Node/Bare Writable backpressure analog).
class FakeNoiseSecretStream {
  constructor(remotePublicKey) {
    this.remotePublicKey = remotePublicKey;
    this.writableLength = 0;
    this._listeners = new Map();
    this.writeCalls = [];
    this._writeImpl = (data) => { this.writeCalls.push(data); return true; };
  }
  write(data) { return this._writeImpl(data); }
  on(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeListener(type, fn) {
    const arr = this._listeners.get(type) || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  emitData(chunk) { for (const fn of this._listeners.get('data') || []) fn(chunk); }
  emitClose() { for (const fn of this._listeners.get('close') || []) fn(); }
}

{
  const remoteKey = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02]);
  const stream = new FakeNoiseSecretStream(remoteKey);
  stream.writableLength = 17; // the queue depth THIS write actually faced
  const sink = new MemorySink();
  const origWriteRef = stream.write;
  instrumentHyperswarmStream(stream, sink);

  const payload = JSON.stringify({ corrId: 'h1', msgId: 'hm1', method: 'blocks.fetch', kind: 'req' });
  const ret = stream.write(payload);

  ok(ret === true, 'write() returns the ORIGINAL return value unchanged');
  ok(stream.writeCalls.length === 1, 'origWrite called exactly once');
  ok(stream.writeCalls[0] instanceof Uint8Array && stream.writeCalls[0].length === encodeFrame(payload).length,
     'origWrite received the FRAMED bytes (length-prefixed) so the receiver can reassemble message boundaries');

  ok(sink.events.length === 1, 'exactly one event emitted for one write()');
  const e = sink.events[0];
  ok(e.type === 'request.start', "kind:'req' -> type 'request.start' (identical vocabulary to the WebRTC adapter)");
  ok(e.bufferedAmount === 17, `writableLength captured BEFORE write (=17) — measured ${e.bufferedAmount}`);
  ok(e.bytes === new TextEncoder().encode(payload).length, 'bytes measures the APPLICATION payload, not the framed wire size');
  ok(e.transport === 'hyperswarm', "transport tagged 'hyperswarm'");

  // Independently recompute the expected hex (not by calling publicKeyToPeerId
  // again) so this isn't a tautological check of the adapter's own helper.
  const expectedHex = Array.from(remoteKey).map((b) => b.toString(16).padStart(2, '0')).join('');
  ok(e.peerId === expectedHex, `peerId derived from remotePublicKey with NO explicit peerId passed (intrinsic identity) — got ${e.peerId}`);
  ok(e.peerId === 'deadbeef0102', 'concrete expected hex matches (deadbeef0102)');
}

// Data tap: two frames coalesced in one chunk, plus a split frame — proves
// the SAME framing correctness from (a) is actually wired into the adapter,
// not just available as a library function nobody calls.
{
  const stream = new FakeNoiseSecretStream(new Uint8Array([1, 2, 3]));
  const sink = new MemorySink();
  instrumentHyperswarmStream(stream, sink, { peerId: 'explicit-peer' });

  const msg1 = JSON.stringify({ corrId: 'r1', kind: 'res', method: 'blocks.fetch' });
  const msg2 = JSON.stringify({ corrId: 'r2', kind: 'event' });
  const f1 = encodeFrame(msg1);
  const f2 = encodeFrame(msg2);

  // Coalesced: both frames arrive in a single 'data' event.
  const coalesced = new Uint8Array(f1.length + f2.length);
  coalesced.set(f1, 0);
  coalesced.set(f2, f1.length);
  stream.emitData(coalesced.slice(0, coalesced.length - 3)); // ...but withhold the last 3 bytes
  stream.emitData(coalesced.slice(coalesced.length - 3));    // ...delivered in a second, tiny event

  ok(sink.events.length === 2, `two coalesced+split frames -> exactly 2 message events (got ${sink.events.length})`);
  ok(sink.events[0].type === 'request.end' && sink.events[0].corrId === 'r1', "kind:'res' -> 'request.end', corrId recovered after reassembly");
  ok(sink.events[1].type === 'message.in' && sink.events[1].corrId === 'r2', "kind:'event' -> 'message.in', second frame recovered in order");
  ok(sink.events.every((e) => e.peerId === 'explicit-peer'), 'explicit peerId override respected (not forced to intrinsic identity)');
}

// Close event
{
  const stream = new FakeNoiseSecretStream(new Uint8Array([9, 9]));
  const sink = new MemorySink();
  instrumentHyperswarmStream(stream, sink);
  stream.emitClose();
  ok(sink.events.some((e) => e.type === 'conn.state' && e.event === 'close'), 'stream close tapped as conn.state/close');
}

// CONTROL: disabled = genuine no-op, same guarantee proven for webrtc/websocket.
console.log('\n(b) CONTROL — disabled Hyperswarm probe is a genuine no-op:\n');
{
  const stream = new FakeNoiseSecretStream(new Uint8Array([1, 2, 3]));
  const originalWriteRef = stream.write;
  const sink = new MemorySink();
  const inst = instrumentHyperswarmStream(stream, sink, { enabled: false });

  ok(stream.write === originalWriteRef, 'DISABLED: stream.write is left as the EXACT original reference');
  const ret = stream.write('payload-when-disabled');
  ok(ret === true && stream.writeCalls.length === 1 && stream.writeCalls[0] === 'payload-when-disabled',
     'DISABLED: origWrite called once, with the identical (UNFRAMED) arg, original return value preserved');
  stream.emitData(new Uint8Array([1, 2, 3]));
  stream.emitClose();
  ok(sink.events.length === 0, 'DISABLED: zero events emitted across write + data + close');
  inst.restore();
  ok(true, 'DISABLED: restore() on a no-op instrument does not throw');
}

// ---------------------------------------------------------------------------
// (c) capabilities-driven identity-drop
// ---------------------------------------------------------------------------
console.log('\n(c) capabilities-driven identity-drop — permits 1:1 hyperswarm, refuses multiplexed:\n');
{
  ok(capabilitiesAllowIdentityDrop({ capabilities: HYPERSWARM_CAPABILITIES, topology: 'unicast-1to1' }) === true,
     'capabilitiesAllowIdentityDrop: PERMITS drop on a 1:1 Hyperswarm stream');

  const multiplexedHyperswarmLike = { ...HYPERSWARM_CAPABILITIES, multiplexed: true };
  ok(capabilitiesAllowIdentityDrop({ capabilities: multiplexedHyperswarmLike, topology: 'unicast-1to1' }) === false,
     'capabilitiesAllowIdentityDrop: REFUSES drop when capabilities.multiplexed=true, even with topology unicast-1to1 (capability wins)');

  ok(capabilitiesAllowIdentityDrop({ capabilities: HYPERSWARM_CAPABILITIES, topology: 'fanout' }) === false,
     'capabilitiesAllowIdentityDrop: REFUSES drop on fanout topology regardless of capabilities');

  // Cross-check against @holepunchto/bare-protocol's OWN guard (identity.ts), constructed
  // with transport:'hyperswarm' — a value NOT in identity.ts's frozen
  // `Transport` union. If this throws or misbehaves, L0 would need editing
  // to support the new transport; it does not, because checkIdentityDrop's
  // logic is topology/transport-carve-out structural, not an enum switch
  // over every known transport.
  const remoteKey = () => 'peer-from-noise-handshake';
  const oneToOneBinding = {
    topology: 'unicast-1to1',
    transport: 'hyperswarm',
    resolveSrc: remoteKey,
    resolveDst: () => 'me',
  };
  ok(checkIdentityDrop(oneToOneBinding).ok === true,
     "L0's checkIdentityDrop (UNMODIFIED) ACCEPTS drop for transport:'hyperswarm' on a 1:1 channel — zero L0 edits needed to add this transport");

  const multiplexedBinding = { ...oneToOneBinding, topology: 'multiplexed' };
  ok(checkIdentityDrop(multiplexedBinding).ok === false,
     "L0's checkIdentityDrop (UNMODIFIED) REFUSES drop for transport:'hyperswarm' on a multiplexed channel");
}

// ---------------------------------------------------------------------------
// (d) shared adapter contract — one seam, three transports
// ---------------------------------------------------------------------------
console.log('\n(d) TRANSPORT_REGISTRY — all adapters share one {name, capabilities, instrument()} contract:\n');
{
  ok(TRANSPORT_REGISTRY.length === 3, `registry has exactly 3 transports (got ${TRANSPORT_REGISTRY.length})`);
  for (const adapter of TRANSPORT_REGISTRY) {
    ok(typeof adapter.name === 'string' && adapter.name.length > 0, `${adapter.name}: has a non-empty name`);
    ok(typeof adapter.instrument === 'function', `${adapter.name}: .instrument is a function`);
    const caps = adapter.capabilities;
    const hasAllCapFields = ['orientation', 'reliable', 'ordered', 'multiplexed', 'intrinsicIdentity'].every((k) => k in caps);
    ok(hasAllCapFields, `${adapter.name}: capabilities has all 5 required fields`);
    ok(caps.orientation === 'message' || caps.orientation === 'stream', `${adapter.name}: orientation is a valid enum value ('${caps.orientation}')`);
  }

  // Disabled-is-a-no-op, proven ONCE across the shared seam for all three,
  // each against a minimally-shaped fake target.
  const fakeDc = { send: () => 'DC_RET', bufferedAmount: 0, addEventListener() {}, removeEventListener() {} };
  const fakeWsGlobal = { WebSocket: class { constructor() {} addEventListener() {} send() { return 'WS_RET'; } } };
  const fakeStream = new FakeNoiseSecretStream(new Uint8Array([1]));

  const targets = { 'webrtc-dc': fakeDc, websocket: fakeWsGlobal, hyperswarm: fakeStream };
  for (const adapter of TRANSPORT_REGISTRY) {
    const sink = new MemorySink();
    const target = targets[adapter.name];
    const before = adapter.name === 'websocket' ? fakeWsGlobal.WebSocket : target.send ?? target.write;
    const inst = adapter.instrument(target, sink, { enabled: false });
    ok(typeof inst.restore === 'function', `${adapter.name}: disabled instrument() still returns a valid Uninstrument`);
    const after = adapter.name === 'websocket' ? fakeWsGlobal.WebSocket : target.send ?? target.write;
    ok(before === after, `${adapter.name}: DISABLED via the shared seam leaves the target UNTOUCHED (same reference)`);
    ok(sink.events.length === 0, `${adapter.name}: DISABLED via the shared seam emits ZERO events`);
  }
}

console.log(`\n${fail === 0 ? 'All transport-framing.test.mjs claims verified.' : fail + ' FAILED'}`);
process.exit(fail ? 1 : 0);
