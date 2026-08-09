import axios, { AxiosInstance } from "axios";
import { ZodType } from "zod";

// config
import config from "@/lib/config";

// schemas
import { FIOPlanetFeeSchema } from "@/features/api/schemas/fioData.schemas";

// types
import { IFIOPlanetFees } from "@/features/api/fioData.types";

/**
 * Service making calls directly to the FIO REST API (rest.fnar.net).
 * Uses its own axios instance: FIO is a third-party service, the
 * PRUNplanner auth interceptors on the global instance must not apply.
 * @author raukk
 *
 * @export
 * @class FIOApiService
 * @typedef {FIOApiService}
 */
export class FIOApiService {
	// needs to be public for axios-mock-adapter
	public readonly client: AxiosInstance;

	constructor() {
		this.client = axios.create({
			baseURL: config.FIO_BASE_URL,
			timeout: 15_000,
		});

		// raukk: ApiService uses the global axios instance and writes
		// no-cache headers into axios.defaults.headers.get, which this
		// instance inherits at create time. Cache-Control, Pragma and
		// Expires are not CORS-safelisted, so sending them turns every
		// FIO GET into a preflight that rest.fnar.net rejects — its
		// Access-Control-Allow-Headers does not list them. Assign fresh
		// objects instead of deleting keys: the inherited buckets may
		// still be the global ones and PRUNplanner needs its no-cache.
		this.client.defaults.headers.get = {};
		this.client.defaults.headers.common = {};
	}

	/**
	 * Performs a GET request towards the FIO REST API
	 * @author raukk
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
		responseSchema: ZodType<Response>
	): Promise<Response> {
		const { data } = await this.client.get(path);
		return responseSchema.parse(data);
	}
}

export const fioApiService = new FIOApiService();

/**
 * Calls the FIO /planet/{planetNaturalId} endpoint and extracts the
 * government-set fee data (production, local market, warehouse and
 * establishment fees)
 * @author raukk
 *
 * @export
 * @async
 * @param {string} planetNaturalId Planet Natural Id ('OT-580b')
 * @returns {Promise<IFIOPlanetFees>} Planet Fee Data
 */
export async function callFIOPlanetFees(
	planetNaturalId: string
): Promise<IFIOPlanetFees> {
	return fioApiService.get<IFIOPlanetFees>(
		`/planet/${planetNaturalId}`,
		FIOPlanetFeeSchema
	);
}
