import axios, { AxiosInstance, isAxiosError } from "axios";
import { ZodError, ZodType } from "zod";
import config from "@/lib/config";
import { withHttpCacheBypass } from "@/lib/httpCacheBypass";

/**
 * Service making calls to PRUNplanner backend
 * @author jplacht
 *
 * @export
 * @class ApiService
 * @typedef {ApiService}
 */
class ApiService {
	// needs to be public for axios-mock-adapter
	public readonly client: AxiosInstance;

	constructor() {
		this.client = axios;
		this.client.defaults.baseURL = config.API_BASE_URL;

		// A request with no timeout can pend forever on a half-dead
		// connection. Everything above this client — the query cache's
		// in-flight dedupe, the token refresh every 401 waits on, any
		// async setup behind a <Suspense> — then pends with it, with no
		// error and no way back short of a hard refresh. A rejection is
		// recoverable; a pending promise is not. (The FIO client pins
		// its own timeout in fioData.api.ts.)
		this.client.defaults.timeout = 30_000;

		/*
			GETs default to bypassing the browser cache. The backend
			answers everything with `public, max-age=86400`, which is
			right for game data and wrong for a plan the user just saved,
			so the safe default is to ask every time and let the handful
			of endpoints that benefit opt in per call.
		*/
		this.client.defaults.headers.get["Cache-Control"] =
			"no-cache, no-store, must-revalidate";
		this.client.defaults.headers.get["Pragma"] = "no-cache";
		this.client.defaults.headers.get["Expires"] = "0";
	}

	/**
	 * Per request header override that lets a GET be answered from the
	 * browser cache, undoing the no-store default for that call only.
	 *
	 * Only for endpoints where a stale answer is harmless and bounded:
	 * the backend's `max-age` runs on its own clock, unrelated to the
	 * query cache's ttl, so anything whose freshness actually matters —
	 * or whose expiry is derived from the payload's own date, which
	 * would keep re-reading the same cached copy and never advance —
	 * must keep the default.
	 *
	 * @author raukk
	 *
	 * @private
	 * @param {boolean} [allowHttpCache] Permit a cached response
	 * @returns {object} Axios request config
	 */
	private cacheConfig(allowHttpCache?: boolean) {
		if (!allowHttpCache) return {};

		return {
			headers: {
				"Cache-Control": undefined,
				Pragma: undefined,
				Expires: undefined,
			},
		};
	}

	/**
	 * Performs a GET request towards the backend
	 * @author jplacht
	 *
	 * @public
	 * @async
	 * @template Response Response Type
	 * @param {string} path URL
	 * @param {ZodType<Response>} responseSchema Response Schema
	 * @returns {Promise<Response>}
	 */
	public async get<Response>(
		path: string,
		responseSchema: ZodType<Response>,
		options?: { allowHttpCache?: boolean }
	): Promise<Response> {
		try {
			const { data } = await this.client.get(
				// a user triggered refresh must reach the backend even
				// where the browser holds a still valid copy
				options?.allowHttpCache ? withHttpCacheBypass(path) : path,
				this.cacheConfig(options?.allowHttpCache)
			);
			return responseSchema.parse(data);
		} catch (e) {
			throw this.normalizeError(e);
		}
	}

	/**
	 * Performs a POST request towards the backend
	 * @author jplacht
	 *
	 * @public
	 * @async
	 * @template Request Request Type
	 * @template Response Response Type
	 * @param {string} path URL
	 * @param {unknown} payload Payload data
	 * @param {ZodType<Request>} requestSchema Request Schema
	 * @param {ZodType<Response>} responseSchema Response Schema
	 * @param {?boolean} [asForm] adds multipart/form-data header
	 * @returns {Promise<Response>}
	 */
	public async post<Request, Response>(
		path: string,
		payload: unknown,
		requestSchema: ZodType<Request>,
		responseSchema: ZodType<Response>,
		asForm?: boolean
	): Promise<Response> {
		try {
			const body = requestSchema.parse(payload);

			const headers = asForm
				? { headers: { "Content-Type": "multipart/form-data" } }
				: {};

			const { data } = await this.client.post(path, body, headers);

			return responseSchema.parse(data);
		} catch (e) {
			throw this.normalizeError(e);
		}
	}

	/**
	 * Performs a PUT request towards the backend
	 * @author jplacht
	 *
	 * @public
	 * @async
	 * @template Request Request Type
	 * @template Response Response Type
	 * @param {string} path URL
	 * @param {unknown} payload Payload data
	 * @param {ZodType<Request>} requestSchema Request Schema
	 * @param {ZodType<Response>} responseSchema Response Schema
	 * @returns {Promise<Response>}
	 */
	public async put<Request, Response>(
		path: string,
		payload: unknown,
		requestSchema: ZodType<Request>,
		responseSchema: ZodType<Response>
	): Promise<Response> {
		try {
			const body = requestSchema.parse(payload);

			const { data } = await this.client.put(path, body);

			return responseSchema.parse(data);
		} catch (e) {
			throw this.normalizeError(e);
		}
	}

	/**
	 * Performs a PATCH request towards the backend
	 * @author jplacht
	 *
	 * @public
	 * @async
	 * @template Request Request Type
	 * @template Response Response Type
	 * @param {string} path URL
	 * @param {unknown} payload Payload data
	 * @param {ZodType<Request>} requestSchema Request Schema
	 * @param {ZodType<Response>} responseSchema Response Schema
	 * @returns {Promise<Response>}
	 */
	public async patch<Request, Response>(
		path: string,
		payload: unknown,
		requestSchema: ZodType<Request>,
		responseSchema: ZodType<Response>
	): Promise<Response> {
		try {
			const body = requestSchema.parse(payload);

			const { data } = await this.client.patch(path, body);

			return responseSchema.parse(data);
		} catch (e) {
			throw this.normalizeError(e);
		}
	}

	/**
	 * Performs a DELETE request towards the backend
	 * @author jplacht
	 *
	 * @public
	 * @async
	 * @param {string} path URL
	 * @returns {Promise<boolean>} Response Status
	 */
	public async delete(path: string): Promise<boolean> {
		try {
			return await this.client.delete(path);
		} catch (e) {
			throw this.normalizeError(e);
		}
	}

	/**
	 * Normalizes error formats for Zod and Axios
	 * @author jplacht
	 *
	 * @private
	 * @param {unknown} err Error
	 * @returns {Error} Error
	 */
	private normalizeError(err: unknown): Error {
		if (err instanceof ZodError) {
			return new Error(`Validation error: ${err.message}`);
		} else if (isAxiosError(err)) {
			const status = err.response?.status;
			const body = err.response?.data;

			const msg =
				body && typeof body === "object"
					? JSON.stringify(body)
					: err.message;

			const newError = new Error(msg);

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(newError as any).responseData = body;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(newError as any).status = status;

			return newError;
		}

		return err instanceof Error ? err : new Error(String(err));
	}
}

export const apiService = new ApiService();
