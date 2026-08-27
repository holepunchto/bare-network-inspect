export const meta = {
  name: 'pr-review',
  description: 'Review the PR with bare-reviewer, adversarially verify, then have bare-architect judge feature impact and adjudicate a final call',
  whenToUse: 'Before merging a PR that touches the probe, collector, redactor, GUI, or anything published. Pass the diff range as args (default origin/main...HEAD).',
  phases: [
    { title: 'Review', detail: 'bare-reviewer over 5 dimensions in parallel' },
    { title: 'Verify', detail: 'one refute-first skeptic per finding — kills plausible-but-wrong' },
    { title: 'Impact', detail: 'bare-architect judges feature impact + sequencing' },
    { title: 'Discuss', detail: 'reviewer rebuts the architect, architect answers' },
    { title: 'Decide', detail: 'adjudicate the disputed items into one final call' },
  ],
}

// Agents read the .md contracts directly instead of using opts.agentType. The contracts live in
// .claude/agents/ and are the same files a human invokes; reading them keeps this workflow working
// even when the agent registry has not picked up a newly added definition.
const REVIEWER = '/Users/ari/hustle/bare-network-inspect/.claude/agents/bare-reviewer.md'
const ARCHITECT = '/Users/ari/hustle/bare-network-inspect/.claude/agents/bare-architect.md'
const RANGE = (typeof args === 'string' && args) || 'origin/main...HEAD'

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'line', 'claim', 'failure', 'evidence', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          claim: { type: 'string', description: 'one-line defect claim' },
          failure: { type: 'string', description: 'concrete scenario: inputs/order/runtime -> wrong outcome' },
          evidence: { type: 'string', description: 'what in the code proves it' },
          fix: { type: 'string', description: 'smallest correct change' },
        },
      },
    },
    auditedClean: { type: 'array', items: { type: 'string' } },
    notAudited: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['refuted', 'reasoning', 'confidence'],
  properties: {
    refuted: { type: 'boolean', description: 'true if the finding does NOT hold up' },
    reasoning: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    correction: { type: 'string', description: 'if the claim is partly right, the accurate version' },
  },
}

const IMPACT_SCHEMA = {
  type: 'object',
  required: ['assessments'],
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'claim', 'impact', 'fixImpact', 'blastRadius', 'sequencing', 'fixRisk'],
        properties: {
          file: { type: 'string' },
          claim: { type: 'string' },
          impact: { type: 'string' },
          fixImpact: { type: 'string' },
          blastRadius: { type: 'string' },
          sequencing: { type: 'string', enum: ['BLOCK-MERGE', 'BEFORE-PUBLIC', 'FOLLOW-UP', 'ACCEPT'] },
          fixRisk: { type: 'string' },
          overrulesReviewer: { type: 'boolean' },
        },
      },
    },
    orderedActions: { type: 'array', items: { type: 'string' } },
    shipAnyway: { type: 'array', items: { type: 'string' } },
    openDisagreements: { type: 'array', items: { type: 'string' } },
  },
}

const DIMENSIONS = [
  { key: 'memory', focus: `Area 1 (memory & lifetime leaks) ONLY. Every collection that grows per event/peer/call/connection/app-restart: does it have a cap AND an eviction path? Is any map keyed by something that changes every process start? Every listener and monkey-patch: reachable teardown from the public stop()/restore()? Every timer: cleared on all exit paths including errors? What breaks if observe() is called twice? Follow: src/observe.ts, src/wrap-client.ts, src/reporters.ts, ../bare-probe/core/*, gui/server.mjs.` },
  { key: 'security', focus: `Area 2 (security & privacy) ONLY, and redaction completeness is the highest-value check. core/redactor.ts is FIELD-NAME driven: enumerate EXHAUSTIVELY every key emitted by every event-producing site (wrap-client.ts, observe.ts, every adapters/*.ts, native/bridge.ts) and check each against the redactor's field sets. A payload under an unknown key is exported IN THE CLEAR. Then: per-path redaction defaults, replay/invoke as an RCE surface, loopback binding, the WS origin guard, and what the tarball ships.` },
  { key: 'workarounds', focus: `Area 3 (unwanted workarounds) ONLY. Error-swallowing that loses data — but the probe's never-throw boundary is DELIBERATE and correct, do not flag it as such. Magic numbers with no basis, sleeps standing in for synchronisation, as any/@ts-ignore defeating a protective type, tests that assert nothing or lack a control case, TODO/FIXME a caller would hit, and references to files/packages/docs that do not exist.` },
  { key: 'js-standards', focus: `Area 4 (JavaScript standards) ONLY. Floating promises whose rejection is unhandled (the dynamic-import auto-dial path is a prime suspect). ESM correctness and explicit extensions. hasOwnProperty off the instance. Wrapper fidelity: is 'this' binding and the return value preserved exactly through every wrapper? Mutating a caller's object without documenting it. Counter overflow and length-prefix precision.` },
  { key: 'bare-standards', focus: `Area 5 (Bare/Pear runtime standards) ONLY. node:* imports on paths that must run in Bare or a browser — but FIRST establish each file's surface, because node: builtins are legitimate in the desktop-only CLI and GUI server, and a false positive here is a bad finding. Unguarded process/window/document/localStorage/navigator/Buffer. Optional peers (hyperswarm, hypercore-crypto) loaded by dynamic import inside the path that needs them and matching the esbuild --external flags. Hostile-case framing in transport/framing.ts: partial frame, many chunks, several frames per chunk, absurd declared length.` },
]

