/**
 * Opt out of the browser HTTP cache for the duration of a user
 * triggered refresh.
 *
 * Game data GETs are allowed to be served from the browser's disk cache
 * (see `ApiService.get`), which is what makes a repeat visit cost no
 * network at all. That is the right default and the wrong behaviour for
 * the refresh button: pressing it means "I do not care what you have,
 * ask the backend", and an XHR cannot ask for that per request the way
 * `fetch(url, { cache: "reload" })` can. Appending a throwaway query
 * parameter is the portable equivalent — a URL the cache has never seen
 * cannot be answered from it.
 *
 * Kept apart from both the API client and the query cache so neither
 * has to depend on the other.
 *
 * @author raukk
 */

let depth: number = 0;

/**
 * Opens a bypass window. Nestable, so concurrent refreshes cannot end
 * each other's window early; the returned release is idempotent.
 *
 * @author raukk
 *
 * @returns {() => void} Closes this window
 */
export function beginHttpCacheBypass(): () => void {
	depth += 1;

	let released: boolean = false;

	return () => {
		if (released) return;
		released = true;
		depth = Math.max(0, depth - 1);
	};
}

/**
 * True while any bypass window is open.
 *
 * @author raukk
 *
 * @returns {boolean} Requests should skip the browser cache
 */
export function isHttpCacheBypassed(): boolean {
	return depth > 0;
}

/**
 * Adds a cache busting parameter to a path while a bypass is open.
 *
 * @author raukk
 *
 * @param {string} path Request path
 * @returns {string} Path, busted if a bypass is open
 */
export function withHttpCacheBypass(path: string): string {
	if (!isHttpCacheBypassed()) return path;

	return `${path}${path.includes("?") ? "&" : "?"}_cb=${Date.now()}`;
}
