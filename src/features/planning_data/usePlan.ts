import { useQuery } from "@/lib/query_cache/useQuery";
import { useQueryStore } from "@/lib/query_cache/queryStore";
import { toCacheKey } from "@/lib/query_cache/cacheKeys";

import { usePlanningStore } from "@/stores/planningStore";

// Types & Interfaces
import {
	IPlanCreateData,
	IPlanRouteParams,
	IPlanSaveCreateResponse,
} from "@/features/planning_data/usePlan.types";
import { PLANET_COGCPROGRAM_TYPE } from "@/features/api/gameData.types";
import { IPlan, PLAN_COGCPROGRAM_TYPE } from "@/stores/planningStore.types";

/**
 * The editable content of a plan, the only part a fingerprint reads.
 * Stated structurally so a stored plan and a SAVE PAYLOAD — the same
 * content on its way to the backend — fingerprint through one function.
 */
export type IPlanContent = Pick<
	IPlan,
	| "plan_name"
	| "planet_natural_id"
	| "plan_permits_used"
	| "plan_corphq"
	| "plan_cogc"
	| "plan_data"
>;

/**
 * Stable fingerprint of a plans editable content. Deliberately excludes
 * `uuid` and `empires`: those differ between the plan, plan list and
 * empire plan endpoints without the plan itself having changed.
 *
 * @author jplacht
 *
 * @param {IPlanContent} plan Plan Data
 * @returns {string} Fingerprint of the editable content
 */
export function planContentFingerprint(plan: IPlanContent): string {
	return toCacheKey({
		plan_name: plan.plan_name ?? "",
		planet_natural_id: plan.planet_natural_id,
		plan_permits_used: plan.plan_permits_used,
		plan_corphq: plan.plan_corphq,
		plan_cogc: plan.plan_cogc,
		plan_data: plan.plan_data,
	});
}

const cogcValues: string[] = [
	"---",
	"AGRICULTURE",
	"CHEMISTRY",
	"CONSTRUCTION",
	"ELECTRONICS",
	"FOOD_INDUSTRIES",
	"FUEL_REFINING",
	"MANUFACTURING",
	"METALLURGY",
	"RESOURCE_EXTRACTION",
	"PIONEERS",
	"SETTLERS",
	"TECHNICIANS",
	"ENGINEERS",
	"SCIENTISTS",
];

export const cogcTextMapping: Record<PLAN_COGCPROGRAM_TYPE, string> = {
	"---": "game.cogc_program_short.NONE",
	AGRICULTURE: "game.cogc_program_short.ADVERTISING_AGRICULTURE",
	CHEMISTRY: "game.cogc_program_short.ADVERTISING_CHEMISTRY",
	CONSTRUCTION: "game.cogc_program_short.ADVERTISING_CONSTRUCTION",
	ELECTRONICS: "game.cogc_program_short.ADVERTISING_ELECTRONICS",
	FOOD_INDUSTRIES: "game.cogc_program_short.ADVERTISING_FOOD_INDUSTRIES",
	FUEL_REFINING: "game.cogc_program_short.ADVERTISING_FUEL_REFINING",
	MANUFACTURING: "game.cogc_program_short.ADVERTISING_MANUFACTURING",
	METALLURGY: "game.cogc_program_short.ADVERTISING_METALLURGY",
	RESOURCE_EXTRACTION:
		"game.cogc_program_short.ADVERTISING_RESOURCE_EXTRACTION",
	PIONEERS: "game.cogc_program_short.WORKFORCE_PIONEERS",
	SETTLERS: "game.cogc_program_short.WORKFORCE_SETTLERS",
	TECHNICIANS: "game.cogc_program_short.WORKFORCE_TECHNICIANS",
	ENGINEERS: "game.cogc_program_short.WORKFORCE_ENGINEERS",
	SCIENTISTS: "game.cogc_program_short.WORKFORCE_SCIENTISTS",
};