phase('Review')
log(`reviewing ${RANGE} across ${DIMENSIONS.length} dimensions`)

const reviews = await parallel(DIMENSIONS.map((d) => () =>
  agent(
    `Read ${REVIEWER} IN FULL and follow it exactly — it is your operating contract (evidence bar, severity scale, what NOT to report).

Repo: /Users/ari/hustle/bare-network-inspect. Scope: the changes in ${RANGE}, but read changed files in full, not just hunks — a leak is only visible with the lifetime around it.

YOUR ASSIGNED AREA: ${d.focus}

Other reviewers cover the other areas; stay in yours so the work is not duplicated.

Hold the contract's bar: every finding needs file:line, a concrete failure scenario, and a severity. DROP anything you cannot prove. Zero findings is a respectable result — do not pad. Read-only: no writes, no git mutations, no publish.`,
    { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA },
  )))

const raw = reviews.filter(Boolean)
const all = raw.flatMap((r) => r.findings || [])

// Barrier justified: dedup needs every dimension's findings at once (two reviewers can land on the
// same site from different angles), and a zero-finding total should skip the rest entirely.
const seen = new Set()
const deduped = all.filter((f) => {
  const k = `${f.file}:${f.line}:${(f.claim || '').slice(0, 60)}`
  if (seen.has(k)) return false
  seen.add(k)
  return true
})

log(`${all.length} raw findings -> ${deduped.length} after dedup`)

if (!deduped.length) {
  return {
    verdict: 'CLEAN',
    note: 'No dimension produced a provable finding.',
    auditedClean: raw.flatMap((r) => r.auditedClean || []),
    notAudited: raw.flatMap((r) => r.notAudited || []),
  }
}

// Bound the fan-out so a noisy review cannot run away; report what was dropped rather than
// silently truncating.
const VERIFY_CAP = 8
const order = { critical: 0, high: 1, medium: 2, low: 3 }
const ranked = [...deduped].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
const toVerify = ranked.slice(0, VERIFY_CAP)
if (ranked.length > VERIFY_CAP) {
  log(`NOTE: verifying top ${VERIFY_CAP} of ${ranked.length}; ${ranked.length - VERIFY_CAP} lower-severity findings pass through unverified and are labelled as such`)
}

phase('Verify')

const verified = await parallel(toVerify.map((f, i) => () =>
  agent(
    `You are a skeptic. Try to REFUTE this review finding by reading the actual code. Default to refuted=true when uncertain — a plausible-but-wrong finding wastes more of the team's time than a missed nit.

Repo: /Users/ari/hustle/bare-network-inspect

FINDING (${f.severity}) ${f.file}:${f.line}
  Claim:    ${f.claim}
  Failure:  ${f.failure}
  Evidence: ${f.evidence}

Read ${f.file} around line ${f.line} and whatever it calls. Then decide:
- Does the failure scenario ACTUALLY occur, or does something already prevent it (a cap, a guard, a caller contract, an eviction path, a deliberate documented design)?
- Is the claimed severity right, or inflated?
- If the claim is partly right, give the accurate narrower version in "correction".

Do NOT accept the finding because it sounds reasonable. Find the code that settles it. Read-only.`,
    { label: `verify:${f.file.split('/').pop()}:${f.line}`, phase: 'Verify', schema: VERDICT_SCHEMA },
  ).then((v) => ({ ...f, verdict: v })),
))

const survivors = verified.filter(Boolean).filter((f) => f.verdict && !f.verdict.refuted)
const killed = verified.filter(Boolean).filter((f) => f.verdict && f.verdict.refuted)
const unverified = ranked.slice(VERIFY_CAP)

log(`${survivors.length} confirmed, ${killed.length} refuted, ${unverified.length} unverified (cap)`)

if (!survivors.length && !unverified.length) {
  return {
    verdict: 'CLEAN-AFTER-VERIFY',
    note: 'Every finding was refuted on verification.',
    refuted: killed.map((f) => ({ file: f.file, claim: f.claim, why: f.verdict.reasoning })),
  }
}

phase('Impact')

const forArchitect = [...survivors, ...unverified].map((f) => ({
  severity: f.severity, file: f.file, line: f.line, claim: f.claim,
  failure: f.failure, fix: f.fix,
  status: f.verdict ? 'confirmed by an independent skeptic' : 'UNVERIFIED (severity cap) — weigh accordingly',
  correction: f.verdict && f.verdict.correction ? f.verdict.correction : undefined,
}))

