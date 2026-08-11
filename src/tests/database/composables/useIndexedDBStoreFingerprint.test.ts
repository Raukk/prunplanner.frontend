import { describe, it, expect, beforeEach } from "vitest";

import config from "@/lib/config";
import {
	resetDB,
	useIndexedDBStore,
} from "@/database/composables/useIndexedDBStore";

import { IMaterial } from "@/features/api/gameData.types";

/*
	Skipping a rewrite that would change nothing. A game data refresh
	normally brings back exactly what is already stored, and rewriting it
	clears and re-puts every record and then swaps the map every reader
	resolves through.
*/

function material(ticker: string, weight: number = 1): IMaterial {
	return {
		material_id: `id-${ticker}`,
		category_name: "category",
		category_id: "category-id",
		name: ticker,
		ticker,
		weight,
		volume: 1,
	};
}

const store = useIndexedDBStore<IMaterial, "ticker">(
	"gamedata_materials",
	"ticker"
);

beforeEach(async () => {
	await indexedDB.deleteDatabase(config.INDEXEDDB_DBNAME);
	resetDB();
	localStorage.clear();
});

describe("setManyIfChanged", () => {
	it("writes on the first call", async () => {
		const written = await store.setManyIfChanged([material("AAR")], true);

		expect(written).toBe(true);
		expect(await store.getAll()).toHaveLength(1);
	});

	it("skips an identical payload", async () => {
		const payload = [material("AAR"), material("BSE")];

		expect(await store.setManyIfChanged(payload, true)).toBe(true);
		expect(await store.setManyIfChanged(payload, true)).toBe(false);
	});

	it("writes when a single field moved", async () => {
		expect(await store.setManyIfChanged([material("AAR", 1)], true)).toBe(
			true
		);
		expect(await store.setManyIfChanged([material("AAR", 2)], true)).toBe(
			true
		);

		expect((await store.get("AAR"))?.weight).toBe(2);
	});

	it("writes when a record was added", async () => {
		expect(await store.setManyIfChanged([material("AAR")], true)).toBe(
			true
		);
		expect(
			await store.setManyIfChanged([material("AAR"), material("BSE")], true)
		).toBe(true);

		expect(await store.getAll()).toHaveLength(2);
	});

	it("writes when the store was emptied behind its back", async () => {
		/*
			A database version upgrade drops and recreates every object
			store while the fingerprint survives in localStorage. Trusting
			it alone would leave the store permanently empty.
		*/
		const payload = [material("AAR")];

		expect(await store.setManyIfChanged(payload, true)).toBe(true);

		await store.remove("AAR");
		expect(await store.count()).toBe(0);

		expect(await store.setManyIfChanged(payload, true)).toBe(true);
		expect(await store.getAll()).toHaveLength(1);
	});

	it("rewrites when the fingerprint is unavailable", async () => {
		const payload = [material("AAR")];

		expect(await store.setManyIfChanged(payload, true)).toBe(true);

		// storage cleared, e.g. private mode: correctness over the saving
		localStorage.clear();

		expect(await store.setManyIfChanged(payload, true)).toBe(true);
	});
});
