import { defineStore } from "pinia";
import { ref, Ref } from "vue";

// Util
import { inertClone } from "@/util/data";

// Graph
import {
	buildDependencyGraph,
	collectDependents,
} from "@/features/raukk_sourcing/raukkSourcingGraph";

// Pricing
import { snapshotMateriallyChanged } from "@/features/raukk_sourcing/raukkSourcingPricing";

// Schemas
import {
	RAUKK_SOURCING_EXPORT_VERSION,
	RaukkSourcingExportSchema,
	RaukkSourcingExportType,
} from "@/features/raukk_sourcing/raukkSourcingStore.schemas";

// Calculations
import {
	raukkCompleteShipProfile,
	raukkDefaultShippingConfig,
	raukkShipProfilePresets,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";
import { raukkPairIdentity } from "@/features/raukk_sourcing/calculations/shippingDisplay";
import { raukkDefaultChainConfig } from "@/features/raukk_sourcing/calculations/shippingChains";
import {
	IRaukkChainPairConflict,
	raukkChainPairConflict,
} from "@/features/raukk_sourcing/calculations/shippingChainValidation";
import {
	raukkAssignedShipTypeId,
	raukkChainAssignmentKey,
	raukkChainIdOfAssignmentKey,
} from "@/features/raukk_sourcing/calculations/shippingFleet";
import { raukkIsAutoChainId } from "@/features/raukk_sourcing/calculations/shippingAutoChains";
// raukk: depot ids are normalized exactly as the chain math compares them
import { raukkDepotStopKey } from "@/features/raukk_sourcing/calculations/shippingDepots";

// Types & Interfaces
import {
	IRaukkCadenceOverrides,
	IRaukkChain,
	IRaukkChainConfig,
	IRaukkChainResult,
	IRaukkDepot,
	IRaukkFleetShip,
	IRaukkLocalPrice,
	IRaukkPlanConfig,
	IRaukkShipProfile,
	IRaukkShippingConfig,
	IRaukkSnapshot,
	IRaukkTickerSource,
	RAUKK_REPAIR_DAY,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import { RAUKK_CARGO_BUCKET } from "@/features/raukk_sourcing/calculations/shipping.types";
import {
	IRaukkExportPayload,
	IRaukkProducerOption,
	IRaukkSubscription,
	IRaukkSubscriptionEntry,
} from "@/features/raukk_sourcing/raukkSourcingStore.types";

/** Repair day used until a plan configures its own */
const DEFAULT_REPAIR_DAY: RAUKK_REPAIR_DAY = 90;

/**
 * Preset ship profiles by id, built once. The store persists user
 * overrides only, so a preset the user never touched keeps following the
 * shipped calibration instead of freezing an old copy of it.
 */
const SHIP_PROFILE_PRESETS: Record<string, IRaukkShipProfile> =
	Object.fromEntries(
		raukkShipProfilePresets().map((profile) => [profile.id, profile])
	);

export const useRaukkSourcingStore = defineStore(
	"prunplanner_raukk_sourcing",
	() => {
		// state
		/** Key: Plan.uuid */
		const configs: Ref<Record<string, IRaukkPlanConfig>> = ref({});
		/** Key: Plan.uuid */
		const snapshots: Ref<Record<string, IRaukkSnapshot>> = ref({});
		/** Key: ship profile id. User overrides of the presets only. */
		const shipProfiles: Ref<Record<string, IRaukkShipProfile>> = ref({});
		/** Account global, not per plan: one fleet serves every plan */
		const shippingConfig: Ref<IRaukkShippingConfig> = ref(
			raukkDefaultShippingConfig()
		);
		/** Key: chain id. User authored multi stop loops. */
		const chains: Ref<Record<string, IRaukkChain>> = ref({});
		/** Key: chain id. Output of the account level chain pass. */
		const chainResults: Ref<Record<string, IRaukkChainResult>> = ref({});
		/** Key: ship type id, which is a ship profile id */
		const fleet: Ref<Record<string, IRaukkFleetShip>> = ref({});
		/** Key: lane pair key or chain key. Absent means auto. */
		const assignments: Ref<Record<string, string>> = ref({});
		/**
		 * Fleet page spillover display on/off. Account global like the
		 * fleet itself, and a pure DISPLAY mode: nothing recomputes and
		 * nothing goes stale when it flips.
		 */
		const fleetSpillover: Ref<boolean> = ref(true);
		/** Account global, like the shipping configuration next to it */
		const chainConfig: Ref<IRaukkChainConfig> = ref(
			raukkDefaultChainConfig()
		);
		/**
		 * raukk: planets the user hands cargo over at, keyed by their
		 * NORMALIZED natural id. Account global like the fleet — a depot is
		 * a place, not a property of any one plan — and a routing anchor
		 * only: no price, no hub, no storage.
		 */
		const depots: Ref<Record<string, IRaukkDepot>> = ref({});

		/**
		 * Resets all store variables to their initial values
		 * @author raukk
		 */
		function $reset(): void {
			configs.value = {};
			snapshots.value = {};
			shipProfiles.value = {};
			shippingConfig.value = raukkDefaultShippingConfig();
			chains.value = {};
			chainResults.value = {};
			fleet.value = {};
			assignments.value = {};
			fleetSpillover.value = true;
			chainConfig.value = raukkDefaultChainConfig();
			depots.value = {};
		}

		// getters

		/**
		 * Gets a plans sourcing configuration. Plans without a stored
		 * configuration get the default one, which is intentionally not
		 * written back to the store.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 * @returns {IRaukkPlanConfig} Sourcing Configuration
		 */
		function getConfig(planUuid: string): IRaukkPlanConfig {
			const findConfig: IRaukkPlanConfig | undefined =
				configs.value[planUuid];

			if (findConfig) return inertClone(findConfig);

			return { repairDay: DEFAULT_REPAIR_DAY, sources: {} };
		}

		/**
		 * Gets a plans snapshot, if one was computed already
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 * @returns {IRaukkSnapshot | undefined} Snapshot
		 */
		function getSnapshot(planUuid: string): IRaukkSnapshot | undefined {
			const findSnapshot: IRaukkSnapshot | undefined =
				snapshots.value[planUuid];

			return findSnapshot ? inertClone(findSnapshot) : undefined;
		}

		/**
		 * Gets a ship profile by id: the users override when one exists,
		 * the shipped preset otherwise. An unknown id degrades to the
		 * configured default profile and, should even that be gone, to
		 * the first preset — the shipping math always needs a hull.
		 * @author raukk
		 *
		 * @param {string} profileId Ship Profile Id
		 * @returns {IRaukkShipProfile} Ship Profile
		 */
		function getShipProfile(profileId: string): IRaukkShipProfile {
			const known: IRaukkShipProfile | undefined =
				shipProfiles.value[profileId] ??
				SHIP_PROFILE_PRESETS[profileId];

			// a local storage blob written before the fuel burn rates
			// existed carries a profile without them
			if (known) return raukkCompleteShipProfile(inertClone(known));

			const fallbackId: string = shippingConfig.value.defaultProfileId;

			return raukkCompleteShipProfile(
				inertClone(
					shipProfiles.value[fallbackId] ??
						SHIP_PROFILE_PRESETS[fallbackId] ??
						Object.values(SHIP_PROFILE_PRESETS)[0]
				)
			);
		}

		/**
		 * Lists every ship profile, presets with the users overrides
		 * applied on top. Backs the calibration table.
		 * @author raukk
		 *
		 * @returns {IRaukkShipProfile[]} Ship Profiles
		 */
		function listShipProfiles(): IRaukkShipProfile[] {
			return Object.keys(SHIP_PROFILE_PRESETS).map((profileId) =>
				getShipProfile(profileId)
			);
		}

		/**
		 * Lists all plans whose snapshot holds the given ticker as an
		 * output. Stale snapshots are included and flagged as such,
		 * their numbers still display in the source dropdown.
		 * @author raukk
		 *
		 * @param {string} ticker Material Ticker
		 * @returns {IRaukkProducerOption[]} Producing Plans
		 */
		function producersOf(ticker: string): IRaukkProducerOption[] {
			return Object.entries(snapshots.value)
				.filter(([, snapshot]) => snapshot.outputs[ticker])
				.map(([planUuid, snapshot]) => {
					const output = snapshot.outputs[ticker];

					return {
						planUuid,
						planName: snapshot.planName,
						planetNaturalId: snapshot.planetNaturalId,
						costPerUnit: output.costPerUnit,
						unitsPerDay: output.unitsPerDay,
						stale: snapshot.stale,
						computedAt: snapshot.computedAt,
					};
				});
		}

		/**
		 * Aggregates all draws other plans hold against one source
		 * plans output ticker. Oversubscription is allowed, the
		 * percentage can therefore exceed 1.
		 * @author raukk
		 *
		 * @param {string} sourcePlanUuid Producing Plan Uuid
		 * @param {string} ticker Material Ticker
		 * @returns {IRaukkSubscription} Subscription Information
		 */
		function subscription(
			sourcePlanUuid: string,
			ticker: string
		): IRaukkSubscription {
			const byPlan: IRaukkSubscriptionEntry[] = [];
			let totalDrawnPerDay: number = 0;

			Object.entries(snapshots.value).forEach(([planUuid, snapshot]) => {
				const amount: number | undefined =
					snapshot.draws[sourcePlanUuid]?.[ticker];

				if (amount === undefined || amount === 0) return;

				totalDrawnPerDay += amount;
				byPlan.push({ planUuid, unitsPerDay: amount });
			});

			const sourceUnitsPerDay: number =
				snapshots.value[sourcePlanUuid]?.outputs[ticker]?.unitsPerDay ??
				0;

			return {
				totalDrawnPerDay,
				byPlan,
				pctOfOutput:
					sourceUnitsPerDay > 0
						? totalDrawnPerDay / sourceUnitsPerDay
						: 0,
			};
		}

		// setters

		/**
		 * Marks a plans snapshot and, transitively, all snapshots
		 * depending on it as stale. Values stay in place, they are only
		 * flagged. Used whenever a plan is saved or its sourcing
		 * configuration changes.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 */
		function markStale(planUuid: string): void {
			const own: IRaukkSnapshot | undefined = snapshots.value[planUuid];
			if (own) own.stale = true;

			cascadeStale(planUuid);
		}

		/**
		 * Marks all snapshots transitively depending on the given plan
		 * as stale, the plan itself stays untouched.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 */
		function cascadeStale(planUuid: string): void {
			collectDependents(
				buildDependencyGraph(configs.value, snapshots.value),
				planUuid
			).forEach((dependentUuid) => {
				const dependent: IRaukkSnapshot | undefined =
					snapshots.value[dependentUuid];

				if (dependent) dependent.stale = true;
			});
		}

		/**
		 * Marks every stored snapshot AND every stored chain result stale.
		 *
		 * Shipping configuration and ship profiles are account global:
		 * changing them changes the numbers of every plan at once, so
		 * there is nothing to cascade along the dependency graph — the
		 * whole store is stale.
		 *
		 * Chain results are costed from those very inputs — the shipping
		 * configuration and the profile of the assigned ship type — so a
		 * change that stales every snapshot stales every chain with them.
		 * Leaving them fresh would let a plan keep folding freight priced
		 * with the previous profile.
		 * @author raukk
		 */
		function markAllStale(): void {
			Object.values(snapshots.value).forEach((snapshot) => {
				snapshot.stale = true;
			});

			Object.values(chainResults.value).forEach((result) => {
				result.stale = true;
			});
		}

		/**
		 * Patches the account global shipping configuration.
		 *
		 * Marks all snapshots stale, unless shipping was off before and
		 * stays off: a change that cannot move a single number must not
		 * flag the users whole empire.
		 * @author raukk
		 *
		 * @param {Partial<IRaukkShippingConfig>} patch Configuration Patch
		 */
		function setShippingConfig(patch: Partial<IRaukkShippingConfig>): void {
			const wasEnabled: boolean = shippingConfig.value.enabled;

			shippingConfig.value = {
				...shippingConfig.value,
				...inertClone(patch),
			};

			if (wasEnabled || shippingConfig.value.enabled) markAllStale();
		}

		/**
		 * Patches one ship profile, storing it as a user override of the
		 * preset. Marks all snapshots stale while shipping is enabled.
		 * @author raukk
		 *
		 * @param {string} profileId Ship Profile Id
		 * @param {Partial<IRaukkShipProfile>} patch Profile Patch
		 */
		function setShipProfile(
			profileId: string,
			patch: Partial<IRaukkShipProfile>
		): void {
			shipProfiles.value[profileId] = {
				...getShipProfile(profileId),
				...inertClone(patch),
				id: profileId,
			};

			if (shippingConfig.value.enabled) markAllStale();
		}

		/**
		 * Drops a ship profiles user override, the preset applies again.
		 * Marks all snapshots stale while shipping is enabled.
		 * @author raukk
		 *
		 * @param {string} profileId Ship Profile Id
		 */
		function resetShipProfile(profileId: string): void {
			if (shipProfiles.value[profileId] === undefined) return;

			delete shipProfiles.value[profileId];

			if (shippingConfig.value.enabled) markAllStale();
		}

		// chains, fleet and assignments

		/**
		 * Gets one chain, undefined when it does not exist.
		 * @author raukk
		 *
		 * @param {string} chainId Chain Id
		 * @returns {IRaukkChain | undefined} Chain
		 */
		function getChain(chainId: string): IRaukkChain | undefined {
			const found: IRaukkChain | undefined = chains.value[chainId];

			return found ? inertClone(found) : undefined;
		}

		/**
		 * Gets one stored chain result, undefined until the chain pass
		 * computed it.
		 * @author raukk
		 *
		 * @param {string} chainId Chain Id
		 * @returns {IRaukkChainResult | undefined} Chain Result
		 */
		function getChainResult(
			chainId: string
		): IRaukkChainResult | undefined {
			const found: IRaukkChainResult | undefined =
				chainResults.value[chainId];

			return found ? inertClone(found) : undefined;
		}

		/**
		 * Plans of a chain: every plan whose snapshot sits on one of the
		 * chains stops.
		 *
		 * Membership is DERIVED, never stored — exactly like the
		 * dependency edges of the sourcing graph. A plan without a
		 * snapshot has no planet the store knows of and is therefore no
		 * member yet.
		 * @author raukk
		 *
		 * @param {string[]} stops Ordered loop
		 * @returns {string[]} Member Plan Uuids
		 */
		function chainMemberPlans(stops: string[]): string[] {
			const stopSet: Set<string> = new Set(stops);

			return Object.entries(snapshots.value)
				.filter(([, snapshot]) => stopSet.has(snapshot.planetNaturalId))
				.map(([planUuid]) => planUuid);
		}

		/**
		 * Checks a loop against the stops the other chains already reach —
		 * two chains may share at most ONE stop, see
		 * {@link raukkChainPairConflict}. Backs the chain editors refusal
		 * before {@link setChain} throws.
		 * @author raukk
		 *
		 * @param {string} chainId Chain Id
		 * @param {string[]} stops Ordered loop
		 * @returns {IRaukkChainPairConflict | null} Conflict
		 */
		function chainConflictOf(
			chainId: string,
			stops: string[]
		): IRaukkChainPairConflict | null {
			return raukkChainPairConflict(chains.value, chainId, stops);
		}

		/**
		 * Marks one chains result stale and, with it, the snapshots of
		 * the plans that chain serves.
		 *
		 * A chain edit is NOT an account wide event: only its member
		 * plans read their freight from it, so the blunt
		 * {@link markAllStale} would flag the users whole empire for a
		 * change that cannot move a single number elsewhere. Members are
		 * taken from both the stored result and the current stops, so a
		 * plan that just left the loop is flagged as well.
		 * @author raukk
		 *
		 * @param {string} chainId Chain Id
		 * @param {string[]} extraMembers Additional member plan uuids
		 */
		function markChainStale(
			chainId: string,
			extraMembers: string[] = []
		): void {
			const result: IRaukkChainResult | undefined =
				chainResults.value[chainId];

			if (result) result.stale = true;

			const members: Set<string> = new Set([
				...(result?.memberPlanUuids ?? []),
				...extraMembers,
				...chainMemberPlans(chains.value[chainId]?.stops ?? []),
			]);

			members.forEach((planUuid) => markStale(planUuid));
		}

		/** Every chains result stale, plus the plans they serve */
		function markAllChainsStale(): void {
			Object.keys({ ...chains.value, ...chainResults.value }).forEach(
				(chainId) => markChainStale(chainId)
			);
		}

		/**
		 * Stores one chain.
		 *
		 * Two authoring rules are enforced here rather than in the editor,
		 * because the store is what everything else reads: a loop needs at
		 * least two stops, and two chains may share AT MOST ONE
		 * stop (shipping-chains-v2.md, "Flow claiming") — sharing two
		 * would let both claim the same flows, which is what replaces
		 * precedence logic between overlapping chains. Both violations
		 * throw and leave the store untouched.
		 * @author raukk
		 *
		 * @param {IRaukkChain} chain Chain
		 */
		function setChain(chain: IRaukkChain): void {
			if (chain.stops.length < 2) {
				throw new Error(
					"A chain is a loop and needs at least two stops."
				);
			}

			const conflict: IRaukkChainPairConflict | null = chainConflictOf(
				chain.chainId,
				chain.stops
			);

			if (conflict !== null) {
				throw new Error(
					`Chain '${conflict.chainId}' already reaches both ${conflict.fromStop} and ${conflict.toStop}; two chains may share at most one stop.`
				);
			}

			const previousMembers: string[] = chainMemberPlans(
				chains.value[chain.chainId]?.stops ?? []
			);

			chains.value[chain.chainId] = inertClone(chain);

			markChainStale(chain.chainId, previousMembers);
		}

		/**
		 * Removes a chain together with everything that depended on it:
		 * its stored result and its ship type assignment. The plans it
		 * served go stale, their freight is a pair matter again.
		 * @author raukk
		 *
		 * @param {string} chainId Chain Id
		 */
		function deleteChain(chainId: string): void {
			const members: string[] = [
				...(chainResults.value[chainId]?.memberPlanUuids ?? []),
				...chainMemberPlans(chains.value[chainId]?.stops ?? []),
			];

			delete chains.value[chainId];
			delete chainResults.value[chainId];
			delete assignments.value[raukkChainAssignmentKey(chainId)];

			members.forEach((planUuid) => markStale(planUuid));
		}

		/**
		 * Stores a freshly computed chain result. Member plans are NOT
		 * flagged here: the chain pass recomputes them itself, and the
		 * one round convergence lag is documented rather than fought.
		 * @author raukk
		 *
		 * @param {string} chainId Chain Id
		 * @param {IRaukkChainResult} result Chain Result
		 */
		function setChainResult(
			chainId: string,
			result: IRaukkChainResult
		): void {
			chainResults.value[chainId] = {
				...inertClone(result),
				chainId,
				stale: false,
			};
		}

		/**
		 * Replaces every DERIVED chain result with a freshly built set.
		 *
		 * Automatic chains are rebuilt from the flows on every account
		 * level chain pass and are never stored as chains, so their
		 * results are replaced wholesale rather than patched: a loop the
		 * new flows no longer justify must LOSE its result, or its stored
		 * claims would keep taking cargo off the lanes of plans that
		 * really do fly it themselves.
		 *
		 * Member plans are not flagged here, exactly as
		 * {@link setChainResult} does not flag them — the chain pass
		 * recomputes them itself and the one round convergence lag is
		 * documented rather than fought.
		 *
		 * Hull pins follow the set: an assignment naming a derived chain
		 * the new set no longer contains is dropped, or it would sit in the
		 * store forever and re-apply to whatever loop takes that id later.
		 * Derived ids state their CONTENT (`auto:<class>:<cx>:<sorted
		 * stops>`, see `raukkAutoChainId`), so a pin can only survive
		 * re-clustering when the loop it names still has exactly the same
		 * stops — it is then the same loop and the pin still means what it
		 * meant. A loop that gained or lost a stop is a NEW id, and the pin
		 * of the old one is pruned here as an orphan rather than
		 * transferring to a loop the user never pinned. Results frozen
		 * under the old positional scheme (`auto:<class>:<cx>:<n>`) are
		 * replaced wholesale by the same rule: the next pass writes content
		 * ids, the positional ones are absent from `live` and their pins go
		 * with them.
		 *
		 * `pruneAssignments` says whether the given set really IS the
		 * derived set: only a pass that computed it may prune. A purge
		 * (shipping off, failed pass) hands over an empty set it cannot
		 * vouch for and keeps the pins, so switching shipping back on
		 * restores the users hulls rather than silently unassigning them.
		 * @author raukk
		 *
		 * @param {IRaukkChainResult[]} results Derived chain results
		 * @param {boolean} pruneAssignments Drop pins of vanished chains
		 */
		function setAutoChainResults(
			results: IRaukkChainResult[],
			pruneAssignments: boolean = true
		): void {
			Object.entries(chainResults.value).forEach(([chainId, result]) => {
				if (result.auto === true) delete chainResults.value[chainId];
			});

			results.forEach((result) => {
				chainResults.value[result.chainId] = {
					...inertClone(result),
					stale: false,
					auto: true,
				};
			});

			if (!pruneAssignments) return;

			const live: Set<string> = new Set(
				results.map((result) => result.chainId)
			);

			Object.keys(assignments.value).forEach((key) => {
				const chainId: string | undefined =
					raukkChainIdOfAssignmentKey(key);

				if (chainId === undefined || !raukkIsAutoChainId(chainId))
					return;
				if (live.has(chainId)) return;

				delete assignments.value[key];
			});
		}

		/**
		 * Marks one stored chain result stale WITHOUT touching its member
		 * plans, the flag a failed chain pass leaves behind.
		 *
		 * Deliberately not {@link markChainStale}: that one stales the
		 * member plans as well, which the automatic snapshot upkeep answers
		 * with a recompute — the self feeding loop {@link cascadeChainStale}
		 * exists to avoid. A failed chain is a chain whose numbers are old,
		 * not a chain whose members changed.
		 * @author raukk
		 *
		 * @param {string} chainId Chain Id
		 */
		function markChainResultStale(chainId: string): void {
			const result: IRaukkChainResult | undefined =
				chainResults.value[chainId];

			if (result) result.stale = true;
		}

		/**
		 * Sets or clears the exchange one plan is anchored at, `undefined`
		 * falling back to the account wide anchor mode.
		 *
		 * The anchor decides which exchange a plans market cargo travels
		 * through and which REGION its base belongs to, so it moves the
		 * plans own numbers and everything downstream of it — the same
		 * staleness a source or cadence change causes.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 * @param {string | undefined} cxCode Exchange code, undefined clears
		 */
		function setPlanCxAnchor(
			planUuid: string,
			cxCode: string | undefined
		): void {
			const config: IRaukkPlanConfig = ensureConfig(planUuid);

			if (cxCode === undefined) delete config.cxAnchor;
			else config.cxAnchor = cxCode;

			markStale(planUuid);
		}

		/**
		 * Patches the account global chain configuration.
		 *
		 * Every chain is priced with these knobs, so every chain result
		 * and every plan they serve goes stale. Plans no chain touches
		 * stay untouched — unlike the shipping configuration, the chain
		 * knobs cannot move a plan that ships nothing on a chain.
		 *
		 * A non finite number is refused rather than stored: a numeric
		 * input emits `NaN` for a lone `-` or `.`, and every one of these
		 * knobs poisons something on its way through — a `NaN` minimum
		 * share disables the automatic chains outright, and the export
		 * writes `NaN` as `null`, which the users own backup then fails to
		 * re-import. The remaining fields of the patch still apply.
		 * @author raukk
		 *
		 * @param {Partial<IRaukkChainConfig>} patch Configuration Patch
		 */
		function setChainConfig(patch: Partial<IRaukkChainConfig>): void {
			const finite: Partial<IRaukkChainConfig> = Object.fromEntries(
				Object.entries(inertClone(patch)).filter(
					([, value]) =>
						typeof value !== "number" || Number.isFinite(value)
				)
			);

			chainConfig.value = {
				...chainConfig.value,
				...finite,
			};

			markAllChainsStale();
		}

		/**
		 * Sets the ship count and, optionally, the design label of one
		 * ship type.
		 *
		 * The count itself is only the read time denominator of the
		 * utilization rollup and moves no stored number — but the OWNED
		 * SET does: the automatic hull pick assigns owned types only
		 * (`raukkOwnedHullCandidates`, counts above zero with the
		 * starter fallback), so a type entering or leaving ownership —
		 * its count crossing zero in either direction, a type newly
		 * added with hulls — changes the candidate list every stored
		 * lane and chain was costed with, and everything goes stale
		 * exactly as on a profile change, while shipping is enabled. A
		 * count change on the same side of zero (2 → 3) and a design
		 * name edit stale nothing.
		 * @author raukk
		 *
		 * @param {string} shipTypeId Ship Type Id
		 * @param {Partial<IRaukkFleetShip>} patch Fleet Patch
		 */
		function setFleetShip(
			shipTypeId: string,
			patch: Partial<IRaukkFleetShip>
		): void {
			const known: IRaukkFleetShip | undefined = fleet.value[shipTypeId];
			const wasOwned: boolean = (known?.count ?? 0) > 0;

			fleet.value[shipTypeId] = {
				...(known ?? { count: 0 }),
				...inertClone(patch),
			};

			const isOwned: boolean = fleet.value[shipTypeId].count > 0;

			if (wasOwned !== isOwned && shippingConfig.value.enabled)
				markAllStale();
		}

		/**
		 * Turns the fleet pages spillover display on or off.
		 *
		 * Deliberately marks NOTHING stale, exactly like a fleet count:
		 * spillover is a way of READING the utilization rollup — no cost,
		 * no trip and no snapshot value depends on it.
		 * @author raukk
		 *
		 * @param {boolean} enabled Spillover display on
		 */
		function setFleetSpillover(enabled: boolean): void {
			fleetSpillover.value = enabled;
		}

		/**
		 * Marks one planet as a DEPOT, or patches the depot it already is.
		 *
		 * A depot is a routing anchor: chains may be cut at it exactly as
		 * they are cut at an exchange, so every chain result is computed
		 * with different anchors from here on and goes stale. It is NOT a
		 * market — nothing is priced, sourced or stored there — so nothing
		 * outside the chains moves.
		 *
		 * A non finite weekly rent is refused rather than stored, the rule
		 * every numeric knob of this store follows: `NaN` travels into the
		 * export, where JSON writes it as `null`, and the users own backup
		 * then fails to re-import.
		 * @author raukk
		 *
		 * @param {string} planetNaturalId Planet Natural Id
		 * @param {Partial<IRaukkDepot>} patch Depot Patch
		 */
		function setDepot(
			planetNaturalId: string,
			patch: Partial<IRaukkDepot> = {}
		): void {
			const key: string = raukkDepotStopKey(planetNaturalId);
			if (key === "") return;

			const known: IRaukkDepot | undefined = depots.value[key];

			const weeklyCostAic: number | undefined =
				patch.weeklyCostAic ?? known?.weeklyCostAic;

			depots.value[key] = {
				// keyed normalized, displayed as the user typed it: planet
				// ids read `ZV-307c`, and only the comparison is case blind
				planetNaturalId:
					known?.planetNaturalId ?? planetNaturalId.trim(),
				weeklyCostAic:
					weeklyCostAic !== undefined &&
					Number.isFinite(weeklyCostAic) &&
					weeklyCostAic > 0
						? weeklyCostAic
						: undefined,
			};

			markAllChainsStale();
		}

		/**
		 * Un-marks one planet as a depot. Chains keep their stops — the
		 * planet is still a place a ship may fly to — they only lose it as
		 * a split anchor, which is why they go stale.
		 * @author raukk
		 *
		 * @param {string} planetNaturalId Planet Natural Id
		 */
		function deleteDepot(planetNaturalId: string): void {
			const key: string = raukkDepotStopKey(planetNaturalId);

			if (depots.value[key] === undefined) return;

			delete depots.value[key];

			markAllChainsStale();
		}

		/**
		 * Planet natural ids of every marked depot, the anchor list the
		 * chain math takes.
		 * @author raukk
		 *
		 * @returns {string[]} Depot Planet Natural Ids
		 */
		function depotStopRefs(): string[] {
			return Object.values(depots.value).map(
				(depot) => depot.planetNaturalId
			);
		}

		/**
		 * Removes one ship type from the fleet, and with it its fleet
		 * table row: rows come from the fleet slice alone. Assignments
		 * naming the type stay — removing a hull is not un-assigning the
		 * work — the type is simply no longer one the account owns, and
		 * a hull nobody owns surfaces as an advisory, not as a row.
		 *
		 * Deleting a type the fleet actually OWNED (count above zero)
		 * removes it from the automatic hull picks candidate list, so
		 * everything goes stale exactly as on a count crossing zero
		 * (see {@link setFleetShip}), while shipping is enabled.
		 * Deleting a hull-less row changes no candidate and stales
		 * nothing.
		 * @author raukk
		 *
		 * @param {string} shipTypeId Ship Type Id
		 */
		function deleteFleetShip(shipTypeId: string): void {
			const wasOwned: boolean =
				(fleet.value[shipTypeId]?.count ?? 0) > 0;

			delete fleet.value[shipTypeId];

			if (wasOwned && shippingConfig.value.enabled) markAllStale();
		}

		/**
		 * Assigns a ship type to one lane or chain, `undefined` puts it
		 * back to auto.
		 *
		 * An assignment changes the PROFILE a lane or chain is flown
		 * with, so unlike a fleet count it does move numbers: the owning
		 * plan of a lane goes stale with its dependents, a chain goes
		 * stale with the plans it serves.
		 * @author raukk
		 *
		 * @param {string} key Lane pair key or chain key
		 * @param {string | undefined} shipTypeId Ship Type Id
		 */
		function setAssignment(
			key: string,
			shipTypeId: string | undefined
		): void {
			if (shipTypeId === undefined) delete assignments.value[key];
			else assignments.value[key] = shipTypeId;

			const chainId: string | undefined =
				raukkChainIdOfAssignmentKey(key);

			if (chainId !== undefined) {
				markChainStale(chainId);
				return;
			}

			markStale(raukkPairIdentity(key).planUuid);
		}

		/**
		 * Ship type serving one lane or chain: the assignment, the v1 per
		 * edge override, or the account default.
		 * @author raukk
		 *
		 * @param {string} key Lane pair key or chain key
		 * @returns {string} Ship Type Id
		 */
		function assignedShipTypeId(key: string): string {
			return raukkAssignedShipTypeId(
				key,
				assignments.value,
				shippingConfig.value
			);
		}

		/**
		 * Ensures a plan has a stored configuration and returns the
		 * reactive, stored instance
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 * @returns {IRaukkPlanConfig} Stored Configuration
		 */
		function ensureConfig(planUuid: string): IRaukkPlanConfig {
			if (!configs.value[planUuid])
				configs.value[planUuid] = {
					repairDay: DEFAULT_REPAIR_DAY,
					sources: {},
				};

			return configs.value[planUuid];
		}

		/**
		 * Sets the source of a single ticker of a plan. Changing the
		 * sourcing configuration marks the plans own snapshot and all
		 * downstream snapshots stale.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 * @param {string} ticker Material Ticker
		 * @param {IRaukkTickerSource} source Ticker Source
		 */
		function setTickerSource(
			planUuid: string,
			ticker: string,
			source: IRaukkTickerSource
		): void {
			ensureConfig(planUuid).sources[ticker] = inertClone(source);
			markStale(planUuid);
		}

		/**
		 * Removes a tickers source of a plan, it falls back to market
		 * pricing. Marks the plan and all downstream plans stale.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 * @param {string} ticker Material Ticker
		 */
		function clearTickerSource(planUuid: string, ticker: string): void {
			const findConfig: IRaukkPlanConfig | undefined =
				configs.value[planUuid];

			if (!findConfig || findConfig.sources[ticker] === undefined) return;

			delete findConfig.sources[ticker];
			markStale(planUuid);
		}

		/**
		 * Flags one OUTPUT ticker of a plan as sold on the local market of
		 * its own planet, at the given ad price. The excess of that ticker
		 * stops travelling to the exchange, which moves the plans own
		 * numbers and everything downstream of it — the same staleness a
		 * source change causes.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 * @param {string} ticker Output Material Ticker
		 * @param {IRaukkLocalPrice} price Local Market Ad Price
		 */
		function setLocalSale(
			planUuid: string,
			ticker: string,
			price: IRaukkLocalPrice
		): void {
			const config: IRaukkPlanConfig = ensureConfig(planUuid);

			config.localSales = {
				...config.localSales,
				[ticker]: inertClone(price),
			};

			markStale(planUuid);
		}

		/**
		 * Removes a local market sale flag, the ticker sells at the
		 * exchange again. Marks the plan and all downstream plans stale.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 * @param {string} ticker Output Material Ticker
		 */
		function clearLocalSale(planUuid: string, ticker: string): void {
			const findConfig: IRaukkPlanConfig | undefined =
				configs.value[planUuid];

			if (!findConfig || findConfig.localSales?.[ticker] === undefined)
				return;

			delete findConfig.localSales[ticker];
			markStale(planUuid);
		}

		/**
		 * Sets or clears one cadence override of a plan, days per visit
		 * of one cargo bucket. `undefined` drops the override and the
		 * account default applies again.
		 *
		 * Cadence drives the trip count of every leg this plan consumes
		 * on, so the plan and everything downstream of it go stale —
		 * exactly like a source or repair day change. Non positive day
		 * counts are refused rather than stored: a cap of zero would mean
		 * "visit infinitely often". `NaN` is refused with them — a numeric
		 * input emits it for a lone `-` or `.`, it compares false against
		 * every bound, and it would travel all the way into the export,
		 * where JSON writes it as `null` and the users own backup no longer
		 * re-imports.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 * @param {RAUKK_CARGO_BUCKET} bucket Cargo Bucket
		 * @param {number | undefined} days Days per visit, undefined clears
		 */
		function setPlanCadence(
			planUuid: string,
			bucket: RAUKK_CARGO_BUCKET,
			days: number | undefined
		): void {
			const config: IRaukkPlanConfig = ensureConfig(planUuid);
			const cadence: IRaukkCadenceOverrides = { ...config.cadence };

			if (days === undefined || !Number.isFinite(days) || days <= 0)
				delete cadence[bucket];
			else cadence[bucket] = days;

			config.cadence = cadence;

			markStale(planUuid);
		}

		/**
		 * Sets the repair day of a plans cost model. Marks the plan and
		 * all downstream plans stale.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 * @param {RAUKK_REPAIR_DAY} day Repair Day
		 */
		function setRepairDay(planUuid: string, day: RAUKK_REPAIR_DAY): void {
			ensureConfig(planUuid).repairDay = day;
			markStale(planUuid);
		}

		/**
		 * Stores a freshly computed snapshot of a plan. The snapshot
		 * itself is stored as current; every plan transitively
		 * depending on it is marked stale, but only when the numbers
		 * downstream plans consume actually changed — the automatic
		 * snapshot upkeep recomputes on every plan view load, an
		 * unchanged result must not flag the whole chain stale.
		 *
		 * A chain is costed from the frozen FLOWS of its member plans, a
		 * value no downstream plan consumes and `snapshotMateriallyChanged`
		 * therefore ignores. Changed flows flag the chain results the plan
		 * feeds instead — the automatic snapshot upkeep writes snapshots
		 * without ever running the chain pass of `useRaukkChainRecompute`,
		 * and a silently outdated chain result is exactly what it would
		 * leave behind otherwise.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 * @param {IRaukkSnapshot} snapshot Snapshot Data
		 */
		function setSnapshot(planUuid: string, snapshot: IRaukkSnapshot): void {
			const previous: IRaukkSnapshot | undefined =
				snapshots.value[planUuid];

			snapshots.value[planUuid] = {
				...inertClone(snapshot),
				stale: false,
			};

			// dependents derive from the new draws as well
			if (!previous || snapshotMateriallyChanged(previous, snapshot))
				cascadeStale(planUuid);

			if (
				JSON.stringify(previous?.flows ?? null) !==
				JSON.stringify(snapshot.flows ?? null)
			)
				cascadeChainStale(planUuid);
		}

		/**
		 * Flags every chain result the given plan feeds as stale.
		 *
		 * Deliberately does NOT go through {@link markChainStale}: that one
		 * stales the member PLANS as well, which the automatic snapshot
		 * upkeep would answer with another recompute, which would call
		 * this again — a self feeding loop. The chain result flag alone is
		 * what the chain page renders and what tells the user a chain
		 * recompute is due; the plans themselves are already current.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 */
		function cascadeChainStale(planUuid: string): void {
			Object.entries(chainResults.value).forEach(([chainId, result]) => {
				const members: Set<string> = new Set([
					...result.memberPlanUuids,
					...chainMemberPlans(chains.value[chainId]?.stops ?? []),
				]);

				if (members.has(planUuid)) result.stale = true;
			});
		}

		/**
		 * Drops every shipping configuration entry keyed by a pair the
		 * given plan takes part in.
		 *
		 * Pair keys are `owner>counterpart`, so a deleted plan appears in
		 * BOTH shapes: `<uuid>>CX` as the owner of its exchange pair and
		 * `<consumer>><uuid>` as the source of somebody elses sourcing
		 * pair. Leaving either behind would silently re-apply a hired
		 * rate or a profile override to a future plan whose uuid happens
		 * to collide, and grows the persisted blob forever.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 */
		function scrubShippingKeys(planUuid: string): void {
			function scrub<T>(
				entries: Record<string, T> | undefined
			): Record<string, T> | undefined {
				if (entries === undefined) return undefined;

				const kept: Record<string, T> = {};

				Object.entries(entries).forEach(([pairKey, value]) => {
					const identity = raukkPairIdentity(pairKey);

					if (
						identity.planUuid === planUuid ||
						identity.sourcePlanUuid === planUuid
					)
						return;

					kept[pairKey] = value;
				});

				return kept;
			}

			shippingConfig.value = {
				...shippingConfig.value,
				lmRates: scrub(shippingConfig.value.lmRates),
				perEdgeProfile: scrub(shippingConfig.value.perEdgeProfile),
			};

			// chain keys are prefixed, never `owner>counterpart`, so the
			// same scrub leaves every chain assignment in place
			assignments.value = scrub(assignments.value) ?? {};
		}

		/**
		 * Removes configuration and snapshot of a plan, e.g. after the
		 * plan itself was deleted, and marks all plans that depended on
		 * it stale. The account global shipping configuration is scrubbed
		 * of the pairs that plan was part of, see
		 * {@link scrubShippingKeys}.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 */
		function deletePlanData(planUuid: string): void {
			const dependents: string[] = collectDependents(
				buildDependencyGraph(configs.value, snapshots.value),
				planUuid
			);

			// a chain the plan was a member of loses its flows and has to
			// be recomputed; the chain itself stays, its stops are
			// planets and outlive any single plan
			Object.values(chainResults.value).forEach((result) => {
				if (result.memberPlanUuids.includes(planUuid))
					result.stale = true;
			});

			delete configs.value[planUuid];
			delete snapshots.value[planUuid];

			scrubShippingKeys(planUuid);

			dependents.forEach((dependentUuid) => {
				const dependent: IRaukkSnapshot | undefined =
					snapshots.value[dependentUuid];

				if (dependent) dependent.stale = true;
			});
		}

		// import & export

		/**
		 * Serializes the complete sourcing state, local storage is
		 * fragile and this is the users backup path.
		 * @author raukk
		 *
		 * @returns {string} JSON Payload
		 */
		function exportJSON(): string {
			const payload: IRaukkExportPayload = {
				version: RAUKK_SOURCING_EXPORT_VERSION,
				configs: inertClone(configs.value),
				snapshots: inertClone(snapshots.value),
				shipProfiles: inertClone(shipProfiles.value),
				shippingConfig: inertClone(shippingConfig.value),
				chains: inertClone(chains.value),
				chainResults: inertClone(chainResults.value),
				fleet: inertClone(fleet.value),
				assignments: inertClone(assignments.value),
				fleetSpillover: fleetSpillover.value,
				chainConfig: inertClone(chainConfig.value),
				depots: inertClone(depots.value),
			};

			return JSON.stringify(payload);
		}

		/**
		 * Replaces the complete sourcing state with a previously
		 * exported payload. The payload is zod validated, invalid input
		 * throws and leaves the current state untouched.
		 * @author raukk
		 *
		 * @param {string} raw JSON Payload
		 */
		function importJSON(raw: string): void {
			let parsed: unknown;

			try {
				parsed = JSON.parse(raw);
			} catch {
				throw new Error(
					"Can't import sourcing data: payload is no valid JSON."
				);
			}

			const validated: RaukkSourcingExportType =
				RaukkSourcingExportSchema.parse(parsed);

			configs.value = validated.configs;
			snapshots.value = validated.snapshots;
			// absent in a v1 payload, the schema defaults both; a payload
			// predating the fuel burn rates has them filled from the
			// preset of its own hull instead of burning nothing
			shipProfiles.value = Object.fromEntries(
				Object.entries(validated.shipProfiles).map(
					([profileId, profile]) => [
						profileId,
						raukkCompleteShipProfile(profile),
					]
				)
			);
			shippingConfig.value = validated.shippingConfig;
			// absent in a v1 AND in a v2.0 payload, the schema defaults
			// all five into the empty, chainless state
			chains.value = validated.chains;
			chainResults.value = validated.chainResults;
			fleet.value = validated.fleet;
			assignments.value = validated.assignments;
			// raukk: absent in every payload written before the spillover
			// display existed, the schema defaults it off
			fleetSpillover.value = validated.fleetSpillover;
			chainConfig.value = validated.chainConfig;
			// raukk: absent in every payload written before depots existed
			depots.value = validated.depots;
		}

		return {
			// state
			configs,
			snapshots,
			shipProfiles,
			shippingConfig,
			chains,
			chainResults,
			fleet,
			assignments,
			fleetSpillover,
			chainConfig,
			depots,
			// reset
			$reset,
			// getters
			getConfig,
			getSnapshot,
			getShipProfile,
			listShipProfiles,
			producersOf,
			subscription,
			getChain,
			getChainResult,
			chainMemberPlans,
			chainConflictOf,
			assignedShipTypeId,
			depotStopRefs,
			// setters
			setTickerSource,
			clearTickerSource,
			setLocalSale,
			clearLocalSale,
			setRepairDay,
			setPlanCadence,
			setSnapshot,
			setShippingConfig,
			setShipProfile,
			resetShipProfile,
			markStale,
			markAllStale,
			deletePlanData,
			setChain,
			deleteChain,
			setChainResult,
			setAutoChainResults,
			setPlanCxAnchor,
			markChainStale,
			markChainResultStale,
			markAllChainsStale,
			setChainConfig,
			setFleetShip,
			deleteFleetShip,
			setFleetSpillover,
			setDepot,
			deleteDepot,
			setAssignment,
			// import & export
			exportJSON,
			importJSON,
		};
	},
	{
		persist: {
			// refs missing from this list silently never persist
			pick: [
				"configs",
				"snapshots",
				"shipProfiles",
				"shippingConfig",
				"chains",
				"chainResults",
				"fleet",
				"assignments",
				"fleetSpillover",
				"chainConfig",
				"depots",
			],
		},
	}
);
