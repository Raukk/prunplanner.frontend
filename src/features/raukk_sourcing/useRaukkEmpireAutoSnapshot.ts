import { onScopeDispose, readonly, ref, Ref, watch } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

// Composables
import {
	createBlockRecomputer,
	IRaukkBlockRecomputer,
	IRaukkChainError,
	loadEmpireList,
} from "@/features/raukk_sourcing/useRaukkBlockRecompute";

// Graph
import {
	buildDependencyGraph,
	orderUpstreamFirstBlocks,
} from "@/features/raukk_sourcing/raukkSourcingGraph";

// raukk: what the FLEET consumes is sourced account wide, not per base
import { raukkEffectiveShipSources } from "@/features/raukk_sourcing/calculations/shipSourcing";

// Types & Interfaces
import { IPlanEmpireElement } from "@/stores/planningStore.types";
import {
	IRaukkPlanConfig,
	IRaukkSnapshot,
} from "@/features/raukk_sourcing/raukkSourcing.types";

/** Graph inputs one upkeep pass builds its dependency graph from */
type IRaukkGraphInputs = {
	configs: Record<string, IRaukkPlanConfig>;
	snapshots: Record<string, IRaukkSnapshot>;
};

/** Reactive empire context the missing snapshot upkeep runs against */
export interface IRaukkEmpireAutoSnapshotContext {
	/** Uuids of the empires plans, unsaved plans carry undefined */
	planUuids: Ref<(string | undefined)[]>;
	/** Empire calculation in progress, processing waits for false */
	calculating: Ref<boolean>;
}

/** Quiet time after the empire calculation before processing starts */
const RAUKK_EMPIRE_AUTO_SNAPSHOT_DEBOUNCE_MS: number = 1000;

/** Total pass cap of one processing run, first pass included. A
 * recompute whose numbers materially changed re-flags its dependents
 * stale; follow up passes carry that cascade — and the settling of a
 * supply loop — through the empire without ever running away. */
const RAUKK_EMPIRE_AUTO_SNAPSHOT_MAX_PASSES: number = 5;

/**
 * Keeps the sourcing snapshots of a whole empire current.
 *
 * On a fresh browser the persisted sourcing store is empty, every
 * sourced cost note and source dropdown stays blank until each plan
 * was opened once; after an edit the plans downstream consumers hold
 * stale values until each of their pages is visited. This upkeep runs
 * whenever the empire calculation finishes — view load and empire
 * switch alike — finds the plans of the empire whose snapshot is
 * missing OR stale and computes them in the background, upstream
 * first, each in its own empire and CX context through the same
 * pipeline a plan view computation uses. Current snapshots are never
 * touched.
 *
 * SCOPE, the mirror principle: the dependency graph and the snapshot
 * predicate of the block ordering read
 * {@link useRaukkSourcingStore.recomputeGraphInputs}, the very set the
 * PRICING reads, so an out of scope producer named by a lingering config
 * edge is never pulled into a pass — and a plan whose STORED snapshot the
 * scope excludes is not refreshed here either. A plan without a snapshot
 * cannot be judged that way and is taken on its empire membership alone,
 * which is what this upkeep exists for. Staleness flags still cascade
 * UNSCOPED, deliberately: an out of scope plan stays flagged and
 * recomputes when it is opened, never during an account wide sweep.
 *
 * Plans are walked as SCC BLOCKS: a cross plan supply loop is solved as a
 * unit, so the WHOLE loop is recomputed as soon as ANY member is pending
 * — a refreshed source moves every price in the loop, its non pending
 * members included.
 *
 * A recompute that materially changes a plans numbers re-flags its
 * dependents stale; the run keeps passing over the empire until
 * nothing is left to do or {@link RAUKK_EMPIRE_AUTO_SNAPSHOT_MAX_PASSES}
 * is reached, so a cascade — or a supply loop settling towards its
 * fixed point — resolves within one empire load where possible.
 * Dependents outside the loaded empire stay stale until their own
 * empire loads or their page is visited. Failures are logged and
 * swallowed per plan and not retried within the run, background
 * upkeep must never take the empire view down. A processing run that
 * is already underway finishes even when the view navigates away, the
 * stored snapshots are the point of it.
 *
 * @author raukk
 *
 * @param {IRaukkEmpireAutoSnapshotContext} context Empire Context
 * @returns {Readonly<Ref<boolean>>} True while an upkeep run is in
 * flight — the concurrency signal manual recompute buttons gate on
 */
