# CLAUDE.md sidecar — editing rules + decision log

## Editing rules for CLAUDE.md

- Terse, machine/LLM-readable. Keep word/token count low. No fluff.
- Do NOT bloat. Delegate detail to child/linked files; all links are
  optional reading, never mandatory.
- Do NOT add sections without explicit user approval.
- Nothing conflicting or confusing may remain in it.
- No "User decision ..." / change-log / "Previously ..." notes in
  CLAUDE.md — those belong in this sidecar only.
- These rules apply to CLAUDE.md files only, not other docs.

## Repo-wide sidecar rule

Decision notes and change logging (e.g. "User decision 2026-08-07",
"Previously did XYZ") must live in sidecar files, never in core files —
anywhere in the repo. Not retroactive.

## Decision log

- 2026-08-07: Single root CLAUDE.md; no per-directory CLAUDE.md files
  for now — feature folders are uniform, per-section files would
  duplicate the root. Candidate for a future child file:
  `src/features/planning/` if the subsection/planning feature adds
  enough local complexity.
- 2026-08-07: Adopted sidecar pattern (rules above) per user request.
- 2026-08-07: Sourcing feature — supply loops are now ALLOWED (user
  decision; previously refused by a cycle guard). Frozen-snapshot
  pricing never recurses; loops settle over repeated recomputes
  (self-loops iterate inside `computePlanSnapshot`, cross-plan loops
  via chain recompute settling passes, capped). A plan may source its
  own repair demand from its own output ("Own output" option) — this
  was the motivating case, repair demand never appears in the netted
  material I/O. Self-draws are excluded from the base fraction.
- 2026-08-07: Sourcing snapshots auto-compute (user decision):
  debounced upkeep on PlanView load when missing/stale and after any
  plan change — always single base, never the chain. To keep that from
  spamming staleness, `setSnapshot` only cascades stale to dependents
  when the numbers materially changed.
- 2026-08-07: Non-sourcing panels show read-only sourced-cost notes
  (user decision): Material I/O input rows, plan overview, workforce +
  supply-cart strips (daily totals), repair analysis totals. Vanilla
  numbers stay untouched; notes read frozen `inputPrices`/`sellPrices`
  stored on the snapshot.
- 2026-08-07: Reactivity rule — computeds must NOT read sourcing store
  state through `getConfig`/`getSnapshot`: `inertClone` calls `toRaw`
  before cloning, so nested reads are untracked and nested mutations
  (a ticker source set, the in-place stale flag) never invalidate the
  computed (bug: only the first source checkbox rendered its dropdown).
  Reactive consumers read `store.configs`/`store.snapshots` directly;
  the cloning getters stay for imperative one-shot reads.
- 2026-08-07: Repair Analysis day material table notes the internal
  cost of plan-sourced repair materials (user request): per sourced
  ticker the amount at the snapshot's frozen `inputPrices`, plus a
  mixed "Total at Sourced Prices" footer row (sourced tickers internal,
  rest market). Market rows/totals stay untouched, amber when stale.
- 2026-08-07: Sourcing inputs table rows are grouped (user request):
  workforce consumables → repair materials → production inputs.
  Multi-bucket tickers repeat in every matching group (user decision,
  revised from first-matching-group) showing the total need, sharing
  one source config. Within groups rows sort by daily cost at the CX
  preference price, not the effective price (user decision) — checking
  a source must not reorder rows under the cursor.
- 2026-08-07: Staleness epsilon aligned (bug: in an A↔B supply loop
  "the other plan" stayed stale forever): the chain settling epsilon
  (1e-6) and setSnapshot's materially-changed epsilon (was 1e-9) are
  now one shared exported constant `RAUKK_SNAPSHOT_EQUAL_EPSILON` =
  1e-6. A settled pass must count as materially unchanged or the final
  pass re-flags the rest of the loop.
