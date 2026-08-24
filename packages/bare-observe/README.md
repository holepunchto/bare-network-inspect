# @holepunchto/bare-network-inspect

One plug-and-play dev dependency for P2P request observability — the same core across
**React Native** (via `react-native-bare-kit` worklets), **plain Pear/Bare apps**, and
**desktop** (Electron/Node). Add it, call `observe()`, wire your transport.

## Install

```bash
npm i -D @holepunchto/bare-network-inspect
npx bare-observe init        # detect the project, preview config (dry run)
npx bare-observe init --write # apply (never overwrites existing files)
```

## Use (identical everywhere)

**Recommended — tap an RPC/service client and view it in the local GUI:**
```js
import { observe } from '@holepunchto/bare-network-inspect';

const obs = observe({ websocket: 'ws://127.0.0.1:9420/ws' });  // reliable local-dev viewer
const client = obs.wrapClient(myRpcClient);                    // endpoint + request + response
// subscription streams are monitored too — they show as live "streaming" rows, not "pending"
```
Then run the GUI: `npx bare-observe gui` → open http://localhost:9420.
(Android: `adb reverse tcp:9420 tcp:9420` first.)

**Or tap a raw transport** when there's no client:
```js
import { observe, instrumentDataChannel } from '@holepunchto/bare-network-inspect';
const obs = observe({ websocket: 'ws://127.0.0.1:9420/ws' });
instrumentDataChannel(dataChannel, peerId, obs.sink);
```

For multi-peer / field P2P instead of a local viewer, omit `websocket` and `observe()`
auto-dials the Hyperswarm hub. Full reference: [USAGE.md](./USAGE.md).

## Why one solution fits every runtime

The tap (`wrapClient` or a transport adapter) is pure JS and runs anywhere. Only the *reporter*
differs, and there are two:

- **Local dev — WebSocket → GUI** (recommended): `observe({ websocket })` streams to the GUI on
  your machine. Reliable device→laptop on RN (via `adb reverse` / LAN IP), Pear/Bare, Electron,
  Node, and browser — because it's a plain WebSocket, not DHT holepunching.
- **Multi-peer / field — Hyperswarm hub**: omit `websocket` and, inside Bare/Pear (or an RN
  `react-native-bare-kit` worklet), `observe()` auto-dials the hub; peers merge into one timeline.

`detectRuntime()` and the option you pass decide the path; the tap code is identical everywhere.

**Full export reference:** every path and symbol with verified signatures is in [USAGE.md](./USAGE.md).

## Verified vs not (this repo's convention)

- **VERIFIED** (Node, `verification/observe.test.mjs`): runtime detection for every target;
  `observe()` wiring (sink → flusher → exporter) frames events that the hub reader decodes
  intact; the buffering→`attach()` handoff; `init` planner output per project type.
- **VERIFIED** (`verification/observe-redaction.test.mjs`): redaction is applied on the export
  path **by default** — peer ids hashed, URL tokens stripped, bodies summarised — with a control
  proving raw ids/tokens reach the exporter only when `redact:false`. The live row is not mutated.
- **VERIFIED** (`verification/wrap-client.test.mjs`): the generic client tap reports
  endpoint/request/response, preserves return value + `this`, and monitors subscription
  streams (`stream.open`/`stream.data`/close) — with controls for unwrapped and monitor-off.
- **VERIFIED** (`verification/ws-reporter.test.mjs`): the WebSocket dev-viewer transport
  queues while down, flushes on open, sends while open, and drops after close (control).
- **UNVERIFIABLE HERE**: on-device RN (`react-native-bare-kit`), a live two-peer Hyperswarm
  connection (one NAT'd interface — C14/G4), and static `tsc` (no toolchain). The
  `react-native-bare-kit` Worklet API in the scaffold must be checked against current
  Holepunch docs before shipping.

## No silent postinstall

`init` is one explicit command and dry-runs by default. There is intentionally **no**
postinstall that edits your metro/babel/pear config — auto-mutating build config on install
is fragile and a supply-chain-trust smell.
