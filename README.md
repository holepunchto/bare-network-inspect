# bare-network-inspect

hrpc based debugging and observability for Bare.

## Quick start

```bash
bash verification/run-all.sh     # runs the full gate; zero dependencies
```

The suite has zero npm dependencies, so a fresh clone can run it immediately — no install step.

## Try the package (`@holepunchto/bare-network-inspect`)

Observe an app's P2P/RPC traffic as a network inspector — endpoint, request, core response, latency, live subscription streams — across React Native, Pear/Bare, desktop, and browser.

```bash
npm i -D @holepunchto/bare-network-inspect      # public npm, no auth
```
```js
import { observe } from '@holepunchto/bare-network-inspect'
const obs = observe({ websocket: 'ws://127.0.0.1:9420/ws' })   // reliable local-dev viewer
const client = obs.wrapClient(myRpcClient)                     // endpoint + request + response + streams
```
```bash
npx bare-observe gui                       # open the inspector at http://localhost:9420
```

Full reference: [packages/bare-observe/USAGE.md](packages/bare-observe/USAGE.md).
Upgrading from an older release (renamed CLI, renamed scoped packages)? See [MIGRATION.md](MIGRATION.md).

## Publishing / how others install

Install needs no auth — the package is on the public npm registry:

```bash
npm i -D @holepunchto/bare-network-inspect
```

Or straight from git (a `prepare` script builds on install):

```bash
npm i github:holepunchto/bare-network-inspect
```

Releasing: tag a version and CI publishes it (`.github/workflows/release.yml`).

```bash
git tag v0.1.0 && git push --tags
```

The workflow runs `verification/run-all.sh` as a hard gate first, publishes from each package's own
`package.json` version rather than the tag string, and is idempotent — a version already on the
registry is skipped, not failed. It needs an `NPM_TOKEN` repo secret (an npm **automation** token,
which bypasses 2FA in CI) with publish rights on the `@holepunchto` scope. No `.npmrc` is committed;
auth comes from that secret alone.

## Layout

```
packages/
  bare-observe/             the published package — @holepunchto/bare-network-inspect
    src/                    observe(), wrapClient, runtime detect, reporters, init planner
    bin/bare-observe.mjs    the CLI: `init` (dry-run by default) and `gui`
    gui/                    dependency-free inspector UI + WebSocket server
    USAGE.md                full export reference, every symbol with verified signatures
  bare-probe/               internal L1+L2 engine (unpublished, relative-imported)
    core/                   ring buffer, correlator, sampler, flusher, sink, redactor
    clock/                  hybrid logical clock + offset/skew estimation
    adapters/               WebRTC, WebSocket, Hyperswarm transport taps
    transport/              length-prefixed framing + capability contract
    native/                 iOS/Android probe bridge (schema-mirroring, see its README)
  bare-protocol/            internal L0 wire contract (unpublished, relative-imported)
    src/                    P2PEnvelope, encodings, version negotiation, identity guard
verification/
  run-all.sh                CI gate — non-zero exit blocks merge
  *.test.mjs                22 dependency-free suites (see run-all.sh for the roster)
scripts/
  rebrand.sh                re-applies this fork's rename over an upstream-synced tree
```

## Start here

Using the package → [packages/bare-observe/README.md](packages/bare-observe/README.md), then
[USAGE.md](packages/bare-observe/USAGE.md) for the full export reference.
Changing the code → run `bash verification/run-all.sh` first; it is the contract.
Syncing from upstream → [scripts/rebrand.sh](scripts/rebrand.sh) documents the whole procedure in
its header.

## License

[Apache-2.0](LICENSE). Copyright notice in [NOTICE](NOTICE).

## The one rule

**No claim ships without a runnable proof.** Four states, always labelled: VERIFIED, CORRECTED, UNVERIFIABLE HERE (with evidence of the limit), UNVERIFIED.

This is not process for its own sake. Of 17 checkable claims in the original plan, **2 were wrong** — envelope overhead was off by ~3×, and the recommended clock-offset estimator was second-best. Neither was caught by review; both were caught in under a minute by execution.

## Known-unverified

Do not treat these as established:

- **C16** — panel renders 10k rows without frame drops. Needs a real DevTools frontend.
- **C17** — probe overhead under 2% CPU on device. The 12 MB Node heap figure says nothing about a mid-range Android under thermal throttling.

## Automation boundary

~70% of the pipeline runs unattended. Four gates cannot:

| Gate | Why |
|---|---|
| G1 Protocol sign-off | Bandwidth vs debuggability is a product tradeoff |
| G2 Redaction review | Accountability for a leak can't sit with an agent |
| G3 Release-bundle audit | Build flags aren't proof; grep the artefact |
| G4 Field validation | Needs 2 devices on 2 networks — physically impossible in a sandbox |

## Notes

- `verification/` has **no npm dependencies**. `cbor-selfcheck.mjs` skips cleanly without `cbor-x`.
- If `run-all.sh` isn't executable after copying, run `bash verification/run-all.sh` or `chmod +x`.
- Re-verify quarterly: package-API claims (C1–C3) and the RN tooling landscape (C13) move. The algorithmic claims are stable.
