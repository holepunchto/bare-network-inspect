# bare-network-inspect

hrpc based debugging and observability for Bare.

## Quick start

```bash
bash verification/run-all.sh     # runs the full gate; zero dependencies
```

Drop this folder into **Claude Code** or **Cowork**. Agents in `.claude/agents/` are project-scoped and load automatically — commit them so the whole team shares the same specialists.

## Try the package (`@holepunchto/bare-network-inspect`)

Observe an app's P2P/RPC traffic as a network inspector — endpoint, request, core response, latency, live subscription streams — across React Native, Pear/Bare, desktop, and browser.

```bash
npm i -D @holepunchto/bare-network-inspect      # from GitHub Packages (auth) — or:  npm i github:holepunchto/bare-network-inspect
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

## Publishing / how others install

Two ways to consume it:

1. **GitHub Packages (registry).** Tag a release → CI publishes (`.github/workflows/release.yml`):
   ```bash
   git tag v0.1.0 && git push --tags
   ```
   Consumers add an `.npmrc` + a token with `read:packages`:
   ```
   @holepunchto:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
   ```
   > GitHub Packages requires auth **even for public packages** — every consumer needs a token.

2. **Direct from git (zero auth, if the repo is public).** A `prepare` script builds on install:
   ```bash
   npm i github:holepunchto/bare-network-inspect
   ```

For strangers to try with no token, make the **repo public** — path 2 is then frictionless.

## Layout

```
docs/
  00-technical-plan.md      Architecture: envelope, probes, L2 collector, surfaces
  01-roles-and-skills.md    9 roles, responsibilities, skills matrix, autonomy per role
  02-verification-log.md    Every claim + verbatim output + honest status
  03-orchestration.md       Agent pipeline, how to run it, the 4 human gates
.claude/
  agents/                   8 subagents (verified frontmatter schema)
  skills/                   3 skills: envelope design, probe instrumentation, claim verification
verification/
  run-all.sh                CI gate — non-zero exit blocks merge
  clock.test.mjs            HLC + offset estimation (8 assertions, incl. control)
  correlator.test.mjs       L2 memory bounds + timeouts (10 assertions)
  envelope-size.mjs         Encoding cost measurement (dependency-free)
  cbor-selfcheck.mjs        Cross-checks the built-in CBOR sizer against cbor-x
  validate-config.py        Validates agent/skill frontmatter against the schema
```

## Start here

New to the project → `docs/01-roles-and-skills.md`.
Deciding whether to trust any number in these docs → `docs/02-verification-log.md`.
Running the agents → `docs/03-orchestration.md`.

## The one rule

**No claim ships without a runnable proof.** Four states, always labelled: VERIFIED, CORRECTED, UNVERIFIABLE HERE (with evidence of the limit), UNVERIFIED.

This is not process for its own sake. Of 17 checkable claims in the original plan, **2 were wrong** — envelope overhead was off by ~3×, and the recommended clock-offset estimator was second-best. Neither was caught by review; both were caught in under a minute by execution.

## Known-unverified

Do not treat these as established:

- **C16** — panel renders 10k rows without frame drops. Needs a real DevTools frontend.
- **C17** — probe overhead under 2% CPU on device. The 12 MB Node heap figure says nothing about a mid-range Android under thermal throttling.

## Automation boundary

~70% of the pipeline runs unattended. Four gates cannot, each with evidence in `docs/03-orchestration.md` §4:

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
