# Cost Lens — design (2026-08-09)

UNBUILT at 4a8cc31: no `cost_lens`/`costLens` identifier, component, route or i18n key in `src`. Sole artifact is the self-contained mockup `docs/raukk_sourcing/cost-lens-mockup.html`; constants and equations live in `facts/cost-lens-design.json`, not repeated here.

Answers: where the external (non-internal) ȼ of one product comes from, drilled to base parts — e.g. a repair material silently part-bought at CX.

## Scope, traversal

- Anchor plan+output, never ticker; same ticker on two planets → two reports.
- Any produced item: fuel, crops, rations, ship parts.
- Walk the actual raukk_sourcing chain, NOT the theoretical recipe tree.
- `mode:"plan"` input expands recursively into that plan's own breakdown, down to external leaves.
- External = real ȼ not produced by our bases: market inputs, CX workforce consumables, bought repair mats, commissioned shipping, production fees.
- Internally produced consumables/repair mats chain like any other input.
- Cycle (H2O→RAT→H2O) cut at the repeat; repeat node greyed/dashed + ↺, not drillable, converged snapshot cost, one-sentence tooltip.

## Pricing

- Marginal shortfall: empire consumption above internal production priced at CX, covered share at true cost.
- Split into two rows ("BSE" vs "BSE · CX top-up") — CX money never blended into one number. Shipped code contradicts this; drift LENS-2.
- Multi-output recipe: value-weighted allocation, matching existing raukk net-output weighting. No config knob.

## Layout

Mockup carries the visual spec (header strip, Blocks/Flow tabs, "Where the money goes", tree-table columns, CSV, ← Back, breadcrumbs, dim-on-select, legend, self-supplied and CX top-up flags). Rules it does not carry:

- Header also states price basis and snapshot age.
- Pareto aggregates external leaves per material across the WHOLE tree, cumulative %, click-to-trace.
- Tabs are representations over one shared tree — no single-view dogma.
- Flow tab merges repeated materials per column.
- ONE shared selection model across all views, not per-view.
- Breadcrumbs proportional, clickable at any level; ← Back one level; Esc clears the trace first, then steps back.

## Invariants (min-maxer review, non-negotiable)

- Reconciliation visible: tie-out line plus the Δ. One unexplained cent kills trust.
- Every ȼ normalized to the root product at every zoom level; pinned context line restates it on each drill-in.
- vs-market delta on every internal node (own cost vs CX at configured basis) — the "should this branch exist?" answer.
- Every price and snapshot carries its basis and as-of time.

## Visualization (dataviz review)

| chosen | rejected | ground |
| --- | --- | --- |
| icicle | sunburst, circle packing, treemap | aligned lengths are the only truthful part-to-whole encoding at this depth; packing wastes area on gaps, lies about shares |
| Pareto cross-highlight + Flow tab | merged sankey drill-down | recovers DAG-ness (shared materials) without faking the drill path |
| zooming | log scale, minimum widths on real segments | zooming IS the log scale |

- Hue = category (inputs/workforce/repair/shipping/fees); fill = internal (tinted + edge stripe, opens) vs external (solid); dashed = cycle.
- Palette CVD-validated in light AND dark. Category never carried by color alone — legend shows the composite encoding, table always available.
- Slivers roll into a zoomable "· n more" block.
- Depth window per root; a traced material below the cutoff marks its ancestor with a dashed strip.

## To build

- Reuse `src/features/raukk_sourcing/`: snapshots, price resolver, repair curve, `calculations/baseFraction.ts`, `cascadeStale`.
- New: tree-builder walking plan+output through the sources map with a visited-set (cycle cut), emitting split-by-coverage nodes; three renderers over that tree; shared selection store. Likely `src/features/cost_lens/`.
- CX-top-up pricing changes reported numbers → lands in the true-cost calc with its own tests, separate from the report UI.
- Production fees: pending the separate fees investigation (no such doc exists — drift LENS-8); modeled as an unavoidable external leaf category.

## Open

- Empire-wide coverage per ticker (production vs consumption) to drive the top-up split.
- Snapshot staleness surfacing ("oldest input: N h") + a recompute-all action.
- Whether the Flow tab earns its keep after real use.
