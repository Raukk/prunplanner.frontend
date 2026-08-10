export interface StepConfig<TData> {
	key: string;
	name: string;
	enabled: () => boolean;
	dependsOn?: string;
	load: () => Promise<TData>;
	onSuccess: (d: TData) => void;
}

export type StepState<TData> = {
	cfg: StepConfig<TData>;
	data: TData | null;
	loading: boolean;
	error: Error | null;
	triggered: boolean;
	/** Loads started for this step, including the one currently running. */
	attempts: number;
	/** An automatic retry is waiting on its timer. */
	retryScheduled: boolean;
};

export type LoadingStep = {
	key: string;
	name: string;
	loading: boolean;
	error: Error | null;
	retryScheduled: boolean;
};
