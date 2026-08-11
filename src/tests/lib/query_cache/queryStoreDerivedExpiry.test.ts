import { setActivePinia, createPinia } from "pinia";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { useQueryStore } from "@/lib/query_cache/queryStore";
import { toCacheKey } from "@/lib/query_cache/cacheKeys";

/*
	Expiry derived from the payload. Exchange data is a daily close that
	names the day it describes, so it should expire on that day rolling
	over rather than a fixed span after whenever it was loaded.
*/

const mocks = vi.hoisted(() => ({
	fetchDaily: vi.fn(),
	hydrateDaily: vi.fn(),
	expireTime: vi.fn(),
	shouldDelay: vi.fn(),
}));

vi.mock("@/lib/query_cache/queryRepository", () => ({
	useQueryRepository: () => ({
		repository: {
			GetDaily: {
				key: () => ["gamedata", "daily"],
				persist: true,
				autoRefetch: false,
				fetchFn: mocks.fetchDaily,
				hydrateFn: mocks.hydrateDaily,
				expireTime: mocks.expireTime,
			},
		},
	}),
}));

vi.mock("@/features/user_activity/userActivityStore", () => ({
	userActivity: { shouldDelay: mocks.shouldDelay },
}));

const KEY: string = toCacheKey(["gamedata", "daily"]);

let store: ReturnType<typeof useQueryStore>;

/** Lets queued microtasks settle. */
async function settle(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const exec = () => (store.execute as any)("GetDaily", undefined);

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

describe("payload derived expireTime", () => {
	it("resolves the expiry against the fetched payload", async () => {
		mocks.hydrateDaily.mockResolvedValue(null);
		mocks.fetchDaily.mockResolvedValue({ day: 3 });
		mocks.expireTime.mockReturnValue(90_000);

		await exec();
		await settle();

		expect(mocks.expireTime).toHaveBeenCalledWith(
			{ day: 3 },
			expect.any(Number)
		);
		expect(store.cacheState[KEY].expireTime).toBe(90_000);
	});

	it("measures the ttl from the fetch timestamp, not from resolve time", async () => {
		mocks.hydrateDaily.mockResolvedValue(null);
		mocks.fetchDaily.mockResolvedValue({ day: 3 });
		mocks.expireTime.mockReturnValue(90_000);

		await exec();
		await settle();

		const [, since] = mocks.expireTime.mock.calls[0];

		expect(since).toBe(store.cacheState[KEY].timestamp);
	});

	it("persists the resolved value so a later session knows it", async () => {
		mocks.hydrateDaily.mockResolvedValue(null);
		mocks.fetchDaily.mockResolvedValue({ day: 3 });
		mocks.expireTime.mockReturnValue(120_000);

		await exec();
		await settle();

		expect(store.cacheMeta[KEY].expireTime).toBe(120_000);
	});

	it("re-resolves against the payload restored from local storage", async () => {
		/*
			A hydrated entry has to land on the boundary its payload
			implies, not on a fresh full span: the data is as old as it
			was when it was written, whatever this session's clock says.
		*/
		mocks.hydrateDaily.mockResolvedValue({ day: 1 });
		mocks.fetchDaily.mockResolvedValue({ day: 1 });
		mocks.expireTime.mockReturnValue(30_000);

		await exec();
		await settle();

		expect(mocks.expireTime).toHaveBeenCalledWith(
			{ day: 1 },
			expect.any(Number)
		);
		expect(store.cacheState[KEY].expireTime).toBe(30_000);
	});

	it("serves fresh derived data without going back to the backend", async () => {
		mocks.hydrateDaily.mockResolvedValue(null);
		mocks.fetchDaily.mockResolvedValue({ day: 3 });
		mocks.expireTime.mockReturnValue(600_000);

		await exec();
		await settle();
		await exec();
		await settle();

		expect(mocks.fetchDaily).toHaveBeenCalledTimes(1);
	});

	it("revalidates once the derived expiry has passed", async () => {
		mocks.hydrateDaily.mockResolvedValue(null);
		mocks.fetchDaily.mockResolvedValue({ day: 3 });
		// already expired the moment it is written
		mocks.expireTime.mockReturnValue(0);

		await exec();
		await settle();
		await exec();
		await settle();

		expect(mocks.fetchDaily).toHaveBeenCalledTimes(2);
	});

	it("survives an expiry function that throws", async () => {
		mocks.hydrateDaily.mockResolvedValue(null);
		mocks.fetchDaily.mockResolvedValue({ day: 3 });
		mocks.expireTime.mockImplementation(() => {
			throw new Error("bad anchor");
		});

		await expect(exec()).resolves.toStrictEqual({ day: 3 });
		await settle();

		expect(store.cacheState[KEY].expireTime).toBeUndefined();
	});

	it("ignores a non finite expiry", async () => {
		mocks.hydrateDaily.mockResolvedValue(null);
		mocks.fetchDaily.mockResolvedValue({ day: 3 });
		mocks.expireTime.mockReturnValue(Number.NaN);

		await exec();
		await settle();

		expect(store.cacheState[KEY].expireTime).toBeUndefined();
	});
});
