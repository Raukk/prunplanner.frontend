export type JSONObject = { [key: string]: JSONValue };
export type JSONValue = null | boolean | number | string | object;

export interface IQueryState<TParams, TData> {
	definitionName: string;
	params: TParams | null;
	data: TData | null;
	loading: boolean;
	error: Error | null;
	timestamp: number;
	autoRefetch?: boolean;
	expireTime?: number;
	/**
	 * True while a background refresh of already usable data is running.
	 * Unlike `loading` this must not block rendering, consumers keep
	 * showing the cached payload.
	 */
	revalidating?: boolean;
	/**
	 * True once the entry holds a payload from either a fetch or a
	 * hydration. Distinguishes "cached the value null" from "never
	 * fetched", which `data !== null` alone cannot express.
	 */
	hasData?: boolean;
	/** Payload came from local storage rather than the network. */
	hydrated?: boolean;
	/**
	 * When the last background revalidation failed. Background failures
	 * record no `error` so the cached payload stays usable, which would
	 * otherwise leave the entry permanently due for another attempt.
	 */
	revalidateFailedAt?: number;
}

/**
 * Persisted description of a cache entry. Holds no payload: the data
 * itself is rebuilt on demand from IndexedDB or the persisted planning
 * store through the definitions `hydrateFn`.
 */
export interface IQueryCacheMeta {
	definitionName: string;
	params: unknown;
	timestamp: number;
	expireTime?: number;
}

/**
 * How long a payload stays fresh, either a fixed duration or one
 * derived from the payload itself.
 *
 * The derived form receives the timestamp the ttl will be measured
 * from, so it can express "expires at the next rollover" rather than
 * "expires N ms after whenever this happened to be fetched". See
 * `@/lib/query_cache/expiry`.
 */
export type QueryExpireTime<TData> =
	| number
	| ((data: TData, since: number) => number);

export type IQueryDefinition<TParams, TData> = [TParams] extends [undefined]
	? {
			key: () => JSONValue;
			fetchFn: () => Promise<TData>;
			hydrateFn?: () => Promise<TData | null>;
			autoRefetch?: boolean;
			expireTime?: QueryExpireTime<TData>;
			persist?: boolean;
		}
	: {
			key: (params: TParams) => JSONValue;
			fetchFn: (params: TParams) => Promise<TData>;
			hydrateFn?: (params: TParams) => Promise<TData | null>;
			autoRefetch?: boolean;
			expireTime?: QueryExpireTime<TData>;
			persist?: boolean;
		};
