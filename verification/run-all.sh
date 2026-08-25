#!/usr/bin/env bash
# CI gate. Non-zero exit blocks merge.
# Core suite is dependency-free. The optional CBOR cross-check skips cleanly
# if cbor-x is absent, so `bash run-all.sh` works on a clean checkout.
set -u
cd "$(dirname "$0")"
fail=0
run() { echo "--- $1"; if eval "$2"; then echo "    PASS"; else echo "    FAIL"; fail=1; fi; echo; }

echo "=== P2P observability verification suite ==="
echo "Node $(node --version)"
echo

run "clock.test.mjs (HLC + offset estimation)"   "node clock.test.mjs"
run "clock-skew.test.mjs (offset/skew module + C8 + adversarial)" "node clock-skew.test.mjs"
run "correlator.test.mjs (L2 memory + timeouts)" "node correlator.test.mjs"
run "envelope-size.mjs (measurement)"            "node envelope-size.mjs"
run "envelope-transport.mjs (per-transport G1)"  "node envelope-transport.mjs"
run "version-negotiate.test.mjs (adjacent-ver)"  "node version-negotiate.test.mjs"
run "protocol-package.test.mjs (L0 @holepunchto/bare-protocol)" "node protocol-package.test.mjs"
run "probe.test.mjs (L1 @holepunchto/bare-probe adapters)"    "node probe.test.mjs"
run "transport-framing.test.mjs (Hyperswarm + framing generalization)" "node transport-framing.test.mjs"
run "hub-e2e.test.mjs (app exporter -> Pear hub wire contract)" "node hub-e2e.test.mjs"
run "observe.test.mjs (@holepunchto/bare-network-inspect plug-and-play + runtime detect)" "node observe.test.mjs"
run "redactor.test.mjs (G2 L2 redaction: peer/url/body)" "node redactor.test.mjs"
run "multipeer-merge.test.mjs (G4 in-memory multi-peer HLC merge)" "node multipeer-merge.test.mjs"
run "observe-redaction.test.mjs (redaction wired on export path)" "node observe-redaction.test.mjs"
run "wrap-client.test.mjs (generic RPC/service tap + streams)" "node wrap-client.test.mjs"
run "inflight.test.mjs (handle.inflight() tracks in-flight req/resp calls)" "node inflight.test.mjs"
run "ws-reporter.test.mjs (WebSocket dev-viewer transport)" "node ws-reporter.test.mjs"
run "source.test.mjs (source id injectivity + redaction)" "node source.test.mjs"
run "replay.test.mjs (GUI replay: enforced by corrId + gating + controls)" "node replay.test.mjs"
run "origin-guard.test.mjs (WS upgrade rejects cross-origin pages)" "node origin-guard.test.mjs"
run "testnet-capture.test.mjs (multi-peer capture; SKIPs w/o deps or udx)" "node testnet-capture.test.mjs"
run "tarball-cli.test.mjs (PUBLISHED artifact resolves + bin survives npm)" "node tarball-cli.test.mjs"
run "cbor-selfcheck.mjs (optional cross-check)"  "node cbor-selfcheck.mjs"

if [ $fail -eq 0 ]; then
  echo "ALL CHECKS PASSED"
else
  echo "VERIFICATION FAILED — merge blocked"
fi
exit $fail
