#!/usr/bin/env bash
# rebrand.sh — re-apply this fork's package rename over an upstream-synced tree.
# Idempotent: safe to run any number of times. Renames PUBLISHED names only; directory
# paths (packages/p2p-observe/…) stay identical so release.yml + relative imports keep working.
#
# RUN THIS IN THE FORK CLONE, not upstream. Sync workflow (path-scoped so dropped packages
# never return, and this repo's trimmed run-all.sh / release.yml stay yours):
#
#   git fetch upstream
#   git checkout upstream/main -- packages/p2p-observe packages/p2p-probe packages/p2p-protocol
#   git checkout upstream/main -- verification/*.mjs        # tests only, NOT run-all.sh
#   bash scripts/rebrand.sh
#   git add -A && git commit -m "sync upstream $(git rev-parse --short upstream/main) + rebrand"
#   git push
set -euo pipefail

# ---- fork identity ----
NEW_SCOPE="@holepunchto"                            # GitHub Packages scope = repo owner org
NEW_OBSERVE="$NEW_SCOPE/bare-network-inspect"       # published name for the p2p_observe package
NEW_THREADS="$NEW_SCOPE/bare-network-inspect-threads" # no-op here (p2p_threads not vendored), kept for parity
NEW_REPO="holepunchto/bare-network-inspect"         # owner/name for repository URLs + workflow header
# -----------------------

cd "$(git rev-parse --show-toplevel)"
files=$(git ls-files | grep -vE 'package-lock\.json|/dist/')

# FROM/TO via the ENVIRONMENT so Perl reads them at runtime — a "/" in the value is data, never
# the s/// delimiter. \Q…\E literal-quotes the search text; the replacement uses the plain var.
subst() { FROM="$1" TO="$2" perl -0777 -pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/g' $files; }

# Specific scoped names first, then the bare scope, then the repo path.
subst "@ariprasath4664/p2p_observe" "$NEW_OBSERVE"   # also fixes any p2p_threads peerDep / dynamic import
subst "@ariprasath4664/p2p_threads" "$NEW_THREADS"   # no-op if absent
subst "@ariprasath4664"            "$NEW_SCOPE"       # .npmrc registry scope + stragglers
subst "ARIPRASATH4664/p2p_observe" "$NEW_REPO"        # package.json "repository" + release.yml header

echo "rebrand applied. scoped names now in tree:"
grep -rhoE "$NEW_SCOPE/[a-zA-Z0-9_-]+" $files | sort -u | sed 's/^/  /'