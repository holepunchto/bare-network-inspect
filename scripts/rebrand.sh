#!/usr/bin/env bash
# rebrand.sh — re-apply this fork's rename over an upstream-synced tree.
# Idempotent: safe to run any number of times. Does TWO things:
#   1. renames the upstream package DIRECTORIES  packages/p2p-* -> packages/bare-*  and rewrites
#      every in-tree reference to those paths (release.yml, README, verification imports, and the
#      relative ../../p2p-probe/ imports inside the packages);
#   2. renames upstream's scoped package names to this fork's scope, and the p2p-observe CLI +
#      worklet filename + storage-key strings to bare-observe.
#
# THE FROM SIDE IS UPSTREAM'S SPELLING, THE TO SIDE IS OURS. Never "fix" a FROM string to the
# new name — that silently turns the line into a no-op and the next upstream sync lands
# unrebranded. This file EXCLUDES ITSELF from the rewrite pass for exactly that reason
# (see `files` below); a repo-wide sed that includes it will break it.
#
# RUN THIS IN THE FORK CLONE, not upstream. Sync workflow (path-scoped so dropped packages
# never return, and this repo's trimmed run-all.sh / release.yml stay yours). Check out the
# UPSTREAM paths — this script renames them afterwards:
#
#   git fetch upstream
#   git checkout upstream/main -- packages/p2p-observe packages/p2p-probe packages/p2p-protocol
#   git checkout upstream/main -- verification/*.mjs        # tests only, NOT run-all.sh
#   bash scripts/rebrand.sh
#   git add -A && git commit -m "sync upstream $(git rev-parse --short upstream/main) + rebrand"
#   git push
set -euo pipefail

# ---- fork identity ----
NEW_SCOPE="@holepunchto"                              # npm scope (also the GitHub org)
NEW_OBSERVE="$NEW_SCOPE/bare-network-inspect"         # published name for upstream's p2p_observe
NEW_THREADS="$NEW_SCOPE/bare-network-inspect-threads" # no-op here (p2p_threads not vendored), kept for parity
NEW_PROBE="$NEW_SCOPE/bare-probe"                     # internal workspace pkg (unpublished)
NEW_PROTOCOL="$NEW_SCOPE/bare-protocol"               # internal workspace pkg (unpublished)
NEW_REPO="holepunchto/bare-network-inspect"           # owner/name for repository URLs + workflow header
NEW_CLI="bare-observe"                                # bin name, worklet filename, storage-key prefix
# -----------------------

cd "$(git rev-parse --show-toplevel)"

# ---- 1. directory renames (no-op once already renamed) ----
for pkg in observe probe protocol; do
  if [ -d "packages/p2p-$pkg" ]; then
    if [ -d "packages/bare-$pkg" ]; then
      # upstream sync re-created the old dir alongside ours: fold it in, then drop it.
      cp -R "packages/p2p-$pkg/." "packages/bare-$pkg/"
      rm -rf "packages/p2p-$pkg"
      git add -A "packages/bare-$pkg" "packages/p2p-$pkg"
    else
      git mv "packages/p2p-$pkg" "packages/bare-$pkg"
    fi
    echo "renamed packages/p2p-$pkg -> packages/bare-$pkg"
  fi
done

# The CLI entrypoint upstream ships as bin/p2p-observe.mjs.
if [ -f packages/bare-observe/bin/p2p-observe.mjs ]; then
  if [ -f "packages/bare-observe/bin/$NEW_CLI.mjs" ]; then
    mv -f packages/bare-observe/bin/p2p-observe.mjs "packages/bare-observe/bin/$NEW_CLI.mjs"
    git add -A packages/bare-observe/bin
  else
    git mv packages/bare-observe/bin/p2p-observe.mjs "packages/bare-observe/bin/$NEW_CLI.mjs"
  fi
  echo "renamed bin/p2p-observe.mjs -> bin/$NEW_CLI.mjs"
fi

# Two files are excluded because they quote upstream's spelling ON PURPOSE: this script (its
# search text) and MIGRATION.md (it documents the before/after for readers). Rewriting either
# one destroys its meaning.
files=$(git ls-files | grep -vE 'package-lock\.json|/dist/|^scripts/rebrand\.sh$|^MIGRATION\.md$')

# FROM/TO via the ENVIRONMENT so Perl reads them at runtime — a "/" in the value is data, never
# the s/// delimiter. \Q…\E literal-quotes the search text; the replacement uses the plain var.
subst() { FROM="$1" TO="$2" perl -0777 -pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/g' $files; }

# ---- 2a. directory paths — verification/*.mjs imports, DIRS in release.yml, doc links ----
subst "packages/p2p-observe"  "packages/bare-observe"
subst "packages/p2p-probe"    "packages/bare-probe"
subst "packages/p2p-protocol" "packages/bare-protocol"

# Relative cross-package imports inside the packages themselves (no "packages/" prefix).
subst "../../p2p-observe/"  "../../bare-observe/"
subst "../../p2p-probe/"    "../../bare-probe/"
subst "../../p2p-protocol/" "../../bare-protocol/"

# ---- 2b. scoped package names. Longest/most specific first. ----
subst "@p2p/observe"  "$NEW_OBSERVE"     # incl. the `init` worklet scaffold's import statement
subst "@p2p/threads"  "$NEW_THREADS"     # no-op if absent
subst "@p2p/probe"    "$NEW_PROBE"
subst "@p2p/protocol" "$NEW_PROTOCOL"
subst "@p2p"          "$NEW_SCOPE"       # .npmrc registry scope + stragglers

# ---- 2c. CLI / user-facing strings: bin name, worklet filename, localStorage key ----
subst "p2p-observe" "$NEW_CLI"           # `npx p2p-observe`, p2p-observe.worklet.mjs, p2p-observe:deviceId
subst "p2p_observe" "bare_observe"       # release.yml workflow_dispatch choice value

# ---- 2d. repo URLs (upstream repo slug -> ours) ----
subst "holepunchto/p2p_observe" "$NEW_REPO"   # package.json "repository" + release.yml header

echo "rebrand applied. scoped names now in tree:"
grep -rhoE "$NEW_SCOPE/[a-zA-Z0-9_-]+" $files | sort -u | sed 's/^/  /'
echo "residual upstream spellings (want none):"
grep -rnE 'p2p[-_/]observe|@p2p/' $files | sed 's/^/  /' || echo "  (none)"
