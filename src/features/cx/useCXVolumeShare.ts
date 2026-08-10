/*
	Resolves where a plan sells and how much of that exchange's traded
	volume its output represents. Reads the exchange preference off the
	CX configuration and the traded sums out of the game data, the math
	itself lives in `cxVolumeShare.ts`.
*/
import { Ref, ref, watchEffect } from "vue";

// Stores
import { usePlanningStore } from "@/stores/planningStore";

// Composables
import { useExchangeData } from "@/database/services/useExchangeData";
import { usePreferences } from "@/features/preferences/usePreferences";

// Util
import {
	CX_VOLUME_EXCHANGES,
	calculateCXVolumeShare,
} from "@/features/cx/cxVolumeShare";

// Types & Interfaces
import { EXCHANGES_TYPE } from "@/database/services/useExchangeData.types";
import { IExchange } from "@/features/api/gameData.types";
import { ICXData } from "@/stores/planningStore.types";
import {
	ICXVolumeRow,
	ICXVolumeShare,
	ICXVolumeThresholds,
} from "@/features/cx/cxVolumeShare.types";

/**
 * Exchange a CX configuration sells at. Only the EMPIRE exchange
 * preference is consulted: ticker preferences are a fixed price and name
 * no exchange at all, and a plan sells its surplus wherever the empire
 * sells, not per material. Anything unresolvable measures against the
 * universe, which is never wrong, only less specific.
 * @author raukk
 *
 * @param {string | undefined} cxUuid CX configuration uuid
 * @returns {EXCHANGES_TYPE} Exchange the surplus lands on
 */
export function resolveSellExchange(
	cxUuid: string | undefined
): EXCHANGES_TYPE {
	if (!cxUuid) return "UNIVERSE";

	try {
		const cxData: ICXData = usePlanningStore().getCX(cxUuid).cx_data;

		// a "BOTH" preference stands in for the missing "SELL" one, the
		// backend forbids holding both at once
		const preference = cxData.cx_empire.find(
			(entry) => entry.type === "SELL" || entry.type === "BOTH"
		);

		if (!preference) return "UNIVERSE";

		// preference codes are `<EXCHANGE>_<WINDOW>`, e.g. "AI1_30D"
		const code = preference.exchange.split("_")[0] as EXCHANGES_TYPE;

		return CX_VOLUME_EXCHANGES.includes(code) ? code : "UNIVERSE";
	} catch {
		return "UNIVERSE";
	}
}

/**
 * Keeps a ticker keyed map of volume shares in step with the material
 * rows handed in. Rows without a sale are skipped, so a caller can pass
 * a whole material I/O table and only the outputs come back.
 * @author raukk
 *
 * @param {Ref<ICXVolumeRow[]>} rows Material rows and their daily sales
 * @param {Ref<string | undefined>} cxUuid CX configuration of the plan
 * @returns {{ volumeShares: Ref<Map<string, ICXVolumeShare>> }} Shares
 */
export function useCXVolumeShare(
	rows: Ref<ICXVolumeRow[]>,
	cxUuid: Ref<string | undefined>
): { volumeShares: Ref<Map<string, ICXVolumeShare>> } {
	const { cxVolumeYellowPercent, cxVolumeRedPercent } = usePreferences();

	const volumeShares: Ref<Map<string, ICXVolumeShare>> = ref(new Map());

	/** Guards against an earlier, slower run overwriting a later one */
	let generation: number = 0;

	watchEffect(async () => {
		// every reactive read happens before the first await, a dependency
		// picked up after it would not be tracked
		const localRows: ICXVolumeRow[] = rows.value.filter(
			(row) => row.soldPerDay > 0
		);
		const exchange: EXCHANGES_TYPE = resolveSellExchange(cxUuid.value);
		const thresholds: ICXVolumeThresholds = {
			yellowPercent: cxVolumeYellowPercent.value,
			redPercent: cxVolumeRedPercent.value,
		};

		const run: number = ++generation;

		if (localRows.length === 0) {
			volumeShares.value = new Map();
			return;
		}

		const { getExchangeTicker } = await useExchangeData();

		const next: Map<string, ICXVolumeShare> = new Map();

		await Promise.all(
			localRows.map(async (row) => {
				try {
					const universe: IExchange = await getExchangeTicker(
						`${row.ticker}.UNIVERSE`
					);
					const local: IExchange =
						exchange === "UNIVERSE"
							? universe
							: await getExchangeTicker(
									`${row.ticker}.${exchange}`
								);

					next.set(
						row.ticker,
						calculateCXVolumeShare(
							row.ticker,
							exchange,
							row.soldPerDay,
							{
								sumTraded7d: local.sum_traded_7d,
								sumTraded30d: local.sum_traded_30d,
								universeSumTraded7d: universe.sum_traded_7d,
								universeSumTraded30d: universe.sum_traded_30d,
							},
							thresholds
						)
					);
				} catch {
					// no exchange record for the ticker, nothing to warn about
				}
			})
		);

		if (run === generation) volumeShares.value = next;
	});

	return { volumeShares };
}