const impact = await agent(
  `Read ${ARCHITECT} IN FULL and follow it exactly — it is your operating contract.

Repo: /Users/ari/hustle/bare-network-inspect. The package is about to be published to PUBLIC npm from a repo that will become public.

Do NOT re-review for defects; that work is done. Judge FEATURE IMPACT and SEQUENCING for each finding below, per your contract. Read the cited code so your judgement is grounded, and respect the two claims you may never dismiss on taste or effort grounds.

CONFIRMED / PASSED-THROUGH FINDINGS:
${JSON.stringify(forArchitect, null, 2)}`,
  { label: 'architect:impact', phase: 'Impact', schema: IMPACT_SCHEMA },
)

phase('Discuss')

// The "auto discuss": the reviewer gets to rebut the architect's dismissals and sequencing, then
// the architect answers the rebuttal. Two turns, not an open loop — enough to surface a real
// disagreement, bounded enough to converge.
const rebuttal = await agent(
  `You are the reviewer from ${REVIEWER}. The architect has judged your findings. Push back ONLY where they are wrong.

Read ${ARCHITECT} so you understand the standard they are held to — in particular, they may not dismiss data-leaving-a-device or a remote-invoke surface on grounds of taste, effort, or "unlikely in practice", and any overrule must cite specific code, a test, or a documented decision.

YOUR FINDINGS: ${JSON.stringify(forArchitect, null, 2)}

ARCHITECT'S ASSESSMENT: ${JSON.stringify(impact, null, 2)}

For each item where you disagree: quote their reasoning, say precisely why it fails, and cite the code. Where they are RIGHT — including where they correctly overruled you — say so plainly and drop it; conceding a bad finding is as valuable as defending a good one. If you agree with everything, say that and stop. Read-only.`,
  { label: 'reviewer:rebuttal', phase: 'Discuss' },
)

const answer = await agent(
  `Read ${ARCHITECT} IN FULL. You are the architect. The reviewer has rebutted your assessment.

YOUR ASSESSMENT: ${JSON.stringify(impact, null, 2)}

REVIEWER'S REBUTTAL:
${rebuttal}

Answer each point of disagreement. Concede where they are right — you are optimising for the correct call, not for winning. Hold your ground only where you can cite specific code, a test, or a documented design decision. For anything still unresolved, name the experiment that would settle it. Read-only.`,
  { label: 'architect:answer', phase: 'Discuss' },
)

phase('Decide')

const finalCall = await agent(
  `You are adjudicating a review disagreement to produce THE FINAL CALL for a human who has to decide whether to merge PR #1 of /Users/ari/hustle/bare-network-inspect.

Context: this seeds a public repo and publishes @holepunchto/bare-network-inspect to public npm. It is a debugging tool that taps live P2P/RPC traffic, so a privacy defect leaks user data off a device and a lifetime defect degrades the host app.

CONFIRMED FINDINGS: ${JSON.stringify(forArchitect, null, 2)}

REFUTED ON VERIFICATION (do not resurrect without new evidence): ${JSON.stringify(killed.map((f) => ({ file: f.file, claim: f.claim, why: f.verdict.reasoning })), null, 2)}

ARCHITECT'S ASSESSMENT: ${JSON.stringify(impact, null, 2)}

REVIEWER'S REBUTTAL:
${rebuttal}

ARCHITECT'S ANSWER:
${answer}

Read the disputed code yourself where the two sides disagree — do not just split the difference, and do not defer to whoever wrote more. Then produce:

1. VERDICT: exactly one of MERGE / MERGE-WITH-FOLLOWUPS / FIX-FIRST, with the one-sentence reason.
2. BLOCKING (must fix in this PR): each with file:line, why it blocks, and the smallest fix. Empty list is a valid answer.
3. BEFORE-PUBLIC (merge now, fix before the package is installable by outsiders).
4. FOLLOW-UP (file an issue).
5. ACCEPTED (deliberately not fixing) — each with the reason a future reader will need.
6. UNRESOLVED: disagreements you could not settle from the code, and the experiment that would settle each.
7. WHAT WAS NOT AUDITED: so the human never mistakes silence for a pass.

Be decisive and brief. Cite file:line for every claim. If the honest answer is "this is fine, merge it", say exactly that. Read-only.`,
  { label: 'final-call', phase: 'Decide' },
)

return {
  range: RANGE,
  counts: { raw: all.length, deduped: deduped.length, confirmed: survivors.length, refuted: killed.length, unverifiedByCap: unverified.length },
  auditedClean: raw.flatMap((r) => r.auditedClean || []),
  notAudited: raw.flatMap((r) => r.notAudited || []),
  refuted: killed.map((f) => ({ file: f.file, claim: f.claim, why: f.verdict.reasoning })),
  finalCall,
}