export function useRaukkEmpireAutoSnapshot(
	context: IRaukkEmpireAutoSnapshotContext
): Readonly<Ref<boolean>> {
	const sourcingStore = useRaukkSourcingStore();

	let timer: ReturnType<typeof setTimeout> | undefined = undefined;
	const running: Ref<boolean> = ref(false);
	let rerunRequested: boolean = false;

	/**
	 * Schedules a processing run after the debounce quiet time,
	 * restarting the clock on every call.
	 */
	function schedule(): void {
		if (timer !== undefined) clearTimeout(timer);

		timer = setTimeout(() => {
			timer = undefined;
			void run();
		}, RAUKK_EMPIRE_AUTO_SNAPSHOT_DEBOUNCE_MS);
	}

	/**
	 * Computes the missing and stale snapshots of the current empire
	 * plans, following the staleness cascade in additional passes. A
	 * run arriving while one is in flight is folded into a single
	 * rerun afterwards.
	 */
	async function run(): Promise<void> {
		if (context.calculating.value) return;

		if (running.value) {
			rerunRequested = true;
			return;
		}

		/** Plans a recompute failed for, excluded from later passes */
		const failed: Set<string> = new Set();

		/**
		 * Empire plans whose snapshot is missing or flagged stale. A
		 * stored snapshot the sweep scope does not hold is left alone, a
		 * MISSING one is taken on empire membership — see the scope note
		 * on the composable.
		 */
		function pendingPlans(scoped: Record<string, IRaukkSnapshot>): string[] {
			return context.planUuids.value.filter((uuid): uuid is string => {
				if (uuid === undefined || failed.has(uuid)) return false;

				const snapshot: IRaukkSnapshot | undefined =
					sourcingStore.snapshots[uuid];

				if (snapshot === undefined) return true;

				return snapshot.stale === true && scoped[uuid] !== undefined;
			});
		}

		let inputs: IRaukkGraphInputs = sourcingStore.recomputeGraphInputs();
		let pending: string[] = pendingPlans(inputs.snapshots);

		if (pending.length === 0) return;

		running.value = true;

		try {
			const empireList: IPlanEmpireElement[] = await loadEmpireList();

			const runner: IRaukkBlockRecomputer = createBlockRecomputer({
				empireList,
				shipSources: raukkEffectiveShipSources(
					sourcingStore.shipSourcing
				),
				planNameOf: (planUuid: string) =>
					sourcingStore.snapshots[planUuid]?.planName ?? planUuid,
				onError: (error: IRaukkChainError) => {
					failed.add(error.planUuid);

					console.warn(
						`[raukk] snapshot upkeep of plan '${error.planUuid}' failed`,
						error.message
					);
				},
			});

			for (
				let pass = 1;
				pass <= RAUKK_EMPIRE_AUTO_SNAPSHOT_MAX_PASSES &&
				pending.length > 0;
				pass++
			) {
				/** Pending plans are emitted whether they computed or not */
				const pendingSet: Set<string> = new Set(pending);

				const blocks: string[][] = orderUpstreamFirstBlocks(
					buildDependencyGraph(
						inputs.configs,
						inputs.snapshots,
						raukkEffectiveShipSources(sourcingStore.shipSourcing)
					),
					pending,
					// the SCOPED snapshots decide which loop mates join a
					// block, so an out of scope producer named by a lingering
					// config edge is never pulled in. A pending plan without a
					// snapshot is the whole point of this upkeep and passes
					// regardless — it is a given plan, never an expansion
					(planUuid: string) =>
						pendingSet.has(planUuid) ||
						inputs.snapshots[planUuid] !== undefined
				);

				for (const block of blocks) {
					// a loop is recomputed as a unit, its non pending members
					// included — a refreshed source moves every price in it
					if (block.length > 1) {
						await runner.runLoopBlock(block);
						continue;
					}

					// settled while the pass progressed
					if (!pendingPlans(inputs.snapshots).includes(block[0]))
						continue;

					await runner.runSingleton(block[0]);
				}

				// a materially changed recompute re-flags its dependents
				inputs = sourcingStore.recomputeGraphInputs();
				pending = pendingPlans(inputs.snapshots);
			}
		} finally {
			running.value = false;

			if (rerunRequested) {
				rerunRequested = false;
				schedule();
			}
		}
	}

	// view load and empire switch both end an empire calculation
	watch(
		context.calculating,
		(isCalculating) => {
			if (isCalculating === false) schedule();
		},
		{ immediate: true }
	);

	onScopeDispose(() => {
		if (timer !== undefined) clearTimeout(timer);
	});

	return readonly(running);
}
