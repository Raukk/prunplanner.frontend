import { toRaw, isRef } from "vue";

/**
 * Deep-unwraps reactive proxies into plain arrays and objects.
 *
 * `toRaw` only unwraps the value it is handed. A plain array whose
 * members are reactive, which is what `Object.values(someStoreRecord)`
 * produces, therefore still carries proxies, and structuredClone rejects
 * a proxy with "#<Object> could not be cloned".
 *
 * Only arrays and plain objects are rebuilt. Everything else, Date, Map,
 * Set and friends, is handed back untouched for structuredClone to deal
 * with natively.
 *
 * @author raukk
 *
 * @template T Value type
 * @param {T} value Value, possibly holding proxies at any depth
 * @param {WeakMap<object, unknown>} seen Cycle guard
 * @returns {T} Proxy-free value
 */
function rawDeep<T>(
	value: T,
	seen: WeakMap<object, unknown> = new WeakMap()
): T {
	const raw: unknown = toRaw(isRef(value) ? value.value : value);

	if (raw === null || typeof raw !== "object") return raw as T;

	const known = seen.get(raw);
	if (known !== undefined) return known as T;

	if (Array.isArray(raw)) {
		const copy: unknown[] = [];
		seen.set(raw, copy);
		raw.forEach((item) => copy.push(rawDeep(item, seen)));
		return copy as T;
	}

	// non plain objects (Date, Map, Set, ...) clone natively
	const proto = Object.getPrototypeOf(raw);
	if (proto !== Object.prototype && proto !== null) return raw as T;

	const copy: Record<string, unknown> = {};
	seen.set(raw, copy);
	Object.entries(raw).forEach(([key, item]) => {
		copy[key] = rawDeep(item, seen);
	});
	return copy as T;
}

/**
 * Deep-clones a ref/reactive value into a completely inert (non-proxy) copy.
 *
 * - Uses native structuredClone when available (fastest, handles Map/Set/Date/etc).
 * - Falls back to shallow slice/object-spread for arrays/objects if structuredClone is missing.
 * - Immediately returns primitives & nulls without overhead.
 *
 * @author jplacht
 *
 * @type {<T>(value: T) => T}
 */
export const inertClone = (() => {
	const canStructuredClone = typeof structuredClone === "function";

	// Fallback for non-structuredClone environments:
	function fallbackClone<T>(raw: T): T {
		if (Array.isArray(raw)) {
			return raw.slice() as T;
		}
		// You can tighten this check to only plain objects if you like:
		if (raw !== null && typeof raw === "object") {
			return { ...raw } as T;
		}
		return raw as T;
	}

	if (canStructuredClone) {
		// Fast branch: always structuredClone
		// structuredClone deep-copies EVERYTHING natively
		return function <T>(value: T): T {
			const unwrapped = isRef(value) ? value.value : value;
			const raw = toRaw(unwrapped) as unknown;

			// fallback, as functions can't be cloned
			if (
				raw === null ||
				typeof raw !== "object" ||
				typeof raw === "function"
			) {
				return raw as T;
			}

			try {
				return structuredClone(raw) as T;
			} catch {
				/*
					A nested proxy, which `toRaw` above cannot reach,
					makes structuredClone throw a DataCloneError. Pay for
					the deep unwrap only when that happens, the hot path
					stays a single native call.
				*/
				return structuredClone(rawDeep(raw)) as T;
			}
		};
	} else {
		// Slower branch: primitives/arrays/objects only
		return function <T>(value: T): T {
			// Unwrap
			const unwrapped = isRef(value) ? value.value : value;
			// toRaw: drop proxy
			const raw = toRaw(unwrapped) as unknown;

			// Primitives & null → return immediately
			if (
				raw === null ||
				(typeof raw !== "object" && typeof raw !== "function")
			) {
				return raw as T;
			}

			// Fallback clone
			return fallbackClone<T>(raw as T);
		};
	}
})();

/**
 * Copies string value to users clipboard
 * @author jplacht
 *
 * @export
 * @param {string} value Text
 */
export function copyToClipboard(value: string): void {
	navigator.clipboard.writeText(value);
}

/**
 * Recursively walk `obj` and replace any property whose key
 * is in `keysToRedact` with '***'.
 */
export function redact<T>(obj: T, keysToRedact: string[]): T {
	// array, redact all items
	if (Array.isArray(obj)) {
		return obj.map((item) => redact(item, keysToRedact)) as T;
	}

	if (obj !== null && typeof obj === "object") {
		return Object.entries(obj).reduce(
			(acc, [key, value]) => {
				if (keysToRedact.includes(key)) {
					// replace the field

					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(acc as any)[key] = "***";
				} else {
					// recursive into nested objects/arrays
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					(acc as any)[key] = redact(value, keysToRedact);
				}
				return acc;
			},
			Array.isArray(obj) ? [] : {}
		) as T;
	}

	// primitive value
	return obj;
}

export function deepClone<T>(obj: T): T {
	const raw = toRaw(obj);

	if (typeof structuredClone !== "function")
		return JSON.parse(JSON.stringify(raw));

	try {
		return structuredClone(raw);
	} catch {
		// see inertClone: a nested proxy is not cloneable
		return structuredClone(rawDeep(raw));
	}
}

export async function getObjectSize(obj: unknown): Promise<number> {
	return new Blob([JSON.stringify(obj)]).size / 1024 / 1024;
}