export function usePlan() {
	const planningStore = usePlanningStore();

	/**
	 * Checks if route parameters contain the uuid of a
	 * shared plan, if so the whole plan is read-only
	 *
	 * @author jplacht
	 *
	 * @param {IPlanRouteParams} routeParams Route Parameters
	 * @returns {boolean} True if shared uuid is present
	 */
	function isEditDisabled(routeParams: IPlanRouteParams): boolean {
		if (routeParams.sharedPlanUuid) {
			return true;
		} else {
			return false;
		}
	}

	/**
	 * Maps planets COGC Program Type to Plans COGC Program Type
	 *
	 * @author jplacht
	 *
	 * @param {(PLANET_COGCPROGRAM_TYPE | null | undefined)} input Planet COGC Type
	 * @returns {PLAN_COGCPROGRAM_TYPE} Plan COGC Type
	 */
	function mapPlanetToPlanType(
		input: PLANET_COGCPROGRAM_TYPE | null | undefined
	): PLAN_COGCPROGRAM_TYPE {
		if (!input) return "---";
		const parts = input.split("_");
		const identifiedType = parts.slice(1).join("_").toUpperCase();

		// value could be invalid or on strike, check to ensure we got a proper cogc
		if (!cogcValues.includes(identifiedType)) return "---";
		else return identifiedType as PLAN_COGCPROGRAM_TYPE;
	}

	/**
	 * Generates a new plan definition from Planet Natural Id
	 *
	 * @author jplacht
	 *
	 * @param {string} planetNaturalId Planet Natural Id (e.g. 'OT-580b')
	 * @param {(PLANET_COGCPROGRAM_TYPE | null)} cogc Planet COGC
	 * @returns {IPlan} Blank plan definition
	 */
	function createBlankDefinition(
		planetNaturalId: string,
		cogc: PLANET_COGCPROGRAM_TYPE | null
	): IPlan {
		return {
			plan_name: undefined,
			uuid: undefined,
			planet_natural_id: planetNaturalId,
			plan_permits_used: 1,
			plan_corphq: false,
			plan_cogc: mapPlanetToPlanType(cogc),
			plan_data: {
				experts: [
					{
						type: "Agriculture",
						amount: 0,
					},
					{
						type: "Chemistry",
						amount: 0,
					},
					{
						type: "Construction",
						amount: 0,
					},
					{
						type: "Electronics",
						amount: 0,
					},
					{
						type: "Food_Industries",
						amount: 0,
					},
					{
						type: "Fuel_Refining",
						amount: 0,
					},
					{
						type: "Manufacturing",
						amount: 0,
					},
					{
						type: "Metallurgy",
						amount: 0,
					},
					{
						type: "Resource_Extraction",
						amount: 0,
					},
				],
				workforce: [
					{
						type: "pioneer",
						lux1: true,
						lux2: true,
					},
					{
						type: "settler",
						lux1: true,
						lux2: true,
					},
					{
						type: "technician",
						lux1: true,
						lux2: true,
					},
					{
						type: "engineer",
						lux1: true,
						lux2: true,
					},
					{
						type: "scientist",
						lux1: true,
						lux2: true,
					},
				],
				infrastructure: [],
				buildings: [],
			},
			empires: [],
		};
	}

	/**
	 * Creates a new plan and returns the new plans Uuid on a
	 * successful save operation in the backend
	 * @author jplacht
	 *
	 * @async
	 * @param {IPlanCreateData} data Plan Data
	 * @returns {Promise<string | undefined>} Plan Uuid
	 */
	async function createNewPlan(
		data: IPlanCreateData
	): Promise<string | undefined> {
		try {
			const createdData: IPlanSaveCreateResponse = await useQuery(
				"CreatePlan",
				{ data: data }
			).execute();

			// trigger backend data load
			await useQuery("GetPlan", {
				planUuid: createdData.uuid,
			});
			return createdData.uuid;
		} catch (err) {
			console.error(`Error creating plan: ${err}`);
			return undefined;
		}
	}

	/**
	 * Updates an existing plan in the backend api and returns
	 * its uuid again on successful operation in the backend
	 * @author jplacht
	 *
	 * @async
	 * @param {string} planUuid Plan Uuid
	 * @param {IPlanCreateData} data Plan Data
	 * @returns {Promise<string | undefined>} Plan Uuid
	 */
	async function saveExistingPlan(
		planUuid: string,
		data: IPlanCreateData
	): Promise<string | undefined> {
		try {
			const savedData: IPlanSaveCreateResponse = await useQuery(
				"PatchPlan",
				{
					planUuid: planUuid,
					data: {
						uuid: planUuid,
						...data,
					},
				}
			).execute();

			if (savedData) {
				await useQuery("GetPlan", {
					planUuid: savedData.uuid,
				}).execute();
				return savedData.uuid;
			}
		} catch (err) {
			console.error(`Error updating plan: ${err}`);
			return undefined;
		}
	}

	/**
	 * Reloading an existing plan is fetching the plan data from
	 * planning store again. The planning view won't persist changes
	 * to the stores data itself.
	 * @author jplacht
	 *
	 * @async
	 * @param {string} planUuid Plan Uuid
	 * @returns {Promise<IPlan>} Plan Data
	 */
	async function reloadExistingPlan(planUuid: string): Promise<IPlan> {
		return await planningStore.getPlan(planUuid);
	}

	/**
	 * Gets a plans name and planet natural id by given Plan UUID
	 * from already loaded plan information
	 * @author jplacht
	 *
	 * @param {string} planUuid Plan Uuid
	 * @returns {{
	 * 			planetId: string;
	 * 			planName: string;
	 * 		}} Planet Natural ID and Plan Name
	 */
	function getPlanNamePlanet(planUuid: string): {
		planetId: string;
		planName: string;
	} {
		const findPlan = planningStore.plans[planUuid];

		if (findPlan)
			return {
				planetId: findPlan.planet_natural_id,
				planName: findPlan.plan_name ?? "Unnamed",
			};

		throw new Error(
			`No data: Plan '${planUuid}'. Ensure Plan uuid is valid and planning data has been loaded.`
		);
	}

	async function cloneSharedPlan(sharedUuid: string): Promise<string | null> {
		try {
			const result = await useQuery("PostCloneSharedPlan", {
				sharedUuid,
			}).execute();
			return result?.uuid ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Asks the backend whether this plan changed since the editor loaded
	 * it. `PatchPlan` is a full PUT with no etag, so without this a
	 * second tab's — or another machine's — save is silently overwritten
	 * by whatever the open editor happens to hold.
	 *
	 * Both sides of the comparison are backend responses, so their
	 * formatting matches and only real content differences register.
	 *
	 * @author jplacht
	 *
	 * @async
	 * @param {string} planUuid Plan Uuid
	 * @param {IPlan} baseline Plan as the backend last gave it to us
	 * @returns {Promise<boolean>} Backend holds a different plan now
	 */
	async function detectRemotePlanChange(
		planUuid: string,
		baseline: IPlan
	): Promise<boolean> {
		const current: IPlan = await useQueryStore().execute(
			"GetPlan",
			{ planUuid },
			{ forceRefetch: true }
		);

		return (
			planContentFingerprint(current) !== planContentFingerprint(baseline)
		);
	}

	return {
		isEditDisabled,
		mapPlanetToPlanType,
		createBlankDefinition,
		createNewPlan,
		saveExistingPlan,
		detectRemotePlanChange,
		reloadExistingPlan,
		getPlanNamePlanet,
		cloneSharedPlan,
	};
}
