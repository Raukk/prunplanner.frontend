import { EXCHANGES_TYPE } from "@/database/services/useExchangeData.types";

/** Severity of a row's share of the exchange's traded volume */
export type CX_VOLUME_LEVEL = "none" | "yellow" | "red";

/** Shares of daily traded volume, in percent, that colour a row */
export interface ICXVolumeThresholds {
	yellowPercent: number;
	redPercent: number;
}

/** One traded volume window of an exchange, measured against a sale */
export interface ICXVolumeWindow {
	/** Units traded on the exchange over the whole window */
	sumTraded: number;
	/** Length of the window in days */
	days: number;
	/** soldPerDay / (sumTraded / days), undefined while nothing trades */
	share: number | undefined;
}

/** A single material row's pressure on the exchange it is sold at */
export interface ICXVolumeShare {
	ticker: string;
	/** Exchange the sale lands on, the one the shares are measured against */
	exchange: EXCHANGES_TYPE;
	/** Units per day that actually reach the exchange */
	soldPerDay: number;
	window7d: ICXVolumeWindow;
	window30d: ICXVolumeWindow;
	/** Same windows across every exchange, shown as context only */
	universe7d: ICXVolumeWindow;
	universe30d: ICXVolumeWindow;
	/** Exchange trades too little for any share to be meaningful */
	illiquid: boolean;
	level: CX_VOLUME_LEVEL;
}

/** Input of a volume share calculation, one per material row */
export interface ICXVolumeRow {
	ticker: string;
	/** Units per day reaching the exchange, self consumption already netted */
	soldPerDay: number;
}
