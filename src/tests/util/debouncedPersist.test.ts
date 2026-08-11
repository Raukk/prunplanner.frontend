import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createApp, nextTick } from "vue";

// Util
import {
	createDebouncedPersistedState,
	installDebouncedPersist,
} from "@/util/debouncedPersist";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";

const STORE_KEY: string = "prunplanner_raukk_sourcing";

/**
 * Creates the pinia the app creates: with the debounced persistence
 * plugin registered, so the store option takes effect. Pinia only moves
 * a plugin from its pending list into the active one on `app.use`, so a
 * throwaway app is needed to install it.
 */
function setupPinia(): void {
	const pinia = createPinia().use(createDebouncedPersistedState());

	createApp({}).use(pinia);
	setActivePinia(pinia);
}

describe("debouncedPersist", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("hydration", () => {
		it("hydrates from a payload the persistedstate plugin wrote", () => {
			// exact shape of the plugin: JSON of the picked top level keys
			localStorage.setItem(
				STORE_KEY,
				JSON.stringify({
					configs: {
						a: { repairDay: 42, sources: {} },
					},
					fleetSpillover: false,
				})
			);

			setupPinia();
			const store = useRaukkSourcingStore();

			// synchronously available, no tick awaited
			expect(store.configs.a.repairDay).toBe(42);
			expect(store.fleetSpillover).toBe(false);
		});

		it("survives a corrupt payload", () => {
			const spy = vi.spyOn(console, "error").mockImplementation(() => {});

			localStorage.setItem(STORE_KEY, "{ not json");

			setupPinia();
			const store = useRaukkSourcingStore();

			expect(store.configs).toStrictEqual({});
			expect(spy).toHaveBeenCalled();

			spy.mockRestore();
		});

		it("ignores keys outside the pick list", () => {
			localStorage.setItem(
				STORE_KEY,
				JSON.stringify({ configs: {}, notPersisted: 1 })
			);

			setupPinia();
			const store = useRaukkSourcingStore();

			expect(
				(store as unknown as Record<string, unknown>).notPersisted
			).toBeUndefined();
		});
	});

	describe("writing", () => {
		it("coalesces N mutations into one write", async () => {
			setupPinia();
			const store = useRaukkSourcingStore();

			const spy = vi.spyOn(Storage.prototype, "setItem");

			for (let i = 0; i < 25; i++) {
				store.setRepairDay(`plan-${i}`, i + 1);
				await nextTick();
			}

			// nothing written yet, the window is still open
			expect(spy).not.toHaveBeenCalled();

			vi.advanceTimersByTime(1000);

			expect(spy).toHaveBeenCalledTimes(1);

			const written = JSON.parse(
				localStorage.getItem(STORE_KEY) as string
			);
			expect(Object.keys(written.configs).length).toBe(25);
			expect(written.configs["plan-24"].repairDay).toBe(25);

			spy.mockRestore();
		});

		it("writes only the picked keys", async () => {
			setupPinia();
			const store = useRaukkSourcingStore();

			store.setRepairDay("a", 3);
			await nextTick();
			vi.advanceTimersByTime(1000);

			const written = JSON.parse(
				localStorage.getItem(STORE_KEY) as string
			);
			expect(Object.keys(written).sort()).toStrictEqual(
				[
					"assignments",
					"chainConfig",
					"chainResults",
					"chains",
					"configs",
					"depots",
					"fleet",
					"fleetSpillover",
					"plannedGates",
					"shipProfiles",
					"shipSourcing",
					"shippingConfig",
					"snapshots",
					"sourcingDefaults",
				].sort()
			);
		});

		it("opens a new window after a write", async () => {
			setupPinia();
			const store = useRaukkSourcingStore();

			const spy = vi.spyOn(Storage.prototype, "setItem");

			store.setRepairDay("a", 3);
			await nextTick();
			vi.advanceTimersByTime(1000);
			expect(spy).toHaveBeenCalledTimes(1);

			store.setRepairDay("b", 4);
			await nextTick();
			vi.advanceTimersByTime(1000);
			expect(spy).toHaveBeenCalledTimes(2);

			spy.mockRestore();
		});
	});

	describe("flushing", () => {
		it("flushes a pending write on pagehide", async () => {
			setupPinia();
			const store = useRaukkSourcingStore();

			store.setRepairDay("a", 7);
			await nextTick();

			expect(localStorage.getItem(STORE_KEY)).toBeNull();

			window.dispatchEvent(new Event("pagehide"));

			const written = JSON.parse(
				localStorage.getItem(STORE_KEY) as string
			);
			expect(written.configs.a.repairDay).toBe(7);
		});

		it("flushes a pending write when the document hides", async () => {
			setupPinia();
			const store = useRaukkSourcingStore();

			store.setRepairDay("a", 7);
			await nextTick();

			vi.spyOn(document, "visibilityState", "get").mockReturnValue(
				"hidden"
			);
			document.dispatchEvent(new Event("visibilitychange"));

			expect(localStorage.getItem(STORE_KEY)).not.toBeNull();

			vi.restoreAllMocks();
		});

		it("does not write on pagehide without a pending mutation", () => {
			setupPinia();
			useRaukkSourcingStore();

			const spy = vi.spyOn(Storage.prototype, "setItem");
			window.dispatchEvent(new Event("pagehide"));

			expect(spy).not.toHaveBeenCalled();
			spy.mockRestore();
		});

		it("persists a reset immediately", async () => {
			localStorage.setItem(
				STORE_KEY,
				JSON.stringify({
					configs: { a: { repairDay: 42, sources: {} } },
				})
			);

			setupPinia();
			const store = useRaukkSourcingStore();
			expect(store.configs.a).toBeDefined();

			store.$reset();

			// no timer advanced: the reset state is on disk already
			const written = JSON.parse(
				localStorage.getItem(STORE_KEY) as string
			);
			expect(written.configs).toStrictEqual({});
		});
	});

	describe("options", () => {
		it("uses the store id as default key and honours delay", async () => {
			setActivePinia(createPinia());
			const store = useRaukkSourcingStore();

			const handle = installDebouncedPersist(store, {
				pick: ["configs"],
				delay: 50,
			});

			store.setRepairDay("a", 1);
			await nextTick();

			vi.advanceTimersByTime(49);
			expect(localStorage.getItem(STORE_KEY)).toBeNull();

			vi.advanceTimersByTime(1);
			expect(localStorage.getItem(STORE_KEY)).not.toBeNull();

			handle.dispose();
		});

		it("writes to a custom key and storage", async () => {
			setActivePinia(createPinia());
			const store = useRaukkSourcingStore();

			const storage = {
				getItem: vi.fn().mockReturnValue(null),
				setItem: vi.fn(),
			};

			const handle = installDebouncedPersist(store, {
				key: "custom_key",
				pick: ["configs"],
				storage,
			});

			expect(storage.getItem).toHaveBeenCalledWith("custom_key");

			store.setRepairDay("a", 1);
			await nextTick();
			vi.advanceTimersByTime(1000);

			expect(storage.setItem).toHaveBeenCalledTimes(1);
			expect(storage.setItem.mock.calls[0][0]).toBe("custom_key");
			expect(
				Object.keys(JSON.parse(storage.setItem.mock.calls[0][1]))
			).toStrictEqual(["configs"]);

			handle.dispose();
		});

		it("stops writing after dispose", async () => {
			setActivePinia(createPinia());
			const store = useRaukkSourcingStore();

			const storage = {
				getItem: vi.fn().mockReturnValue(null),
				setItem: vi.fn(),
			};

			const handle = installDebouncedPersist(store, {
				key: "custom_key",
				pick: ["configs"],
				storage,
			});

			handle.dispose();

			store.setRepairDay("a", 1);
			await nextTick();
			vi.advanceTimersByTime(1000);

			expect(storage.setItem).not.toHaveBeenCalled();
		});
	});
});
