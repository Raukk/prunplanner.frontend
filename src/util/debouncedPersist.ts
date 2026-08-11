import { PiniaPluginContext, Store, StateTree } from "pinia";

/**
 * Options of the debounced persistence, declared per store as the
 * `debouncedPersist` option of `defineStore`.
 */
export interface IDebouncedPersistOptions {
	/**
	 * Storage key. Defaults to the store id, which is the same default
	 * `pinia-plugin-persistedstate` uses — leaving it out keeps an
	 * existing localStorage payload readable.
	 */
	key?: string;
	/**
	 * Top level state keys to persist. Keys missing from this list are
	 * never written, exactly like the plugin's `pick`. Dotted sub paths
	 * are NOT supported, top level names only.
	 */
	pick: string[];
	/** Coalescing window in milliseconds. Default 1000. */
	delay?: number;
	/** Storage to write to. Defaults to `window.localStorage`. */
	storage?: IPersistStorage;
	/**
	 * Action names that force an immediate write once they returned.
	 * Default `["$reset"]`, so a logout can't be resurrected by a
	 * reload landing inside the coalescing window.
	 */
	flushOn?: string[];
}

/** The synchronous subset of the Web Storage API that is used. */
export interface IPersistStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
}

/** Handle of an installed persistence, mainly for tests. */
export interface IDebouncedPersistHandle {
	/** Writes now, if a write is pending. */
	flush: () => void;
	/** Drops a pending write without writing it. */
	cancel: () => void;
	/** Removes the subscription and the document level flush hooks. */
	dispose: () => void;
}

declare module "pinia" {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	interface DefineStoreOptionsBase<S extends StateTree, Store> {
		/**
		 * Persist the store to storage, serializing at most once per
		 * `delay` instead of once per mutation.
		 */
		debouncedPersist?: IDebouncedPersistOptions;
	}
}

const DEFAULT_DELAY: number = 1000;

/**
 * Every installed persistence that may hold a pending write, keyed by
 * its storage key. Re-installing on the same key (a second pinia in a
 * test run) replaces the entry instead of piling up.
 */
const pending: Map<string, () => void> = new Map();

let hooksInstalled: boolean = false;

/**
 * Writes every pending payload. Bound to the document events that a
 * closing or backgrounded tab fires, so an unflushed coalescing window
 * can't lose the last mutations.
 * @author raukk
 */
function flushAll(): void {
	pending.forEach((flush) => flush());
}

/**
 * Installs the document level flush hooks, once per document.
 * @author raukk
 */
function installFlushHooks(): void {
	if (hooksInstalled) return;
	if (typeof window === "undefined") return;

	hooksInstalled = true;

	window.addEventListener("pagehide", flushAll);
	window.addEventListener("beforeunload", flushAll);
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") flushAll();
	});
}

/**
 * Picks the persisted subset out of a store state. Mirrors the
 * `deepPick` of `pinia-plugin-persistedstate` for top level keys:
 * `undefined` values are dropped, everything else is kept as is.
 * @author raukk
 *
 * @param {StateTree} state Full store state
 * @param {string[]} pick Top level keys to keep
 * @returns {StateTree} Picked state
 */
function pickState(state: StateTree, pick: string[]): StateTree {
	const picked: StateTree = {};

	pick.forEach((key) => {
		if (state[key] !== undefined) picked[key] = state[key];
	});

	return picked;
}

/**
 * Persists a store to storage, serializing at most once per coalescing
 * window instead of once per mutation.
 *
 * On install the stored payload is read and `$patch`ed into the store,
 * synchronously, which is the same hydration the persistedstate plugin
 * does and at the same point in the store's life: right after its setup
 * ran, before `useStore()` returns to its first caller.
 *
 * Afterwards a mutation only arms a timer. The first mutation of a
 * window schedules the write, the ones following it fall into the same
 * window and cost nothing — a sweep spraying thousands of writes across
 * the state serializes once, not thousands of times. The timer is not
 * restarted per mutation on purpose: a continuously mutating store
 * would otherwise never write at all.
 *
 * Key and payload shape are identical to what
 * `pinia-plugin-persistedstate` wrote, so swapping a store over keeps
 * reading and writing the localStorage of its existing users.
 * @author raukk
 *
 * @param {Store} store Store to persist
 * @param {IDebouncedPersistOptions} options Persistence options
 * @returns {IDebouncedPersistHandle} Flush, cancel and dispose handle
 */
export function installDebouncedPersist(
	store: Store,
	options: IDebouncedPersistOptions
): IDebouncedPersistHandle {
	const key: string = options.key ?? store.$id;
	const delay: number = options.delay ?? DEFAULT_DELAY;
	const flushOn: string[] = options.flushOn ?? ["$reset"];
	const storage: IPersistStorage | undefined =
		options.storage ??
		(typeof window !== "undefined" ? window.localStorage : undefined);

	if (!storage) {
		return {
			flush: () => {},
			cancel: () => {},
			dispose: () => {},
		};
	}

	// hydration, synchronous and before anything reads the store
	try {
		const stored: string | null = storage.getItem(key);

		if (stored) {
			store.$patch(pickState(JSON.parse(stored), options.pick));
		}
	} catch (error) {
		console.error("[debouncedPersist] hydration failed", key, error);
	}

	let timer: ReturnType<typeof setTimeout> | undefined = undefined;

	function write(): void {
		try {
			storage!.setItem(
				key,
				JSON.stringify(pickState(store.$state, options.pick))
			);
		} catch (error) {
			console.error("[debouncedPersist] write failed", key, error);
		}
	}

	function cancel(): void {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
	}

	function flush(): void {
		if (timer === undefined) return;

		cancel();
		write();
	}

	function schedule(): void {
		if (timer !== undefined) return;

		timer = setTimeout(() => {
			timer = undefined;
			write();
		}, delay);
	}

	const stopSubscription = store.$subscribe(() => schedule(), {
		detached: true,
	});

	const stopActions = store.$onAction(({ name, after }) => {
		if (!flushOn.includes(name)) return;

		after(() => {
			cancel();
			write();
		});
	});

	pending.set(key, flush);
	installFlushHooks();

	return {
		flush,
		cancel,
		dispose: () => {
			cancel();
			stopSubscription();
			stopActions();

			if (pending.get(key) === flush) pending.delete(key);
		},
	};
}

/**
 * Pinia plugin enabling {@link installDebouncedPersist} for every store
 * declaring a `debouncedPersist` option.
 * @author raukk
 *
 * @returns {Function} Pinia plugin
 */
export function createDebouncedPersistedState(): (
	context: PiniaPluginContext
) => void {
	return function (context: PiniaPluginContext): void {
		const options: IDebouncedPersistOptions | undefined =
			context.options.debouncedPersist;

		if (!options) return;

		installDebouncedPersist(context.store, options);
	};
}
