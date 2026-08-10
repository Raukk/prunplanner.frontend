// Calculation Utils
import { TOTALMSDAY } from "@/features/planning/calculations/buildingCalculations";

// Types & Interfaces
import {
	IMaterialIO,
	IProductionBuilding,
} from "@/features/planning/usePlanCalculation.types";
import {
	IRaukkCostBreakdown,
	IRaukkOutputCost,
} from "@/features/raukk_sourcing/raukkSourcing.types";
import {
	IRaukkMaterialUnits,
	IRaukkResolvedPrice,
	IRaukkTrueCostInput,
	IRaukkTrueCostResult,
} from "@/features/raukk_sourcing/calculations/raukkCalculations.types";
import { raukkSettledWithin } from "@/features/raukk_sourcing/calculations/raukkEpsilon";

/**
 * A single active recipe reduced to its daily contribution.
 *
 * `dailyShare` is the recipes share of its buildings runtime, taken
 * straight from the plan result — the same share the upstream COGM uses
 * to split building costs across recipes.
 *
 * Canonical definition of the raukk sourcing calculations, consumed by
 * `src/features/raukk_sourcing/calculations/repairPerUnit.ts` as well.
 *
 * @author raukk
 */
export interface IRecipeDaily {
	buildingName: string;
	dailyShare: number;
	/** Gross output units per day, keyed by ticker */
	outputs: IRaukkMaterialUnits;
	/** Gross input units per day, keyed by ticker */
	inputs: IRaukkMaterialUnits;
}

/** Cost buckets accumulated per output ticker */
interface ICostBuckets {
	workforce: number;
	repair: number;
	inputs: number;
	shipping: number;
}

/**
 * Passes the internal transfer prices are solved in before the loop
 * gives up.
 *
 * A plan consuming its own production feeds its unit costs back into
 * itself, so the allocation is a fixed point rather than a formula. Each
 * pass shrinks the remaining movement by the internally consumed share,
 * which is below 1 in any plan that sells anything at all — a handful of
 * passes settle it and this cap only bounds the pathological case.
 *
 * @author raukk
 */
const INTERNAL_PRICE_PASSES: number = 25;

/** Zero of the cost bucket vector */
function emptyBuckets(): ICostBuckets {
	return { workforce: 0, repair: 0, inputs: 0, shipping: 0 };
}

/**
 * Adds a scaled cost bucket vector onto another, in place. Absent
 * summands (a ticker no pass has priced yet) add nothing.
 *
 * @author raukk
 *
 * @param {ICostBuckets} target Vector that is added to
 * @param {ICostBuckets | undefined} source Vector that is added
 * @param {number} factor Scale of the summand
 */
function addScaledBuckets(
	target: ICostBuckets,
	source: ICostBuckets | undefined,
	factor: number
): void {
	if (source === undefined) return;

	target.workforce += source.workforce * factor;
	target.repair += source.repair * factor;
	target.inputs += source.inputs * factor;
	target.shipping += source.shipping * factor;
}

/** Sum of one cost bucket vector, 0 when it does not exist */
function totalOfBuckets(bucket: ICostBuckets | undefined): number {
	if (bucket === undefined) return 0;

	return bucket.workforce + bucket.repair + bucket.inputs + bucket.shipping;
}

/**
 * Reduces a plans production buildings to per-recipe daily gross
 * material flows.
 *
 * Batch runs mirror `calculateMaterialIO` of
 * `src/features/planning/calculations/buildingCalculations.ts`:
 * a building runs `TOTALMSDAY * amount / totalBatchTime` batches per day
 * and each active recipe contributes `amount` runs per batch.
 *
 * Canonical implementation of the raukk sourcing calculations, consumed
 * by `src/features/raukk_sourcing/calculations/repairPerUnit.ts` as well.
 *
 * @author raukk
 *
 * @param {IProductionBuilding[]} buildings Plan production buildings
 * @returns {IRecipeDaily[]} Per-recipe daily flows
 */
