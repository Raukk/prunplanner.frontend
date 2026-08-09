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

export type IQueryDefinition<TParams, TData> = [TParams] extends [undefined]
	? {
			key: () => JSONValue;
			fetchFn: () => Promise<TData>;
			hydrateFn?: () => Promise<TData | null>;
			autoRefetch?: boolean;
			expireTime?: number;
			persist?: boolean;
		}
	: {
			key: (params: TParams) => JSONValue;
			fetchFn: (params: TParams) => Promise<TData>;
			hydrateFn?: (params: TParams) => Promise<TData | null>;
			autoRefetch?: boolean;
			expireTime?: number;
			persist?: boolean;
		};
