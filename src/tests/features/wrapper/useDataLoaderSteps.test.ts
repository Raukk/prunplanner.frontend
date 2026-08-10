import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { effectScope, nextTick, ref, Ref } from "vue";

import {
	useDataLoaderSteps,
	STEP_RETRY_DELAYS_MS,
} from "@/features/wrapper/useDataLoaderSteps";

// Types & Interfaces
import { StepConfig } from "@/features/wrapper/dataLoader.types";

/**
 * Runs the composable inside its own effect scope, mirroring the
 * component that normally owns it, and hands back a disposer so the
 * retry timers are torn down like they are on unmount.
 */
function withScope<T>(fn: () => T): { result: T; dispose: () => void } {
	const scope = effectScope();
	const result = scope.run(fn) as T;
	return { result, dispose: () => scope.stop() };
}

/** Lets every pending promise callback settle. */
async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await nextTick();
}

describe("useDataLoaderSteps", () => {
	let disposers: (() => void)[] = [];

	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		disposers.forEach((d) => d());
		disposers = [];
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	function run(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		configs: StepConfig<any>[],
		onComplete: () => void = () => {}
	) {
		const { result, dispose } = withScope(() =>
			useDataLoaderSteps(configs, onComplete)
		);
		disposers.push(dispose);
		return result;
	}

	it("loads enabled steps and completes", async () => {
		const onSuccess = vi.fn();
		const onComplete = vi.fn();

		const loader = run(
			[
				{
					key: "a",
					name: "A",
					enabled: () => true,
					load: () => Promise.resolve(["a"]),
					onSuccess,
				},
				{
					key: "off",
					name: "Off",
					enabled: () => false,
					load: () => Promise.reject(new Error("must not run")),
					onSuccess: vi.fn(),
				},
			],
			onComplete
		);

		await flush();

		expect(onSuccess).toHaveBeenCalledWith(["a"]);
		expect(loader.allLoaded.value).toBe(true);
		expect(loader.done.value).toBe(true);
		expect(loader.hasError.value).toBe(false);
		// a disabled step is neither shown nor waited for
		expect(loader.loadingSteps.value.map((s) => s.key)).toStrictEqual([
			"a",
		]);
		expect(onComplete).toHaveBeenCalledTimes(1);
	});

	it("retries a failed step and recovers without a remount", async () => {
		const load = vi
			.fn()
			.mockRejectedValueOnce(new Error("boom"))
			.mockResolvedValueOnce(["recovered"]);
		const onSuccess = vi.fn();

		const loader = run([
			{ key: "a", name: "A", enabled: () => true, load, onSuccess },
		]);

		await flush();

		expect(load).toHaveBeenCalledTimes(1);
		expect(loader.hasError.value).toBe(true);
		expect(loader.allLoaded.value).toBe(false);
		// waiting on its timer, so the manual retry stays disabled
		expect(loader.canRetry.value).toBe(false);
		expect(loader.loadingSteps.value[0].retryScheduled).toBe(true);

		await vi.advanceTimersByTimeAsync(STEP_RETRY_DELAYS_MS[0]);
		await flush();

		expect(load).toHaveBeenCalledTimes(2);
		expect(onSuccess).toHaveBeenCalledWith(["recovered"]);
		expect(loader.hasError.value).toBe(false);
		expect(loader.allLoaded.value).toBe(true);
	});

	it("stops after its automatic attempts and offers a manual retry", async () => {
		const load = vi.fn().mockRejectedValue(new Error("down"));

		const loader = run([
			{
				key: "a",
				name: "A",
				enabled: () => true,
				load,
				onSuccess: vi.fn(),
			},
		]);

		await flush();

		for (const delay of STEP_RETRY_DELAYS_MS) {
			await vi.advanceTimersByTimeAsync(delay);
			await flush();
		}

		// first attempt plus one per configured delay, then it gives up
		expect(load).toHaveBeenCalledTimes(STEP_RETRY_DELAYS_MS.length + 1);

		await vi.advanceTimersByTimeAsync(600_000);
		await flush();
		expect(load).toHaveBeenCalledTimes(STEP_RETRY_DELAYS_MS.length + 1);

		expect(loader.hasError.value).toBe(true);
		expect(loader.canRetry.value).toBe(true);
		expect(loader.loadingSteps.value[0].error?.message).toBe("down");

		// the manual retry hands the step a fresh attempt budget
		load.mockResolvedValueOnce(["manual"]);
		loader.retryFailed();
		await flush();

		expect(load).toHaveBeenCalledTimes(STEP_RETRY_DELAYS_MS.length + 2);
		expect(loader.allLoaded.value).toBe(true);
		expect(loader.hasError.value).toBe(false);
	});

	it("wraps a non Error rejection", async () => {
		const loader = run([
			{
				key: "a",
				name: "A",
				enabled: () => true,
				load: () => Promise.reject("plain string"),
				onSuccess: vi.fn(),
			},
		]);

		await flush();

		expect(loader.loadingSteps.value[0].error).toBeInstanceOf(Error);
		expect(loader.loadingSteps.value[0].error?.message).toBe(
			"plain string"
		);
	});

	it("holds a dependent step until its dependency has data", async () => {
		let resolveDep: (v: unknown) => void = () => {};
		const depLoad = vi.fn(
			() =>
				new Promise((resolve) => {
					resolveDep = resolve;
				})
		);
		const childLoad = vi.fn().mockResolvedValue(["child"]);

		const loader = run([
			{
				key: "dep",
				name: "Dep",
				enabled: () => true,
				load: depLoad,
				onSuccess: vi.fn(),
			},
			{
				key: "child",
				name: "Child",
				enabled: () => true,
				dependsOn: "dep",
				load: childLoad,
				onSuccess: vi.fn(),
			},
		]);

		await flush();
		expect(childLoad).not.toHaveBeenCalled();

		resolveDep(["dep"]);
		await flush();
		// dep resolve -> effect re-run -> child load -> child resolve
		await flush();

		expect(childLoad).toHaveBeenCalledTimes(1);
		expect(loader.allLoaded.value).toBe(true);
	});

	it("re-arms a step on resetStep", async () => {
		const load = vi.fn().mockResolvedValue(["a"]);

		const loader = run([
			{
				key: "a",
				name: "A",
				enabled: () => true,
				load,
				onSuccess: vi.fn(),
			},
		]);

		await flush();
		expect(loader.done.value).toBe(true);

		loader.resetStep("a");
		expect(loader.done.value).toBe(false);

		await flush();
		expect(load).toHaveBeenCalledTimes(2);
		expect(loader.allLoaded.value).toBe(true);
	});

	it("re-evaluates enabled steps when a prop flips", async () => {
		const flag: Ref<boolean> = ref(false);
		const load = vi.fn().mockResolvedValue(["late"]);

		const loader = run([
			{
				key: "late",
				name: "Late",
				enabled: () => flag.value,
				load,
				onSuccess: vi.fn(),
			},
		]);

		await flush();
		expect(load).not.toHaveBeenCalled();

		flag.value = true;
		await flush();

		expect(load).toHaveBeenCalledTimes(1);
		expect(loader.allLoaded.value).toBe(true);
	});

	it("cancels pending retries when the scope is torn down", async () => {
		const load = vi.fn().mockRejectedValue(new Error("down"));

		const { dispose } = withScope(() =>
			useDataLoaderSteps(
				[
					{
						key: "a",
						name: "A",
						enabled: () => true,
						load,
						onSuccess: vi.fn(),
					},
				],
				() => {}
			)
		);

		await flush();
		expect(load).toHaveBeenCalledTimes(1);

		dispose();

		await vi.advanceTimersByTimeAsync(600_000);
		await flush();

		expect(load).toHaveBeenCalledTimes(1);
	});
});
