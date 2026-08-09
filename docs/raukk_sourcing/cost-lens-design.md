# Cost Lens — product cost breakdown report (design, 2026-08-09)

Feature: a report that answers "where do the external (non-internal)
costs of one final product come from," with drill-down through the
whole sourcing pipeline to base parts — e.g. spotting that a repair
material is not self-sufficient and part of it is silently bought at
CX.

Interactive mockup (illustrative numbers, real interactions):
`docs/raukk_sourcing/cost-lens-mockup.html` — open directly in a
browser; self-contained, no build step.

## User decisions

1. **Traversal follows the actual sourcing chain** (raukk_sourcing
   snapshots), not the theoretical recipe tree. A `plan`-sourced
   input expands into that plan's own cost breakdown, recursively,
   until it bottoms out at external leaves.
2. **External = anything with a real ȼ cost not produced by our
   bases**: market-bought inputs, CX-bought workforce consumables,
   bought repair materials, commissioned shipping, production fees.
   Internally produced consumables/repair mats chain through the
   sourcing graph like any other input.
3. **Marginal shortfall pricing**: when empire consumption of a
   material exceeds internal production, the covered share is priced
   at true cost and the excess at CX — and the two are SPLIT into
   separate rows ("BSE" vs "BSE · CX top-up") so CX money is never
   blended with internal cost in one number. Internal/CX share of
   cost is value-weighted: `coverage×ownCost` vs `(1−coverage)×cx`.
4. **Multi-output recipes**: value-weighted allocation, consistent
   with the existing raukk net-output weighting (only one such recipe
   exists in game; no config knob).
5. **Cycles** (H2O → RAT → H2O): cut at the repeat. The repeated node
   renders greyed/dashed with a ↺ badge, not drillable, using the
   converged snapshot cost; tooltip explains this in one sentence.
6. **Views**: multiple representations over the same tree, toggled by
   tabs — no single-view dogma. v1 tab set: Blocks (zoomable icicle),
   Flow (sankey ribbons, per-column merge of repeated materials),
   plus the always-visible Pareto panel and tree table.
7. **Backing out must be obvious**: ← Back button (one level),
   clickable proportional breadcrumbs (any level), Esc (clears trace
   first, then steps back).
8. **Scope**: any produced item of any plan — fuel, crops, rations,
   ship parts. Same ticker on two planets = two different reports
   (anchored to a plan+output, not a ticker).

## Layout

- Header strip: cost/unit, output/day, "% ends up external", top
  external driver (click = trace it), one generated verdict sentence,
  price-basis + snapshot-age line.
- Composition panel (Blocks/Flow tabs) beside "Where the money goes"
  (Pareto of external leaves aggregated per material across the whole
  tree, cumulative %, click-to-trace).
- Tree table below: exact ȼ/unit, % of total, share bar, ȼ/day,
  source, vs-market delta, flags (self-supplied %, CX top-up %, ↺).
  CSV export.
- One shared selection model: clicking a material anywhere highlights
  it everywhere (others dim to ~30%).

## Invariants (from the min-maxer review — non-negotiable)

- **Reconciliation is visible**: Σ external leaves + Σ cycle
  snapshots = root cost/unit = header, shown with a tie-out line and
  the Δ. One unexplained cent kills trust.
- **All ȼ stay per 1 unit of the ROOT product at every zoom level**;
  a pinned context line restates it on each drill-in.
- **vs-market delta on every internal node** (own cost vs CX at the
  configured basis) — the "should this branch exist?" answer.
- Every price/snapshot carries its basis and as-of time.

## Visualization decisions (from the dataviz review)

- Icicle over sunburst/circle-packing/treemap: aligned lengths are
  the only truthful part-to-whole encoding at this depth; packing
  wastes 20–35% of area on gaps and lies about shares. The DAG-ness
  (shared materials) is recovered via the Pareto cross-highlight and
  the Flow tab, not by a merged sankey drill-down.
- Hue = category (inputs/workforce/repair/shipping/fees), fill =
  internal (tinted + edge stripe, opens) vs external (solid), dashed
  = cycle. Palette validated for CVD in light AND dark (see mockup
  tokens); category identity never carried by color alone (legend
  shows the composite encoding, table always available).
- Slivers < ~1.5% roll into a zoomable "· n more" block. No minimum
  widths on real segments, no log scales — zooming IS the log scale.
- Depth window of ~4 levels per root; when a traced material exists
  below the cutoff, the ancestor gets a dashed indicator strip.

## Implementation mapping (next step, not in this PR)

- Cost engine already exists: `src/features/raukk_sourcing/`
  snapshots (`IRaukkOutputCost.breakdown`), price resolver
  (`mode:"plan"` pulls source-plan costPerUnit), repair curve,
  `baseFraction.ts` recursion, `cascadeStale`.
- New: a tree-builder that walks a root plan+output through the
  sources map with a visited-set (cycle cut), emitting the
  split-by-coverage nodes; three renderers over that tree; a shared
  selection store. Likely `src/features/cost_lens/`.
- Marginal CX-top-up pricing changes reported numbers → lands in the
  true-cost calc with its own tests, separately from the report UI.
- Production fees: pending the separate fees investigation; modeled
  as an unavoidable external leaf category.

## Open items

- Empire-wide coverage computation (production vs consumption per
  ticker) to drive the top-up split.
- Snapshot staleness surfacing ("oldest input: N h") + a
  recompute-all action.
- Whether the Flow tab earns its keep after real use.
