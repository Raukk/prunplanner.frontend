import {
	computed,
	ComputedRef,
	onScopeDispose,
	reactive,
	ref,
	Ref,
	watch,
	watchEffect,
} from "vue";

// Util
import { inertClone } from "@/util/data";

// Types & Interfaces
import {
	LoadingStep,
	StepConfig,
	StepState,
} from "@/features/wrapper/dataLoader.types";

/**
 * Delay before each automatic retry of a failed step. A step that used
 * up the list stops retrying and waits for `retryFailed`, so a backend
 * that is down is not hammered for as long as the view stays open.
 */
export const STEP_RETRY_DELAYS_MS: readonly number[] = [1_000, 4_000, 15_000];

/**
 * Runs a data loaders steps, retrying the ones that fail.
 *
 * A step is a single query with a display name. Steps run as soon as
 * they are enabled and their dependency has data, which is what lets a
 * view paint the moment everything it asked for is available.
 *
 * A failed step used to latch: `triggered` stayed true, nothing reset
 * it, and the view sat on its loading screen until the user reloaded.
 * The query store drops a failed entry from the cache, so re-arming the
 * step here re-runs the request instead of replaying the same error.
 *
 * @author raukk
 *
 * @param {readonly StepConfig<any>[]} stepConfigs Step definitions
 * @param {() => void} onComplete Called when every enabled step has data
 */
export function useDataLoaderSteps(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	stepConfigs: readonly StepConfig<any>[],
	onComplete: () => void
) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const steps = reactive<StepState<any>[]>(
		stepConfigs.map((cfg) => ({
			cfg,
			data: null,
			loading: false,
			error: null,
			triggered: false,
			attempts: 0,
			retryScheduled: false,
		}))
	);

	const done: Ref<boolean> = ref(false);

	/** Pending automatic retries, keyed by step key. */
	const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

	function cancelRetry(key: string): void {
		const timer = retryTimers.get(key);
		if (timer !== undefined) {
			clearTimeout(timer);
			retryTimers.delete(key);
		}
	}

	// a timer firing into a torn down view would resurrect its request
	onScopeDispose(() => {
		retryTimers.forEach((timer) => clearTimeout(timer));
		retryTimers.clear();
	});

	/**
	 * Schedules the next automatic attempt for a failed step, if it has
	 * one left.
	 *
	 * @author raukk
	 *
	 * @param {StepState<unknown>} step Failed step
	 */
	function scheduleRetry(step: StepState<unknown>): void {
		const delay: number | undefined =
			STEP_RETRY_DELAYS_MS[step.attempts - 1];

		// out of automatic attempts, the error stays on screen and a
		// manual retry is the way out
		if (delay === undefined) return;

		cancelRetry(step.cfg.key);
		step.retryScheduled = true;

		retryTimers.set(
			step.cfg.key,
			setTimeout(() => {
				retryTimers.delete(step.cfg.key);
				step.retryScheduled = false;
				// re-arms the orchestrator for this step
				step.triggered = false;
			}, delay)
		);
	}

	/**
	 * Re-arms a step so the orchestrator runs it again, discarding
	 * whatever it held. Used when a prop change makes a steps result
	 * refer to the wrong entity.
	 *
	 * @author raukk
	 *
	 * @param {string} key Step key
	 */
	function resetStep(key: string): void {
		const step = steps.find((s) => s.cfg.key === key);
		if (!step) return;

		cancelRetry(key);
		step.retryScheduled = false;
		step.triggered = false;
		step.data = null;
		step.error = null;
		step.attempts = 0;
		done.value = false;
	}

	/**
	 * Re-arms every failed step with a fresh attempt budget. Backs the
	 * manual retry the loading screen offers once the automatic attempts
	 * are used up.
	 *
	 * @author raukk
	 */
	function retryFailed(): void {
		steps.forEach((step) => {
			if (step.error === null) return;

			cancelRetry(step.cfg.key);
			step.retryScheduled = false;
			step.error = null;
			step.attempts = 0;
			step.triggered = false;
		});
	}

	// Orchestrator
	watchEffect(() => {
		steps.forEach((s) => {
			if (s.triggered || !s.cfg.enabled()) return;

			const dep = s.cfg.dependsOn
				? steps.find((p) => p.cfg.key === s.cfg.dependsOn)
				: null;
			if (dep && dep.data == null) return;

			s.triggered = true;
			s.loading = true;
			s.error = null;
			s.attempts += 1;

			s.cfg
				.load()
				.then((d) => {
					const shallowData = inertClone(d);
					s.data = shallowData;
					s.cfg.onSuccess(shallowData);
				})
				.catch((e) => {
					console.error(
						`Data loader step "${s.cfg.key}" failed`,
						`attempt ${s.attempts}`,
						e
					);
					s.error = e instanceof Error ? e : new Error(String(e));
					scheduleRetry(s as StepState<unknown>);
				})
				.finally(() => {
					s.loading = false;
				});
		});
	});

	const enabledSteps = computed(() => steps.filter((s) => s.cfg.enabled()));

	const loadingSteps: ComputedRef<LoadingStep[]> = computed(() =>
		enabledSteps.value.map((s) => ({
			key: s.cfg.key,
			name: s.cfg.name,
			loading: s.loading,
			error: s.error,
			retryScheduled: s.retryScheduled,
		}))
	);

	const hasError: ComputedRef<boolean> = computed(() =>
		enabledSteps.value.some((s) => s.error != null)
	);

	/**
	 * True while every failed step has used up its automatic attempts,
	 * i.e. nothing will move without the user asking for it.
	 *
	 * @type {ComputedRef<boolean>}
	 */
	const canRetry: ComputedRef<boolean> = computed(
		() =>
			hasError.value &&
			!enabledSteps.value.some((s) => s.loading || s.retryScheduled)
	);

	const allLoaded: ComputedRef<boolean> = computed(() =>
		enabledSteps.value.every(
			(s) => !s.loading && s.error == null && s.data != null
		)
	);

	watch(
		allLoaded,
		(ok) => {
			if (ok) {
				onComplete();
				done.value = true;
			}
		},
		{ immediate: true }
	);

	/**
	 * Reads a completed steps payload.
	 *
	 * @author raukk
	 *
	 * @template TData Step data type
	 * @param {string} key Step key
	 * @returns {TData} Step data, undefined while it has none
	 */
	function stepData<TData>(key: string): TData {
		return steps.find((s) => s.cfg.key === key)?.data as TData;
	}

	return {
		steps,
		done,
		allLoaded,
		hasError,
		canRetry,
		loadingSteps,
		resetStep,
		retryFailed,
		stepData,
	};
}
