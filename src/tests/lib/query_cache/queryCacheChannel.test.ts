import { setActivePinia, createPinia } from "pinia";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
	useQueryStore,
	CACHE_CHANNEL_NAME,
} from "@/lib/query_cache/queryStore";
import { toCacheKey } from "@/lib/query_cache/cacheKeys";

/*
	Cross tab invalidation. Tabs share localStorage and IndexedDB but not
	memory, so a save in one tab has to tell the others or they keep
	serving — and hydrating — the pre-save payload.
*/
const mocks = vi.hoisted(() => ({
	fetchPlan: vi.fn(),
	hydratePlan: vi.fn(),
	shouldDelay: vi.fn(),
}));

vi.mock("@/lib/query_cache/queryRepository", () => ({
	useQueryRepository: () => ({
		repository: {
			GetPlan: {
				key: (params: { planUuid: string }) => [
					"planningdata",
					"plan",
					params.planUuid,
				],
				persist: true,
				autoRefetch: false,
				fetchFn: mocks.fetchPlan,
				hydrateFn: mocks.hydratePlan,
			},
		},
	}),
}));

vi.mock("@/features/user_activity/userActivityStore", () => ({
	userActivity: { shouldDelay: mocks.shouldDelay },
}));

let store: ReturnType<typeof useQueryStore>;

/**
 * Stands in for another tab on the same browser.
 *
 * @returns {BroadcastChannel} Channel bound to the cache channel name
 */
function otherTab(): BroadcastChannel {
	return new BroadcastChannel(CACHE_CHANNEL_NAME);
}

/**
 * Lets queued channel messages and microtasks settle.
 *
 * @returns {Promise<void>} void
 */
async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.shouldDelay.mockReturnValue(false);
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	setActivePinia(createPinia());
	store = useQueryStore();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (params: unknown) => (store.execute as any)("GetPlan", params);

describe("query cache cross tab invalidation", () => {
	it("drops a cached plan when another tab reports saving it", async () => {
		mocks.hydratePlan.mockResolvedValue({ v: "pre-save" });
		mocks.fetchPlan.mockResolvedValue({ v: "post-save" });

		const hash: string = toCacheKey(["planningdata", "plan", "P1"]);

		expect(await exec({ planUuid: "P1" })).toStrictEqual({ v: "pre-save" });
		await settle();

		// the other tab saves and broadcasts its invalidation
		otherTab().postMessage({
			type: "invalidate",
			key: ["planningdata", "plan"],
			exact: false,
		});
		await settle();

		expect(store.cacheState[hash]).toBeUndefined();
	});

	it("refuses to re-hydrate a remotely invalidated key", async () => {
		/*
			The other tab's save never touched THIS tab's planningStore, so
			local storage here is still the pre-save plan. Hydration has to
			stay out of the way until the backend is asked again.
		*/
		mocks.hydratePlan.mockResolvedValue({ v: "pre-save" });
		mocks.fetchPlan.mockResolvedValue({ v: "post-save" });

		expect(await exec({ planUuid: "P2" })).toStrictEqual({ v: "pre-save" });
		await settle();

		otherTab().postMessage({
			type: "invalidate",
			key: ["planningdata", "plan"],
			exact: false,
		});
		await settle();

		expect(await exec({ planUuid: "P2" })).toStrictEqual({
			v: "post-save",
		});
	});

	it("does not refetch in the receiving tab, it waits for the next read", async () => {
		mocks.hydratePlan.mockResolvedValue({ v: "pre-save" });
		mocks.fetchPlan.mockResolvedValue({ v: "post-save" });

		await exec({ planUuid: "P3" });
		await settle();
		const callsBefore: number = mocks.fetchPlan.mock.calls.length;

		otherTab().postMessage({
			type: "invalidate",
			key: ["planningdata", "plan"],
			exact: false,
		});
		await settle();

		// a background tab has nothing on screen to refresh, and N tabs
		// stampeding after one save would be worse than a lazy refetch
		expect(mocks.fetchPlan.mock.calls.length).toBe(callsBefore);
	});

	it("clears the cache when another tab logs out", async () => {
		mocks.hydratePlan.mockResolvedValue({ v: "pre-save" });
		await exec({ planUuid: "P4" });
		await settle();
		expect(Object.keys(store.cacheState).length).toBeGreaterThan(0);

		otherTab().postMessage({ type: "reset" });
		await settle();

		expect(Object.keys(store.cacheState)).toHaveLength(0);
	});

	it("does not echo a received invalidation back onto the channel", async () => {
		const received: unknown[] = [];
		const listener = otherTab();
		listener.onmessage = (e) => received.push(e.data);

		otherTab().postMessage({
			type: "invalidate",
			key: ["planningdata", "plan"],
			exact: false,
		});
		await settle();

		// exactly the one message the peer sent, no echo from the store
		expect(received).toHaveLength(1);
	});
});
