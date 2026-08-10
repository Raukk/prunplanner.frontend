import { describe, it, expect, beforeEach } from "vitest";

import { useDB } from "@/database/composables/useDB";
import { useIndexedDBStore } from "@/database/composables/useIndexedDBStore";
import { resetDB } from "@/database/composables/useIndexedDBStore";

interface IThing {
	ticker: string;
	price: number;
}

/*
	A fresh store handle per test. useDB keys its shared in memory state
	by the handle object, so reusing one would carry `loaded` and the
	cache across tests and every hold assertion would read the previous
	test's snapshot.
*/
function freshStore() {
	return useIndexedDBStore<IThing, "ticker">(
		"gamedata_materials",
		"ticker" as const
	);
}

beforeEach(async () => {
	await resetDB();
});

describe("useDB hold", () => {
	it("defers a refresh while held and applies it on release", async () => {
		const thingStore = freshStore();
		const db = useDB(thingStore);

		await thingStore.setMany([{ ticker: "RAT", price: 100 }], true);
		await db.preload(true);
		expect(db.cacheData.get("RAT")?.price).toBe(100);

		const release = db.hold();

		// a background refresh lands mid calculation
		await thingStore.setMany([{ ticker: "RAT", price: 999 }], true);
		await db.preload(true);

		// readers still see one consistent snapshot
		expect(db.cacheData.get("RAT")?.price).toBe(100);

		await release();

		// and the refresh is not lost
		expect(db.cacheData.get("RAT")?.price).toBe(999);
	});

	it("never defers the very first load, which would starve readers", async () => {
		const thingStore = freshStore();
		const db = useDB(thingStore);
		const release = db.hold();

		await thingStore.setMany([{ ticker: "DW", price: 50 }], true);
		await db.preload(true);

		// nothing was loaded yet, so there is no snapshot to protect
		expect(db.cacheData.get("DW")?.price).toBe(50);
		await release();
	});

	it("stays held until every holder releases", async () => {
		const thingStore = freshStore();
		const db = useDB(thingStore);

		await thingStore.setMany([{ ticker: "RAT", price: 1 }], true);
		await db.preload(true);

		const releaseA = db.hold();
		const releaseB = db.hold();

		await thingStore.setMany([{ ticker: "RAT", price: 2 }], true);
		await db.preload(true);

		await releaseA();
		expect(db.cacheData.get("RAT")?.price).toBe(1);

		await releaseB();
		expect(db.cacheData.get("RAT")?.price).toBe(2);
	});

	it("ignores a double release", async () => {
		const thingStore = freshStore();
		const db = useDB(thingStore);

		await thingStore.setMany([{ ticker: "RAT", price: 1 }], true);
		await db.preload(true);

		const release = db.hold();
		await release();
		await release();

		// a second release must not drive the count negative, which
		// would leave the store permanently unable to hold
		const second = db.hold();
		await thingStore.setMany([{ ticker: "RAT", price: 7 }], true);
		await db.preload(true);
		expect(db.cacheData.get("RAT")?.price).toBe(1);
		await second();
		expect(db.cacheData.get("RAT")?.price).toBe(7);
	});
});
