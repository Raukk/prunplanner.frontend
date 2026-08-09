import { describe, it, expect } from "vitest";
import AxiosMockAdapter from "axios-mock-adapter";

import { callFIOPlanetFees, fioApiService } from "@/features/api/fioData.api";

// test data
import fio_planet from "@/tests/test_data/fio_planet_zv759c.json";

// mock fio client, replaces the global 404 adapter from vitest.setup
const mock = new AxiosMockAdapter(fioApiService.client);

describe("FIO Data API Calls", async () => {
	it("callFIOPlanetFees transforms fee data", async () => {
		mock.onGet("/planet/ZV-759c").reply(200, fio_planet);

		const result = await callFIOPlanetFees("ZV-759c");

		expect(result.planet_natural_id).toBe("ZV-759c");
		expect(result.currency_code).toBe("AIC");
		expect(result.governing_entity).toBe(
			"1b81c07f3b494dd39b3c9f6b8ac1e5bf"
		);
		expect(result.base_local_market_fee).toBe(50);
		expect(result.local_market_fee_factor).toBe(3);
		expect(result.warehouse_fee).toBe(100);
		expect(result.establishment_fee).toBe(0);

		expect(result.production_fees["METALLURGY"]).toStrictEqual({
			pioneer: 50,
			settler: 80,
			technician: 140,
			engineer: 800,
			scientist: 1500,
		});
		expect(result.production_fees["AGRICULTURE"]).toStrictEqual({
			pioneer: 50,
		});
	});

	it("callFIOPlanetFees skips unknown workforce levels", async () => {
		mock.onGet("/planet/ZV-759c").reply(200, fio_planet);

		const result = await callFIOPlanetFees("ZV-759c");

		expect(
			Object.values(result.production_fees["METALLURGY"] ?? {})
		).not.toContain(9999);
	});

	it("callFIOPlanetFees throws on error responses", async () => {
		mock.onGet("/planet/XX-000x").reply(404);

		await expect(callFIOPlanetFees("XX-000x")).rejects.toThrowError();
	});
});
