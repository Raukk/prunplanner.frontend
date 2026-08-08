// Types & Interfaces
import {
	IEmpireMaterialIO,
	IEmpireMaterialIOPlanet,
} from "@/features/empire/empire.types";

/**
 * One contribution line of the empire material i/o, after the bases
 * sharing a docking site have been folded into a single SITE.
 *
 * Purely a display shape: the combined material i/o itself keeps one
 * entry per plan, because the empire state persisted from it is keyed
 * by plan uuid.
 */
export interface IRaukkMaterialIOSite extends IEmpireMaterialIOPlanet {
	/** Bases folded into this line, 1 on an unlinked plan */
	baseCount: number;
	/** Names of the folded bases, the representative first */
	planNames: string[];
}

/** Same rows as an {@link IEmpireMaterialIO}, contributions grouped */
export interface IRaukkMaterialIOSiteRow extends Omit<
	IEmpireMaterialIO,
	"inputPlanets" | "outputPlanets"
> {
	inputPlanets: IRaukkMaterialIOSite[];
	outputPlanets: IRaukkMaterialIOSite[];
}

/**
 * Folds the plans of one contribution list into sites: a HOST plan and
 * every base leasing from it are ONE line, their units summed.
 *
 * A lease and its host are two plans of one physical base site, so
 * reading their tonnage apart says nothing a user acts on — what
 * arrives at the site is the sum. Only linked plans are folded:
 * unlinked plans that merely happen to share a planet stay separate
 * lines, they are separate sites with separate ship visits.
 *
 * The representative of a group is the HOST entry where the list holds
 * one, which keeps the row's uuid — and with it the plan link the UI
 * builds from it — pointing at the plan that flies the site. A lease
 * whose host contributes nothing of this ticker has no host entry to
 * fold into and represents itself.
 *
 * @author raukk
 *
 * @param {IEmpireMaterialIOPlanet[]} planets Contribution lines
 * @param {(planUuid: string) => (string | undefined)} hostOf Host plan
 *   uuid of a plan, undefined on a plan that is no lease
 * @returns {IRaukkMaterialIOSite[]} Lines, leases folded into hosts
 */
export function groupMaterialIOSites(
	planets: IEmpireMaterialIOPlanet[],
	hostOf: (planUuid: string) => string | undefined
): IRaukkMaterialIOSite[] {
	const groups: Map<string, IEmpireMaterialIOPlanet[]> = new Map();

	planets.forEach((planet) => {
		const key: string = hostOf(planet.planUuid) ?? planet.planUuid;
		const group: IEmpireMaterialIOPlanet[] | undefined = groups.get(key);

		if (group) group.push(planet);
		else groups.set(key, [planet]);
	});

	return Array.from(groups.entries()).map(([key, group]) => {
		/*
		 * The host entry leads the group, so the folded line carries the
		 * uuid, planet and COGC of the plan that owns the site. Without
		 * one — the host contributes nothing of this ticker — the first
		 * entry stands in for it.
		 */
		const lead: IEmpireMaterialIOPlanet =
			group.find((planet) => planet.planUuid === key) ?? group[0];

		const ordered: IEmpireMaterialIOPlanet[] = [
			lead,
			...group.filter((planet) => planet !== lead),
		];

		return {
			planetId: lead.planetId,
			planUuid: lead.planUuid,
			planName: lead.planName,
			planCOGC: lead.planCOGC,
			delta: ordered.reduce((sum, planet) => sum + planet.delta, 0),
			input: ordered.reduce((sum, planet) => sum + planet.input, 0),
			output: ordered.reduce((sum, planet) => sum + planet.output, 0),
			price: ordered.reduce((sum, planet) => sum + planet.price, 0),
			baseCount: ordered.length,
			planNames: ordered.map((planet) => planet.planName),
		};
	});
}

/**
 * Whole empire material i/o with both contribution lists folded into
 * sites, see {@link groupMaterialIOSites}. Totals, prices and the row
 * order are untouched: only who contributes them changes.
 *
 * @author raukk
 *
 * @param {IEmpireMaterialIO[]} data Combined empire material i/o
 * @param {(planUuid: string) => (string | undefined)} hostOf Host plan
 *   uuid of a plan, undefined on a plan that is no lease
 * @returns {IRaukkMaterialIOSiteRow[]} Rows with grouped contributions
 */
export function groupEmpireMaterialIOSites(
	data: IEmpireMaterialIO[],
	hostOf: (planUuid: string) => string | undefined
): IRaukkMaterialIOSiteRow[] {
	return data.map((row) => ({
		...row,
		inputPlanets: groupMaterialIOSites(row.inputPlanets, hostOf),
		outputPlanets: groupMaterialIOSites(row.outputPlanets, hostOf),
	}));
}
