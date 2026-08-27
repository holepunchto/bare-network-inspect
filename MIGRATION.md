# Migration: `p2p-*` → `bare-*`

Everything in the tree that still carried upstream's `p2p_observe` naming was renamed to match the
project this repo actually is. This file is the instruction sheet: what changed, what you have to do
about it, and what deliberately did not move.

The published package name — **`@holepunchto/bare-network-inspect`** — did **not** change. If you
only ever `import` the package and never invoked the CLI, there is nothing to do.

---

## 1. If you consume the package

### The CLI binary was renamed

```bash
npx p2p-observe gui        # before
npx bare-observe gui       # now
```

Same for `init`. Update any script, Makefile, CI job, or README of your own that shells out to it.

### The `init` scaffold now emits a resolvable import

This was a bug, not just a rename. The worklet file that `init` writes into a React Native project
imported from `'@p2p/observe'` — **a name that was never published**, so the generated file could not
resolve and the scaffold was dead on arrival. It now emits the real package name.

If you ran `init` before this change, fix the import at the top of your worklet by hand:

```js
- import { observe } from '@p2p/observe';
+ import { observe } from '@holepunchto/bare-network-inspect';
```

### The worklet filename changed

`init` used to create `p2p-observe.worklet.mjs`; it now creates `bare-observe.worklet.mjs`. An
existing file is not touched — `init` never overwrites. Either rename yours and update the
`worklet.start()` path, or keep the old name; only the generated default moved.

```js
// if you rename the file, update both of these:
import source from './bare-observe.worklet.mjs';
worklet.start('/bare-observe.worklet.mjs', source);
```

### The device-id storage key changed

`p2p-observe:deviceId` → `bare-observe:deviceId`. On first run after upgrading, a client will not
find the old key and will mint a **new** device id. Consequence: in a timeline spanning the upgrade,
one physical device appears as two sources. Harmless for local debugging; if you are correlating a
long capture across the upgrade, note the boundary. To keep the old id, copy the value across under
the new key before first run.

---

## 2. If you work in this repo

### Directories

| before | after |
| --- | --- |
| `packages/p2p-observe` | `packages/bare-observe` |
| `packages/p2p-probe` | `packages/bare-probe` |
| `packages/p2p-protocol` | `packages/bare-protocol` |

Renamed with `git mv`, so `git log --follow` still works on every file.

### Scoped names of the internal packages

| before | after |
| --- | --- |
| `@p2p/observe` | `@holepunchto/bare-network-inspect` (published) |
| `@p2p/probe` | `@holepunchto/bare-probe` (unpublished) |
| `@p2p/protocol` | `@holepunchto/bare-protocol` (unpublished) |

The two internal packages are still consumed by **relative import**, not from a registry — the name
change is for coherence in the tree, and nothing installs them.

### Rebase pain, and how to avoid it

If you have a branch in flight, a plain rebase will conflict on every renamed path. Rebase with
rename detection instead:

```bash
git rebase -X find-renames=40% main
```

Two classes of reference had to be fixed, and the second is the one that bites:

1. `packages/p2p-*/…` paths — in `verification/*.mjs` imports, `release.yml`, README links.
2. **Relative** cross-package imports *inside* the packages — `../../p2p-probe/core/flush.ts` and
   friends. These carry no `packages/` prefix, so a search-and-replace on `packages/p2p-` misses
   them entirely. They broke three suites until fixed. If you rename anything else here, grep for
   both shapes.

### CI

`release.yml`'s `workflow_dispatch` package choice is now `bare_observe` (was `p2p_observe`). If you
have a saved dispatch or an automation posting to that workflow, update the input value.

---

## 3. `scripts/rebrand.sh` — read this before the next upstream sync

The script re-applies this fork's rename over an upstream-synced tree. It was **silently broken**:
its substitutions had become self-referential no-ops, because at some point the FROM strings had
been rewritten into their own replacements. The next upstream sync would have landed completely
unrebranded, and nothing would have failed loudly.

It now also performs the directory and bin renames itself, and it prints residual upstream spellings
on exit so a bad run is visible.

**The rule, if you touch that file:** the FROM side holds *upstream's* spelling, the TO side holds
ours. Never "tidy" a FROM string to the new name — that is exactly what broke it. The script
excludes itself from its own rewrite pass for this reason, so do not run a repo-wide `sed` over it.

Sync procedure (also in the script's header — check out the **upstream** paths; the script renames
them):

```bash
git fetch upstream
git checkout upstream/main -- packages/p2p-observe packages/p2p-probe packages/p2p-protocol
git checkout upstream/main -- verification/*.mjs        # tests only, NOT run-all.sh
bash scripts/rebrand.sh
git add -A && git commit -m "sync upstream + rebrand"
```

---

## 4. Deliberately unchanged

Each of these would break something real, and none of them is part of the observe package's public
surface:

- **`P2PEnvelope`, `p2p.l2.event`** — the frozen wire contract. Renaming these breaks compatibility
  with already-deployed peers.
- **`P2PNativeProbe*` class names, `io.tether.p2p.probe`** — the native module identifiers.
  Renaming requires matching React Native module registration, gradle, and the podspec in lockstep.
- **`libp2p`** — a different protocol entirely; the substring match is coincidental.
- **`@holepunchto/bare-network-inspect`** — the published name. Unchanged, so no consumer reinstall.

---

## 5. Verifying a sync or a rename yourself

```bash
bash verification/run-all.sh                      # 22 checks; the contract
cd packages/bare-observe && npm i && npm run build
node bin/bare-observe.mjs init                    # dry run, writes nothing
bash scripts/rebrand.sh                           # idempotent: re-running changes nothing
```

`cbor-selfcheck` skips cleanly without `cbor-x` — that is a pass, not a gap. `rebrand.sh` ends by
listing residual upstream spellings; you want `(none)`.
