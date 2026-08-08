export interface ISystemsJSON {
	SystemId: string;
	Connections: { ConnectingId: string}[] | null
	// raukk: euclidean coordinates, present on all systems, used by
	// src/features/raukk_sourcing/calculations/routeDistance.ts
	PositionX: number;
	PositionY: number;
	PositionZ: number;
}

export type AdjecentList = number[][];
