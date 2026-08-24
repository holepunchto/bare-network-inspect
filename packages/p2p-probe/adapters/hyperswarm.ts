// L1 probe — Hyperswarm / Holepunch NoiseSecretStream tap.
//
// UNVERIFIABLE HERE: `pear`/`bare` ARE installed in this sandbox (bare
// v1.28.0, measured this session — `bare --version`), but there is no
// running Hyperswarm connection, no second peer, and no network topology to
// dial one (CLAUDE.md: one interface, one NAT'd network here — see
// docs/03-orchestration.md §4 G4). What follows is verified against a FAKE
// duplex stream that mirrors NoiseSecretStream's documented method shape
// (`.write(buf)`, `.on('data', buf)`, `.on('close')`, `.remotePublicKey`,
// `.writableLength`) — it proves the WRAPPER + FRAMING logic, not real
// on-device Hyperswarm/UDX behaviour.
//
// STREAM vs MESSAGE (the reason this file exists, see ../transport/framing.ts):
// unlike WebRTC-DC/WebSocket (`send`/`onmessage` give discrete envelopes for
// free), a NoiseSecretStream is a raw byte stream — one `.write()` on the
// sender is NOT guaranteed to arrive as one `'data'` event on the receiver.
// Every `'data'` chunk is pushed through a `StreamFramer` before this adapter
// ever looks at envelope contents, so partial/coalesced reads are
// reassembled into whole messages first. This is the ONLY structural
// difference from adapters/webrtc.ts; the emitted L2Event shape is identical.
//
// Backpressure analog: DataChannel has `.bufferedAmount`; Node/Bare duplex
// streams have `.writableLength` (bytes queued in the internal buffer, not
// yet flushed to the OS) — same signal, different name. Captured BEFORE
// `.write()`, same as the WebRTC adapter (invariant 4).
//
// Identity: Hyperswarm's Noise handshake authenticates `remotePublicKey`
// before any application data moves (TransportCapabilities.intrinsicIdentity
// = true, ../transport/capabilities.ts) — no signalling-layer peerId is
// required. If the caller doesn't pass one, the hex-encoded public key IS
// the peerId.

import type { EventSink } from '../src/sink.ts';
import { emitSafe } from '../src/sink.ts';
import { byteLength, bestEffortDecode } from './webrtc.ts';
import type { EnvelopeHint, Uninstrument } from './webrtc.ts';
import { isProbeDisabledByBuild } from './env.ts';
import { createFramer } from '../transport/framing.ts';
import { encodeFrame } from '../transport/framing.ts';

export interface MinimalDuplexStream {
  write(data: Uint8Array | string): boolean;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  /** Set once the Noise handshake completes; authenticates the remote peer. */
  remotePublicKey?: Uint8Array | string;
  /** Node/Bare Writable analog of RTCDataChannel.bufferedAmount. */
  writableLength?: number;
}

export interface HyperswarmInstrumentOptions {
  /** Default true. Pass `enabled: false` for a genuine, verified no-op. */
  enabled?: boolean;
  /** Overrides the intrinsic-identity peerId derived from remotePublicKey. */
  peerId?: string;
  now?: () => number;
  decodeEnvelope?: (data: unknown) => EnvelopeHint | undefined;
}

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/** Hex-encode a public key. Same 6-byte-hashable shape our peer-hash tier
 *  (@p2p/protocol PeerRegistry) already expects for compact peer identifiers. */
export function publicKeyToPeerId(key: Uint8Array | string | undefined): string | undefined {
  if (key === undefined) return undefined;
  if (typeof key === 'string') return key;
  let hex = '';
  for (let i = 0; i < key.length; i++) hex += key[i].toString(16).padStart(2, '0');
  return hex;
}

function toStringIfDecodable(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

export function instrumentHyperswarmStream(
  stream: MinimalDuplexStream,
  sink: EventSink,
  opts: HyperswarmInstrumentOptions = {},
): Uninstrument {
  if (opts.enabled === false || isProbeDisabledByBuild()) {
    // Genuine no-op: stream is never touched. Nothing to restore. Same shape
    // whether disabled by caller or by build mode (./env.ts).
    return { restore() {} };
  }

  const now = opts.now ?? defaultNow;
  const decodeEnvelope = opts.decodeEnvelope ?? bestEffortDecode;
  const peerId = opts.peerId ?? publicKeyToPeerId(stream.remotePublicKey) ?? 'unknown-hyperswarm-peer';

  const origWrite = stream.write.bind(stream);
  stream.write = function instrumentedWrite(data: Uint8Array | string): boolean {
    // Invariant 4: writableLength (this transport's bufferedAmount analog)
    // captured BEFORE write, unconditionally.
    const bufferedAmount = stream.writableLength;
    let bytes = 0;
    let env: EnvelopeHint | undefined;
    try {
      bytes = byteLength(data);
      env = decodeEnvelope(data);
    } catch {
      /* never throw from the probe */
    }

    try {
      // Frame on the wire so the receiver's StreamFramer can reassemble
      // message boundaries out of an arbitrarily-chunked byte stream.
      const result = origWrite(encodeFrame(data));
      emitSafe(sink, {
        type: env?.kind === 'req' ? 'request.start' : 'message.out',
        peerId,
        bytes,
        transport: 'hyperswarm',
        bufferedAmount,
        msgId: env?.msgId,
        corrId: env?.corrId,
        method: env?.method,
        t: now(),
      });
      return result;
    } catch (err) {
      emitSafe(sink, {
        type: 'send.error',
        peerId,
        bytes,
        transport: 'hyperswarm',
        bufferedAmount,
        error: err instanceof Error ? err.message : String(err),
        t: now(),
      });
      throw err;
    }
  } as MinimalDuplexStream['write'];

  const framer = createFramer('stream', (message) => {
    try {
      const asString = toStringIfDecodable(message);
      const env = decodeEnvelope(asString);
      emitSafe(sink, {
        type: env?.kind === 'res' ? 'request.end' : 'message.in',
        peerId,
        bytes: message.length,
        transport: 'hyperswarm',
        msgId: env?.msgId,
        corrId: env?.corrId,
        method: env?.method,
        senderTs: env?.ts,
        hlc: env?.hlc,
        t: now(),
      });
    } catch {
      /* never throw from the probe */
    }
  });

  const onData = (chunk: unknown) => {
    try {
      framer.push(chunk as Uint8Array);
    } catch {
      /* never throw from the probe */
    }
  };
  stream.on('data', onData);

  const onClose = () => {
    emitSafe(sink, { type: 'conn.state', peerId, event: 'close', transport: 'hyperswarm', t: now() });
  };
  stream.on('close', onClose);

  return {
    restore() {
      stream.write = origWrite as MinimalDuplexStream['write'];
      stream.removeListener?.('data', onData);
      stream.removeListener?.('close', onClose);
    },
  };
}
