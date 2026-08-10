# Empire oversubscription report — residue

Behaviour lives in `src/features/raukk_sourcing/calculations/oversubReport.ts`, `calculations/oversubReport.types.ts`, `calculations/oversubDisplay.ts`, `calculations/raukkVizPalette.ts`, `useRaukkOversubReport.ts` and `components/RaukkOversubReportSection.vue` (tabs under `components/oversub/`); their JSDoc and the `oversub_report.*` group of `src/locales/en_US/raukk_sourcing.json` are authoritative, every constant and equation is in `facts/oversubscription-report.json`.

## Rejected alternatives

| rejected | why | empty grep |
| --- | --- | --- |
| Chart.js / vue-chartjs, already a dependency | no honest overflow-bullet, ribbon or matrix form; every tab is hand-rolled SVG/CSS, zero new deps | `grep -i chart src/features/raukk_sourcing/` — only font and tooltip asides |
| `IRaukkFleetUtilization.keys` as the fleet segment source | deduped key strings, no per-key minutes; segments come from the per-entry load list instead | `grep IRaukkFleetUtilization .../calculations/oversubReport.ts` — 0 |
| `var()` inside SVG presentation attributes | browser support not worth the risk; attributes bind the TS constants, `<style>` blocks read the CSS vars | `grep -i "presentation attribute\|browser risk" src/features/raukk_sourcing/` — 0 |
| a second copy of the report on ShippingView | `RaukkFleetSection` already flags `over` there; the report links to `/shipping` instead | `grep -i oversub src/views/ShippingView.vue` — 0 |

## Anti-pattern abandoned

Per-tab alpha curves: Beeswarm and Bubbles each carried their own, so one reading rendered at three intensities; collapsed into `raukkOversubBlueRamp` as the only utilization ramp. `grep -i "alpha curve" src/features/raukk_sourcing/` — 0.

## Designed, not built

| item | state | drift |
| --- | --- | --- |
| fleet `external` segment — out-of-empire ship-time claims collapsing into one gray aggregate | fleet rows emit only `plan` and `chain` | OVR-2 |
| CVD / contrast palette validation script, specified with the viz scaffolding | `grep -i "cvd\|contrast\|validate" package.json scripts/` — 0 | OVR-4 |

## Unresolved

- Default tab ships as `"table"`, the safest landing; the visualization pass recommended Ledger — flip if preferred after first use. `grep -i "recommend\|default tab" src/features/raukk_sourcing/components/RaukkOversubReportSection.vue` — 0.
- Fleet group is labelled "account-wide" in copy but built from `scopedSnapshots()`; copy and scope disagree — see OVR-3.

## Constraints the code obeys but cannot explain

- Read-only v1: no draw or config editing from the report, rows only navigate. `grep -i "read.only" src/features/raukk_sourcing/components/oversub/ .../RaukkOversubReportSection.vue .../RaukkOversubTable.vue` — 0 relevant (one unrelated hit about the star-map data file).
- Scope provenance: `empirePlanUuids` are EmpireView's `planData` uuids, which come from empire junction membership — `ManagePlanEmpireAssignments.vue` → `EmpireJunctionSchema` → query `GetEmpirePlans`. `grep -i "junction\|GetEmpirePlans\|empire assignment" src/features/raukk_sourcing/` — 0.
