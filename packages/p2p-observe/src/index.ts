// @p2p/observe — one plug-and-play package for P2P request observability across
// React Native (bare-kit worklets), plain Pear/Bare apps, and desktop (Electron/Node).
//
// Zero-config:
//   import { observe } from '@p2p/observe';
//   const obs = observe();                       // auto-detects runtime + hub transport
//   instrumentDataChannel(dc, peerId, obs.sink); // wire your transport (any adapter)
//
// Everything below is re-exported so a consumer needs exactly one dependency.

export { observe, DEFAULT_TOPIC } from './observe.ts';
export type { ObserveOptions, ObserveHandle } from './observe.ts';
export { detectRuntime } from './detect.ts';
export type { Runtime, RuntimeInfo } from './detect.ts';

// Generic RPC/service-client tap (endpoint + request + response + subscription streams) —
// works in any runtime. Usually reached via observe().wrapClient(...).
export { wrapClient } from './wrap-client.ts';
export type { Report, WrapClientOptions } from './wrap-client.ts';
// Reliable local-dev viewer transport for every runtime.
export { createWebSocketReporter } from './reporters.ts';
export type { Reporter, WebSocketReporterOptions } from './reporters.ts';

// L1 adapters (tap your transport)
export {
  instrumentDataChannel,
  instrumentPeerConnection,
} from '../../p2p-probe/adapters/webrtc.ts';
export { instrumentWebSocket } from '../../p2p-probe/adapters/websocket.ts';
export { instrumentHyperswarmStream } from '../../p2p-probe/adapters/hyperswarm.ts';

// L2 collector + framing + exporter (usually reached via observe(), exported for advanced use)
export { CollectorSink } from '../../p2p-probe/core/sink.ts';
export { BatchFlusher } from '../../p2p-probe/core/flush.ts';
export { createHyperswarmExporter } from '../../p2p-probe/exporters/hyperswarm.ts';
export { StreamFramer, encodeFrame } from '../../p2p-probe/transport/framing.ts';
export type { EventSink, L2Event, L2EventType } from '../../p2p-probe/src/sink.ts';