export function reduceRecipesDaily(
	buildings: IProductionBuilding[]
): IRecipeDaily[] {
	const result: IRecipeDaily[] = [];

	buildings.forEach((building) => {
		if (building.amount <= 0 || building.totalBatchTime <= 0) return;

		const batchRuns: number =
			(TOTALMSDAY * building.amount) / building.totalBatchTime;

		building.activeRecipes.forEach((ar) => {
			if (ar.amount === 0) return;

			const runs: number = ar.amount * batchRuns;

			const outputs: IRaukkMaterialUnits = {};
			const inputs: IRaukkMaterialUnits = {};

			ar.recipe.outputs.forEach((o) => {
				outputs[o.material_ticker] =
					(outputs[o.material_ticker] ?? 0) +
					o.material_amount * runs;
			});
			ar.recipe.inputs.forEach((i) => {
				inputs[i.material_ticker] =
					(inputs[i.material_ticker] ?? 0) + i.material_amount * runs;
			});

			result.push({
				buildingName: building.name,
				dailyShare: ar.dailyShare,
				outputs,
				inputs,
			});
		});
	});

	return result;
}

/** Net output weights of one recipe and their sum */
export interface IRaukkOutputWeights {
	/** Key: output ticker, value: weight */
	weights: IRaukkMaterialUnits;
	weightTotal: number;
}

/**
 * Weights the outputs of one recipe by the share of them that leaves the
 * plan as net output.
 *
 * Self consumed units carry no weight: a tickers gross recipe output is
 * scaled by its net fraction, so a recipe whose outputs are fully
 * consumed inside the plan ends up with a zero weight total and its cost
 * has to be carried by the callers residual.
 *
 * Canonical implementation of the raukk sourcing calculations, consumed
 * by `src/features/raukk_sourcing/calculations/repairPerUnit.ts` as well.
 *
 * @author raukk
 *
 * @param {IRaukkMaterialUnits} outputs Gross recipe outputs per day
 * @param {IRaukkMaterialUnits} recipeGrossOutput Plan gross output per day
 * @param {IRaukkMaterialUnits} netOutputUnits Plan net output per day
 * @returns {IRaukkOutputWeights} Weights per ticker and their sum
 */
export function netOutputWeights(
	outputs: IRaukkMaterialUnits,
	recipeGrossOutput: IRaukkMaterialUnits,
	netOutputUnits: IRaukkMaterialUnits
): IRaukkOutputWeights {
	const weights: IRaukkMaterialUnits = {};
	let weightTotal: number = 0;

	Object.entries(outputs).forEach(([ticker, units]) => {
		const gross: number = recipeGrossOutput[ticker] ?? 0;
		const netFraction: number =
			gross > 0 ? (netOutputUnits[ticker] ?? 0) / gross : 0;

		const weight: number = units * Math.min(netFraction, 1);
		if (weight <= 0) return;

		weights[ticker] = weight;
		weightTotal += weight;
	});

	return { weights, weightTotal };
}

/**
 * Sums the `input` side of a material I/O array per ticker.
 *
 * @author raukk
 *
 * @param {IMaterialIO[]} materialIO Material I/O
 * @returns {IRaukkMaterialUnits} Gross input units per day per ticker
 */
function grossInputs(materialIO: IMaterialIO[]): IRaukkMaterialUnits {
	const result: IRaukkMaterialUnits = {};

	materialIO.forEach((e) => {
		if (e.input > 0) result[e.ticker] = (result[e.ticker] ?? 0) + e.input;
	});

	return result;
}

/**
 * Calculates a plans true break-even cost per output unit.
 *
 * Cost buckets per day are workforce consumables, repair capital cost,
 * production inputs and — when the caller supplies per unit shipping —
 * the freight of those inputs. Shipping is a bucket of its own that
 * rides the very same allocation as the inputs bucket instead of being
 * folded into the prices, so `breakdown.shipping` keeps meaning what it
 * says. They are allocated to output tickers with the same share logic
 * the upstream
 * COGM uses (`usePlanCalculation.ts`): a buildings cost is split across
 * its active recipes by runtime share, a recipes cost is split across
 * its outputs proportional to output amount (the `costSplit` branch of
 * `outputCOGM`).
 *
 * Self consumption is already netted in `planResult.materialio`: only
 * net inputs (`delta < 0`) are paid for and only net outputs
 * (`delta > 0`) receive an allocation. A recipe whose outputs are fully
 * consumed inside the plan carries no weight; its cost is redistributed
 * across the plans net outputs. Runtime shares left idle and buildings
 * without an active recipe hold a residual as well, they still cost
 * workforce and repair — it is redistributed the same way.
 *
 * Prices are supplied by the caller through `resolveInputPrice`, which
 * decides market mode versus another plans transfer price. Whenever it
 * reports a `fromPlanUuid` the daily units are recorded in `draws`.
 *
 * @author raukk
 *
 * @param {IRaukkTrueCostInput} inputs Plan result, repair cost, resolver
 * @returns {IRaukkTrueCostResult} Output costs and cross-plan draws
 */
