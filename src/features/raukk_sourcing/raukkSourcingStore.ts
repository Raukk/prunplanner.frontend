import { defineStore } from "pinia";
import { ref, Ref } from "vue";

// Util
import { inertClone } from "@/util/data";

// Graph
import {
	buildDependencyGraph,
	collectDependents,
	wouldCreateCycleInGraph,
} from "@/features/raukk_sourcing/raukkSourcingGraph";

// Schemas
import {
	RAUKK_SOURCING_EXPORT_VERSION,
	RaukkSourcingExportSchema,
	RaukkSourcingExportType,
} from "@/features/raukk_sourcing/raukkSourcingStore.schemas";

// Calculations
import {
	raukkDefaultShippingConfig,
	raukkShipProfilePresets,
} from "@/features/raukk_sourcing/calculations/shippingProfiles";

// Types & Interfaces
import {
	IRaukkPlanConfig,
	IRaukkShipProfile,
	IRaukkShippingConfig,
	IRaukkSnapshot,
	IRaukkTickerSource,
	RAUKK_REPAIR_DAY,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import {
	IRaukkEdgeCandidate,
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

		/**
		 * Resets all store variables to their initial values
		 * @author raukk
		 */
		function $reset(): void {
			configs.value = {};
			snapshots.value = {};
			shipProfiles.value = {};
			shippingConfig.value = raukkDefaultShippingConfig();
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

			if (known) return inertClone(known);

			const fallbackId: string = shippingConfig.value.defaultProfileId;

			return inertClone(
				shipProfiles.value[fallbackId] ??
					SHIP_PROFILE_PRESETS[fallbackId] ??
					Object.values(SHIP_PROFILE_PRESETS)[0]
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

		/**
		 * Checks if sourcing a ticker from the given candidate would
		 * close a loop in the stored dependency graph. Backs the source
		 * dropdowns greying out of invalid options.
		 * @author raukk
		 *
		 * @param {string} consumerPlanUuid Consuming Plan Uuid
		 * @param {IRaukkEdgeCandidate} candidate Candidate Source
		 * @returns {boolean} Edge would create a supply loop
		 */
		function wouldCreateCycle(
			consumerPlanUuid: string,
			candidate: IRaukkEdgeCandidate
		): boolean {
			return wouldCreateCycleInGraph(
				configs.value,
				snapshots.value,
				consumerPlanUuid,
				candidate
			);
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
		 * Marks every stored snapshot stale.
		 *
		 * Shipping configuration and ship profiles are account global:
		 * changing them changes the numbers of every plan at once, so
		 * there is nothing to cascade along the dependency graph — the
		 * whole store is stale.
		 * @author raukk
		 */
		function markAllStale(): void {
			Object.values(snapshots.value).forEach((snapshot) => {
				snapshot.stale = true;
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
		 * itself is stored as current, every plan transitively
		 * depending on it is marked stale as its numbers were derived
		 * from the previous values.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 * @param {IRaukkSnapshot} snapshot Snapshot Data
		 */
		function setSnapshot(planUuid: string, snapshot: IRaukkSnapshot): void {
			snapshots.value[planUuid] = {
				...inertClone(snapshot),
				stale: false,
			};

			// dependents derive from the new draws as well
			cascadeStale(planUuid);
		}

		/**
		 * Removes configuration and snapshot of a plan, e.g. after the
		 * plan itself was deleted, and marks all plans that depended on
		 * it stale.
		 * @author raukk
		 *
		 * @param {string} planUuid Plan Uuid
		 */
		function deletePlanData(planUuid: string): void {
			const dependents: string[] = collectDependents(
				buildDependencyGraph(configs.value, snapshots.value),
				planUuid
			);

			delete configs.value[planUuid];
			delete snapshots.value[planUuid];

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
			// absent in a v1 payload, the schema defaults both
			shipProfiles.value = validated.shipProfiles;
			shippingConfig.value = validated.shippingConfig;
		}

		return {
			// state
			configs,
			snapshots,
			shipProfiles,
			shippingConfig,
			// reset
			$reset,
			// getters
			getConfig,
			getSnapshot,
			getShipProfile,
			listShipProfiles,
			producersOf,
			subscription,
			wouldCreateCycle,
			// setters
			setTickerSource,
			clearTickerSource,
			setRepairDay,
			setSnapshot,
			setShippingConfig,
			setShipProfile,
			resetShipProfile,
			markStale,
			markAllStale,
			deletePlanData,
			// import & export
			exportJSON,
			importJSON,
		};
	},
	{
		persist: {
			// refs missing from this list silently never persist
			pick: ["configs", "snapshots", "shipProfiles", "shippingConfig"],
		},
	}
);
