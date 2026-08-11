import { setActivePinia, createPinia } from "pinia";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
	useQueryStore,
	CACHE_CHANNEL_NAME,
	IQueryCacheMessage,
} from "@/lib/query_cache/queryStore";
import { toCacheKey } from "@/lib/query_cache/cacheKeys";

/*
	Sharing a game data refresh between tabs. IndexedDB is shared, tab
	memory is not, so once one tab has fetched a payload and written it
	through, every other tab can rebuild it locally — telling them turns
	N tabs paying for the same megabyte into one paying for it.
*/

const mocks = vi.hoisted(() => ({
	fetchExchanges: vi.fn(),
	hydrateExchanges: vi.fn(),
	fetchProfile: vi.fn(),
	shouldDelay: vi.fn(),
}));

vi.mock("@/lib/query_cache/queryRepository", () => ({
	useQueryRepository: () => ({
		repository: {
			GetExchanges: {
				key: () => ["gamedata", "exchanges"],
				persist: true,
				autoRefetch: false,
				expireTime: 600_000,
				fetchFn: mocks.fetchExchanges,
				hydrateFn: mocks.hydrateExchanges,
			},
			// nothing local to rebuild from, so nothing to share
			GetPreferences: {
				key: () => ["user", "profile"],
				persist: true,
				autoRefetch: false,
				fetchFn: mocks.fetchProfile,
			},
		},
	}),
}));

vi.mock("@/features/user_activity/userActivityStore", () => ({
	userActivity: { shouldDelay: mocks.shouldDelay },
}));

const KEY: string = toCacheKey(["gamedata", "exchanges"]);

let store: ReturnType<typeof useQueryStore>;

function otherTab(): BroadcastChannel {
	return new BroadcastChannel(CACHE_CHANNEL_NAME);
}

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 5));
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = (name: string) => (store.execute as any)(name, undefined);

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

describe("cross tab game data refresh", () => {
	it("announces a refresh other tabs can rebuild from", async () => {
		const seen: IQueryCacheMessage[] = [];
		const listener = otherTab();
		listener.onmessage = (event) => seen.push(event.data);

		mocks.hydrateExchanges.mockResolvedValue(null);
		mocks.fetchExchanges.mockResolvedValue([{ ticker: "AAR" }]);

		await exec("GetExchanges");
		await settle();

		const refreshed = seen.filter((m) => m.type === "refreshed");

		expect(refreshed).toHaveLength(1);
		expect(refreshed[0].key).toStrictEqual(["gamedata", "exchanges"]);
		expect(refreshed[0].timestamp).toBe(store.cacheState[KEY].timestamp);
		expect(refreshed[0].expireTime).toBe(600_000);

		listener.close();
	});

	it("stays quiet for data no other tab could rebuild", async () => {
		const seen: IQueryCacheMessage[] = [];
		const listener = otherTab();
		listener.onmessage = (event) => seen.push(event.data);

		mocks.fetchProfile.mockResolvedValue({ name: "user" });

		await exec("GetPreferences");
		await settle();

		expect(seen.filter((m) => m.type === "refreshed")).toHaveLength(0);

		listener.close();
	});

	it("adopts another tab's fetch instead of repeating it", async () => {
		mocks.hydrateExchanges.mockResolvedValue([{ ticker: "AAR" }]);
		mocks.fetchExchanges.mockResolvedValue([{ ticker: "AAR" }]);

		// this tab has an entry of unknown age, restored from storage
		await exec("GetExchanges");
		await settle();

		const fetchesBefore: number = mocks.fetchExchanges.mock.calls.length;

		// the other tab fetched and wrote the shared IndexedDB
		const at: number = Date.now();
		otherTab().postMessage({
			type: "refreshed",
			key: ["gamedata", "exchanges"],
			timestamp: at,
			expireTime: 600_000,
		});
		await settle();

		// the in-memory copy is dropped, the recorded age is the other
		// tab's, and reading rebuilds from local storage
		expect(store.cacheMeta[KEY].timestamp).toBe(at);
		expect(store.cacheMeta[KEY].expireTime).toBe(600_000);

		expect(await exec("GetExchanges")).toStrictEqual([{ ticker: "AAR" }]);
		await settle();

		expect(mocks.fetchExchanges.mock.calls.length).toBe(fetchesBefore);
		expect(store.cacheState[KEY].timestamp).toBe(at);
	});

	it("leaves a key it knows nothing about alone", async () => {
		otherTab().postMessage({
			type: "refreshed",
			key: ["gamedata", "exchanges"],
			timestamp: Date.now(),
			expireTime: 600_000,
		});
		await settle();

		expect(store.cacheMeta[KEY]).toBeUndefined();
		expect(store.cacheState[KEY]).toBeUndefined();
	});

	it("does not disturb a fetch this tab is already running", async () => {
		mocks.hydrateExchanges.mockResolvedValue(null);

		let release: (value: unknown) => void = () => undefined;
		mocks.fetchExchanges.mockReturnValue(
			new Promise((resolve) => {
				release = resolve;
			})
		);

		const pending = exec("GetExchanges");
		await settle();

		expect(store.cacheState[KEY].loading).toBe(true);

		otherTab().postMessage({
			type: "refreshed",
			key: ["gamedata", "exchanges"],
			timestamp: Date.now(),
			expireTime: 600_000,
		});
		await settle();

		// still the in-flight entry, not dropped out from under it
		expect(store.cacheState[KEY].loading).toBe(true);

		release([{ ticker: "AAR" }]);

		expect(await pending).toStrictEqual([{ ticker: "AAR" }]);
	});
});
