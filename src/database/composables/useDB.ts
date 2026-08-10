import { Ref, ref } from "vue";

import { useIndexedDBStore } from "@/database/composables/useIndexedDBStore";

type SharedState<T extends object> = {
	allData: ReturnType<typeof ref<T[]>>;
	cache: Map<string, T>;
	loaded: boolean;
	/** Outstanding `hold()` calls, see there. */
	holds: number;
	/** A refresh arrived while held and still has to be applied. */
	pendingRefresh: boolean;
};

const storeStateMap = new WeakMap<
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ReturnType<typeof useIndexedDBStore<any, any>>,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	SharedState<any>
>();

// Ensures a store is created and stored in the map
function ensureState<T extends object, K extends keyof T & string>(
	store: ReturnType<typeof useIndexedDBStore<T, K>>
): SharedState<T> {
	let state = storeStateMap.get(store) as SharedState<T> | undefined;
	if (!state) {
		state = {
			allData: ref<T[]>([]) as Ref<T[]>,
			cache: new Map<string, T>(),
			loaded: false,
			holds: 0,
			pendingRefresh: false,
		};
		storeStateMap.set(store, state);
	}
	return state;
}

export function useDB<T extends object, K extends keyof T & string>(
	store: ReturnType<typeof useIndexedDBStore<T, K>>
) {
	// The key prop literal type
	type KeyProp = typeof store.keyPath extends keyof T
		? typeof store.keyPath
		: never;

	// The type of the key itself
	type KeyType = T[KeyProp] extends IDBValidKey ? T[KeyProp] : never;

	const state = ensureState(store);

	async function preload(force: boolean = false) {
		// skip if already loaded
		if (!force && state.loaded) return;

		/*
			A refresh replaces the shared map every reader resolves
			through. Swapping it while a multi step calculation is running
			would price the steps before the swap from one snapshot of the
			market and the steps after it from another, and the totals are
			then a mix of both. Defer it until the caller lets go. Only a
			REFRESH is deferred: with nothing loaded yet there is nothing
			to be consistent with, and holding would starve the readers.
		*/
		if (state.loaded && state.holds > 0) {
			state.pendingRefresh = true;
			return;
		}

		const all = await store.getAll();

		state.allData.value = all;
		state.cache.clear();

		for (const item of all) {
			// @ts-expect-error keyPath dynamically
			state.cache.set(item[store.keyPath], item);
		}

		state.loaded = true;
	}

	/**
	 * Pins the currently loaded data so a background refresh cannot swap
	 * it mid-calculation. Returns the release, which applies any refresh
	 * that arrived while held. Nestable — the data unpins once every
	 * holder has released.
	 *
	 * @author jplacht
	 *
	 * @returns {() => Promise<void>} Release the hold
	 */
	function hold(): () => Promise<void> {
		state.holds++;
		let released: boolean = false;

		return async () => {
			if (released) return;
			released = true;
			state.holds--;

			if (state.holds === 0 && state.pendingRefresh) {
				state.pendingRefresh = false;
				await preload(true);
			}
		};
	}

	async function get(key: KeyType): Promise<T | undefined> {
		// return from cache
		if (state.cache.has(key as string))
			return state.cache.get(key as string)! as T;

		// check in database
		const item = await store.get(key);
		if (item) state.cache.set(key as string, item);
		return item as T;
	}

	return {
		allData: state.allData,
		cacheData: state.cache,
		preload,
		hold,
		get,
	};
}