export function calculateTrueCosts(
	inputs: IRaukkTrueCostInput
): IRaukkTrueCostResult {
	const {
		planResult,
		repairCostPerDayByBuilding,
		repairMaterialUnitsPerDay = {},
		resolveInputPrice,
		shippingPerUnitIn = {},
		shippingPerUnitOut = {},
	} = inputs;

	/** ȼ per unit of freight, zero for everything not shipped */
	function shippingOf(ticker: string): number {
		return shippingPerUnitIn[ticker] ?? 0;
	}

	const draws: Record<string, IRaukkMaterialUnits> = {};
	const priceCache: Map<string, IRaukkResolvedPrice> = new Map();

	/**
	 * Resolves a tickers price once and books the drawn units onto the
	 * source plan when the resolver reports one.
	 */
	function priceOf(ticker: string, unitsPerDay: number): number {
		let resolved: IRaukkResolvedPrice | undefined = priceCache.get(ticker);

		if (resolved === undefined) {
			resolved = resolveInputPrice(ticker);
			priceCache.set(ticker, resolved);
		}

		if (resolved.fromPlanUuid !== undefined && unitsPerDay > 0) {
			const planDraws: IRaukkMaterialUnits =
				draws[resolved.fromPlanUuid] ?? {};
			planDraws[ticker] = (planDraws[ticker] ?? 0) + unitsPerDay;
			draws[resolved.fromPlanUuid] = planDraws;
		}

		return resolved.price;
	}

	// repair materials are sourcable tickers as well; their cost already
	// arrives pre-computed per building, only the draws are booked here
	Object.entries(repairMaterialUnitsPerDay).forEach(([ticker, unitsPerDay]) =>
		priceOf(ticker, unitsPerDay)
	);

	/*
	 * Net material flows
	 *
	 * materialio carries the netted plan flows. Net inputs are split into
	 * a workforce and a production part by their gross demand share, so
	 * a ticker used by both buckets (e.g. self-produced food) is charged
	 * proportionally.
	 */

	const workforceGross: IRaukkMaterialUnits = grossInputs(
		planResult.workforceMaterialIO
	);
	const productionGross: IRaukkMaterialUnits = grossInputs(
		planResult.productionMaterialIO
	);

	const netOutputUnits: IRaukkMaterialUnits = {};
	const netProductionInput: IRaukkMaterialUnits = {};
	/** Externally bought share of a tickers gross demand, 0..1 */
	const externalFraction: IRaukkMaterialUnits = {};
	/** Freight of the workforce share, allocated exactly like its cost */
	let workforceShippingTotal: number = 0;
	/** Externally bought part of the workforce consumables, per day */
	let workforceExternalCost: number = 0;

	planResult.materialio.forEach((e) => {
		if (e.delta > 0) {
			netOutputUnits[e.ticker] = e.delta;
			return;
		}
		if (e.delta >= 0) return;

		const netUnits: number = e.delta * -1;
		const wGross: number = workforceGross[e.ticker] ?? 0;
		const pGross: number = productionGross[e.ticker] ?? 0;
		const grossTotal: number = wGross + pGross;

		const workforceShare: number = grossTotal > 0 ? wGross / grossTotal : 0;
		const price: number = priceOf(e.ticker, netUnits);

		externalFraction[e.ticker] =
			grossTotal > 0 ? Math.min(netUnits / grossTotal, 1) : 1;

		workforceExternalCost += netUnits * workforceShare * price;
		workforceShippingTotal +=
			netUnits * workforceShare * shippingOf(e.ticker);
		netProductionInput[e.ticker] = netUnits * (1 - workforceShare);
	});

	/**
	 * Workforce consumables the plan GROWS itself, per ticker and day.
	 *
	 * Netting hides them — a fully self supplied consumable never appears
	 * in the material I/O at all — but they are not free: the recipe that
	 * made them booked the cost, and the workforce eating them has to
	 * carry it, or the cost would vanish between the two.
	 */
	const workforceInternalUnits: IRaukkMaterialUnits = {};

	Object.entries(workforceGross).forEach(([ticker, gross]) => {
		// absent from the material I/O means fully self supplied: the
		// netting cancelled the ticker out entirely
		const internal: number = gross * (1 - (externalFraction[ticker] ?? 0));

		if (internal > 0) workforceInternalUnits[ticker] = internal;
	});

	/*
	 * Input netting factor
	 *
	 * Recipes know their gross input demand only. Charging the plans net
	 * demand means scaling every recipes gross demand by the tickers
	 * net/gross ratio.
	 */

	const recipes: IRecipeDaily[] = reduceRecipesDaily(
		planResult.production.buildings
	);

	const recipeGrossInput: IRaukkMaterialUnits = {};
	const recipeGrossOutput: IRaukkMaterialUnits = {};

	recipes.forEach((r) => {
		Object.entries(r.inputs).forEach(([ticker, units]) => {
			recipeGrossInput[ticker] = (recipeGrossInput[ticker] ?? 0) + units;
		});
		Object.entries(r.outputs).forEach(([ticker, units]) => {
			recipeGrossOutput[ticker] =
				(recipeGrossOutput[ticker] ?? 0) + units;
		});
	});

	/*
	 * Workforce cost per building
	 *
	 * The plans workforce consumable cost is distributed over buildings
	 * by their upstream workforce cost weight, matching the COGM notion
	 * of a buildings own workforce cost, then over recipes by runtime
	 * share.
	 */

	const buildingWeights: Record<string, number> = {};
	let buildingWeightTotal: number = 0;

	planResult.production.buildings.forEach((b) => {
		const weight: number = Math.abs(b.workforceDailyCost) * b.amount;
		buildingWeights[b.name] = (buildingWeights[b.name] ?? 0) + weight;
		buildingWeightTotal += weight;
	});

	const runningBuildings: string[] = Array.from(
		new Set(recipes.map((r) => r.buildingName))
	);

	/**
	 * Splits a plan wide workforce total over one building. Written as
	 * one helper over an arbitrary total so the freight of the workforce
	 * consumables follows their cost exactly, term by term.
	 */
	function buildingWorkforceOf(total: number, name: string): number {
		if (buildingWeightTotal > 0) {
			return total * ((buildingWeights[name] ?? 0) / buildingWeightTotal);
		}
		// no workforce weights available, spread evenly over the
		// buildings that actually run
		return runningBuildings.includes(name)
			? total / runningBuildings.length
			: 0;
	}

	/*
	 * Allocation to outputs
	 *
	 * Every recipe pays for ALL the units it consumes and every unit it
	 * PRODUCES carries a share of that. A base eating its own FE charges
	 * the eating recipe the plans own FE unit cost, instead of leaving the
	 * whole FE line on the few units that happen to leave the base — the
	 * exported units would otherwise price at a multiple of what they
	 * cost, and the products that ate the rest would look free.
	 *
	 * Those internal prices are what the allocation is solving for, so it
	 * ITERATES: each pass prices internal transfers with the unit costs of
	 * the previous one and stops once none of them moves. A loop inside
	 * one plan (own food feeding the workforce that grows it) shrinks by
	 * its internal share every pass and therefore converges; the cap only
	 * guards against a pathological plan.
	 */

	/** One recipes charges, minus what the internal prices decide */
	interface IRecipeCharge {
		buildingName: string;
		dailyShare: number;
		/** Gross output units per day, keyed by ticker */
		outputs: IRaukkMaterialUnits;
		grossOutputTotal: number;
		externalInputCost: number;
		externalInputShipping: number;
		/** Units taken from the plans own production, per ticker */
		internalUnits: IRaukkMaterialUnits;
	}

	const charges: IRecipeCharge[] = recipes.map((r) => {
		let externalInputCost: number = 0;
		let externalInputShipping: number = 0;
		const internalUnits: IRaukkMaterialUnits = {};

		Object.entries(r.inputs).forEach(([ticker, units]) => {
			const gross: number = recipeGrossInput[ticker] ?? 0;
			if (gross <= 0) return;

			// the plan buys the net demand and makes the rest itself, in
			// the same proportion for every recipe consuming the ticker
			const externalUnits: number =
				units * Math.min((netProductionInput[ticker] ?? 0) / gross, 1);

			externalInputCost +=
				externalUnits * (priceCache.get(ticker)?.price ?? 0);
			externalInputShipping += externalUnits * shippingOf(ticker);

			const internal: number = units - externalUnits;
			if (internal > 0)
				internalUnits[ticker] = (internalUnits[ticker] ?? 0) + internal;
		});

		return {
			buildingName: r.buildingName,
			dailyShare: r.dailyShare,
			outputs: r.outputs,
			grossOutputTotal: Object.values(r.outputs).reduce(
				(sum, units) => sum + units,
				0
			),
			externalInputCost,
			externalInputShipping,
			internalUnits,
		};
	});

	/** Key: building name, value: runtime share covered by its recipes */
	const coveredShare: Record<string, number> = {};

	charges.forEach((c) => {
		coveredShare[c.buildingName] =
			(coveredShare[c.buildingName] ?? 0) + c.dailyShare;
	});

	/*
	 * Runtime shares left idle and buildings without an active recipe
	 * carry workforce and repair cost as well. They produce nothing, so
	 * their share lands in the residual — the same handling
	 * `calculateRepairPerUnit` performs.
	 */
	const costedBuildings: Set<string> = new Set([
		...Object.keys(buildingWeights),
		...Object.keys(repairCostPerDayByBuilding),
	]);

	const grossOutputTotal: number = Object.values(recipeGrossOutput).reduce(
		(sum, units) => sum + units,
		0
	);

	/**
	 * One allocation pass over every recipe, internal transfers priced
	 * with the unit costs handed in.
	 *
	 * @param {Record<string, ICostBuckets>} prices Cost of one gross unit
	 *     per ticker, as the previous pass computed it
	 * @returns {Record<string, ICostBuckets>} Daily cost per output ticker
	 */
	function allocationPass(
		prices: Record<string, ICostBuckets>
	): Record<string, ICostBuckets> {
		const pass: Record<string, ICostBuckets> = {};

		function addBucket(ticker: string, key: keyof ICostBuckets, v: number) {
			const current: ICostBuckets = pass[ticker] ?? {
				workforce: 0,
				repair: 0,
				inputs: 0,
				shipping: 0,
			};
			current[key] += v;
			pass[ticker] = current;
		}

		/*
		 * Consumables the plan grows itself are not free: they cost what
		 * the plan spent making them, bucket by bucket — an internally
		 * made input is upstream WORKFORCE and REPAIR, it is not a
		 * purchase, and folding it into one number would make the
		 * breakdown lie about where the ȼ went.
		 */
		const workforceTotals: ICostBuckets = {
			workforce: workforceExternalCost,
			repair: 0,
			inputs: 0,
			shipping: workforceShippingTotal,
		};

		Object.entries(workforceInternalUnits).forEach(([ticker, units]) => {
			addScaledBuckets(workforceTotals, prices[ticker], units);
		});

		const residual: ICostBuckets = emptyBuckets();

		charges.forEach((c) => {
			const charge: ICostBuckets = {
				workforce:
					buildingWorkforceOf(
						workforceTotals.workforce,
						c.buildingName
					) * c.dailyShare,
				repair:
					((repairCostPerDayByBuilding[c.buildingName] ?? 0) +
						buildingWorkforceOf(
							workforceTotals.repair,
							c.buildingName
						)) *
					c.dailyShare,
				inputs:
					c.externalInputCost +
					buildingWorkforceOf(workforceTotals.inputs, c.buildingName) *
						c.dailyShare,
				shipping:
					c.externalInputShipping +
					buildingWorkforceOf(
						workforceTotals.shipping,
						c.buildingName
					) *
						c.dailyShare,
			};

			Object.entries(c.internalUnits).forEach(([ticker, units]) => {
				addScaledBuckets(charge, prices[ticker], units);
			});

			if (c.grossOutputTotal <= 0) {
				addScaledBuckets(residual, charge, 1);
				return;
			}

			Object.entries(c.outputs).forEach(([ticker, units]) => {
				const share: number = units / c.grossOutputTotal;

				addBucket(ticker, "workforce", charge.workforce * share);
				addBucket(ticker, "repair", charge.repair * share);
				addBucket(ticker, "inputs", charge.inputs * share);
				addBucket(ticker, "shipping", charge.shipping * share);
			});
		});

		costedBuildings.forEach((name) => {
			const uncovered: number = 1 - (coveredShare[name] ?? 0);
			if (uncovered <= 0) return;

			residual.workforce +=
				buildingWorkforceOf(workforceTotals.workforce, name) * uncovered;
			residual.repair +=
				((repairCostPerDayByBuilding[name] ?? 0) +
					buildingWorkforceOf(workforceTotals.repair, name)) *
				uncovered;
			residual.inputs +=
				buildingWorkforceOf(workforceTotals.inputs, name) * uncovered;
			residual.shipping +=
				buildingWorkforceOf(workforceTotals.shipping, name) * uncovered;
		});

		// idle capacity is carried by everything the plan does produce
		const residualTotal: number =
			residual.workforce +
			residual.repair +
			residual.inputs +
			residual.shipping;

		if (residualTotal !== 0 && grossOutputTotal > 0) {
			Object.entries(recipeGrossOutput).forEach(([ticker, units]) => {
				const share: number = units / grossOutputTotal;

				addBucket(ticker, "workforce", residual.workforce * share);
				addBucket(ticker, "repair", residual.repair * share);
				addBucket(ticker, "inputs", residual.inputs * share);
				addBucket(ticker, "shipping", residual.shipping * share);
			});
		}

		return pass;
	}

	/** Cost of ONE gross unit produced, per ticker and bucket */
	function unitCostsOf(
		pass: Record<string, ICostBuckets>
	): Record<string, ICostBuckets> {
		const result: Record<string, ICostBuckets> = {};

		Object.entries(pass).forEach(([ticker, bucket]) => {
			const gross: number = recipeGrossOutput[ticker] ?? 0;
			if (gross <= 0) return;

			const unit: ICostBuckets = emptyBuckets();
			addScaledBuckets(unit, bucket, 1 / gross);
			result[ticker] = unit;
		});

		return result;
	}

	let buckets: Record<string, ICostBuckets> = allocationPass({});
	let prices: Record<string, ICostBuckets> = unitCostsOf(buckets);

	for (let pass = 1; pass < INTERNAL_PRICE_PASSES; pass++) {
		const next: Record<string, ICostBuckets> = allocationPass(prices);
		const nextPrices: Record<string, ICostBuckets> = unitCostsOf(next);

		buckets = next;

		const settled: boolean = Object.keys({
			...prices,
			...nextPrices,
		}).every((ticker) =>
			raukkSettledWithin(
				totalOfBuckets(prices[ticker]),
				totalOfBuckets(nextPrices[ticker])
			)
		);

		prices = nextPrices;

		if (settled) break;
	}

	/*
	 * Per unit result
	 */

	const outputs: Record<string, IRaukkOutputCost> = {};

	Object.entries(buckets).forEach(([ticker, bucket]) => {
		const unitsPerDay: number = netOutputUnits[ticker] ?? 0;
		if (unitsPerDay <= 0) return;

		/*
		 * Per GROSS unit, not per exported one: what a unit costs does not
		 * depend on whether it leaves the base. The units the plan eats
		 * itself carry their own share and hand it to whatever ate them.
		 */
		const grossUnits: number = recipeGrossOutput[ticker] ?? 0;
		if (grossUnits <= 0) return;

		/*
		 * The freight of the units sold at the exchange is charged per
		 * unit sold and added on top of the allocated inbound freight.
		 */
		const shipping: number =
			bucket.shipping === 0 && (shippingPerUnitOut[ticker] ?? 0) === 0
				? 0
				: bucket.shipping / grossUnits +
					(shippingPerUnitOut[ticker] ?? 0);

		const breakdown: IRaukkCostBreakdown = {
			workforce: bucket.workforce / grossUnits,
			repair: bucket.repair / grossUnits,
			inputs: bucket.inputs / grossUnits,
			shipping,
		};

		outputs[ticker] = {
			ticker,
			unitsPerDay,
			costPerUnit:
				breakdown.workforce +
				breakdown.repair +
				breakdown.inputs +
				breakdown.shipping,
			breakdown,
		};
	});

	return { outputs, draws };
}
