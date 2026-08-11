class Config {
	public readonly API_BASE_URL: string;
	public readonly SHARE_BASE_URL: string;
	public readonly FIO_BASE_URL: string;

	public readonly GAME_DATA_STALE_MINUTES_BUILDINGS: number;
	public readonly GAME_DATA_STALE_MINUTES_RECIPES: number;
	public readonly GAME_DATA_STALE_MINUTES_MATERIALS: number;
	public readonly GAME_DATA_STALE_MINUTES_EXCHANGES: number;
	public readonly GAME_DATA_STALE_MINUTES_PLANETS: number;
	public readonly GAME_DATA_STALE_MINUTES_PLANET_SCHEDULED: number;

	public readonly INDEXEDDB_DBNAME: string;

	constructor() {
		this.API_BASE_URL =
			import.meta.env.VITE_API_BASE_URL || "https://api.prunplanner.org";
		this.SHARE_BASE_URL =
			import.meta.env.VITE_SHARE_BASE_URL ||
			"https://prunplanner.org/shared";
		this.FIO_BASE_URL =
			import.meta.env.VITE_FIO_BASE_URL || "https://rest.fnar.net";

		this.GAME_DATA_STALE_MINUTES_BUILDINGS =
			import.meta.env.VITE_GAME_DATA_STALE_MINUTES_BUILDINGS || 24 * 60;
		this.GAME_DATA_STALE_MINUTES_RECIPES =
			import.meta.env.VITE_GAME_DATA_STALE_MINUTES_RECIPES || 24 * 60;
		this.GAME_DATA_STALE_MINUTES_MATERIALS =
			import.meta.env.VITE_GAME_DATA_STALE_MINUTES_MATERIALS || 24 * 60;
		/*
			raukk: exchange data is a daily close — every row of the
			payload carries the same calendar_date — so it is expired at
			the rollover rather than an hour after whenever it was loaded,
			and this is only the upper bound on that. Was 60 minutes,
			which refetched 719 KB up to 24 times to observe one change.
		*/
		this.GAME_DATA_STALE_MINUTES_EXCHANGES =
			import.meta.env.VITE_GAME_DATA_STALE_MINUTES_EXCHANGES || 24 * 60;
		this.GAME_DATA_STALE_MINUTES_PLANETS =
			import.meta.env.VITE_GAME_DATA_STALE_MINUTES_PLANETS || 12 * 60;
		/*
			raukk: cap for a planet whose COGC schedule reaches into the
			future, where the payload names the moment its only moving
			field turns over. One COGC window is seven days, which is the
			longest that anchor can ever ask for. Kept apart from
			GAME_DATA_STALE_MINUTES_PLANETS because that one also bounds
			planet searches, FIO fees, population reports and analytics,
			none of which carry the schedule.
		*/
		this.GAME_DATA_STALE_MINUTES_PLANET_SCHEDULED =
			import.meta.env.VITE_GAME_DATA_STALE_MINUTES_PLANET_SCHEDULED ||
			7 * 24 * 60;
		this.INDEXEDDB_DBNAME =
			import.meta.env.VITE_INDEXEDDB_DBNANAME || "prunplanner";
	}
}

const config = new Config();
export default config;
