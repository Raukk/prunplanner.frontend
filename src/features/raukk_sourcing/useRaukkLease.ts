import { computed, ComputedRef, Ref, ref } from "vue";

// Stores
import { useRaukkSourcingStore } from "@/features/raukk_sourcing/raukkSourcingStore";
import { usePlanningStore } from "@/stores/planningStore";

// Types & Interfaces
import { IRaukkLeaseLink } from "@/features/raukk_sourcing/raukkSourcingUi.types";
import { PSelectOption } from "@/ui/ui.types";

/**
 * Lease link of one plan, read and written for the UI.
 *
 * The store owns the rules — same planet, no self link, no chains — and
 * this composable only ever asks it: the candidate list is filtered by
 * the very conditions `setLeaseHost` throws on, so the select can never
 * offer a choice the store refuses, and a refusal that happens anyway
 * (a snapshot deleted between render and click) surfaces as `error`
 * rather than as an exception.
 *
 * @author raukk
 *
 * @param {Ref<string | undefined>} planUuid Open Plan Uuid, undefined on
 *   an unsaved plan
 * @returns Lease link state and its two actions
 */
export function useRaukkLease(planUuid: Ref<string | undefined>) {
	const sourcingStore = useRaukkSourcingStore();
	const planningStore = usePlanningStore();

	/** Rejection of the last `link()` call, cleared by the next one */
	const error: Ref<string | undefined> = ref(undefined);

	/**
	 * Name of a plan as the user knows it: the planning store is the
	 * authority, a stored snapshot the fallback for a plan that store
	 * does not hold (a shared plan, or one not yet loaded).
	 *
	 * @author raukk
	 *
	 * @param {string} uuid Plan Uuid
	 * @returns {(string | undefined)} Plan Name
	 */
	function planNameOf(uuid: string): string | undefined {
		return (
			planningStore.plans[uuid]?.plan_name ??
			sourcingStore.snapshots[uuid]?.planName
		);
	}

	/**
	 * Planet a plan sits on. The store resolves it off the snapshot,
	 * which a plan only loaded but never computed has none of — the
	 * planning store still knows the planet, and the plan route needs
	 * it.
	 *
	 * @author raukk
	 *
	 * @param {string} uuid Plan Uuid
	 * @returns {(string | undefined)} Planet Natural Id
	 */
	function planetOf(uuid: string): string | undefined {
		return (
			sourcingStore.planetOf(uuid) ??
			planningStore.plans[uuid]?.planet_natural_id
		);
	}

	/**
	 * One plan as the UI shows a lease link end: name, and the plan
	 * route to follow it by.
	 *
	 * @author raukk
	 *
	 * @param {string} uuid Plan Uuid
	 * @returns {IRaukkLeaseLink} Link End
	 */
	function linkOf(uuid: string): IRaukkLeaseLink {
		const planetNaturalId: string | undefined = planetOf(uuid);

		return {
			planUuid: uuid,
			planName: planNameOf(uuid),
			planetNaturalId,
			route:
				planetNaturalId === undefined
					? undefined
					: `/plan/${planetNaturalId}/${uuid}`,
		};
	}

	/** Host of the open plan, undefined while it ships on its own */
	const host: ComputedRef<IRaukkLeaseLink | undefined> = computed(() => {
		if (planUuid.value === undefined) return undefined;

		const hostUuid: string | undefined =
			sourcingStore.configs[planUuid.value]?.leaseHostPlanUuid;

		return hostUuid === undefined ? undefined : linkOf(hostUuid);
	});

	/** Bases leased AT the open plan, empty on a plan hosting none */
	const leases: ComputedRef<IRaukkLeaseLink[]> = computed(() =>
		planUuid.value === undefined
			? []
			: sourcingStore.leasesOf(planUuid.value).map(linkOf)
	);

	const isLease: ComputedRef<boolean> = computed(
		() => host.value !== undefined
	);

	const isHost: ComputedRef<boolean> = computed(
		() => leases.value.length > 0
	);

	/**
	 * Plans the open plan may lease from, exactly the set
	 * `setLeaseHost` accepts: another plan, holding a snapshot, on this
	 * plans planet, not a lease itself — and none at all while the open
	 * plan hosts leases of its own, since links are never chained.
	 */
	const candidates: ComputedRef<PSelectOption[]> = computed(() => {
		if (planUuid.value === undefined || isHost.value) return [];

		const ownPlanet: string | undefined = sourcingStore.planetOf(
			planUuid.value
		);

		if (ownPlanet === undefined) return [];

		return Object.keys(sourcingStore.snapshots)
			.filter(
				(uuid) =>
					uuid !== planUuid.value &&
					sourcingStore.planetOf(uuid) === ownPlanet &&
					sourcingStore.configs[uuid]?.leaseHostPlanUuid === undefined
			)
			.map((uuid) => ({
				label: planNameOf(uuid) ?? uuid,
				value: uuid,
			}))
			.sort((a, b) => (a.label > b.label ? 1 : -1));
	});

	/**
	 * Links the open plan to a host base. A rejected link leaves the
	 * store untouched and puts the stores own message onto `error`,
	 * which is what the user is shown.
	 *
	 * @author raukk
	 *
	 * @param {string} hostPlanUuid Host Plan Uuid
	 */
	function link(hostPlanUuid: string): void {
		if (planUuid.value === undefined) return;

		error.value = undefined;

		try {
			sourcingStore.setLeaseHost(planUuid.value, hostPlanUuid);
		} catch (exception) {
			error.value =
				exception instanceof Error ? exception.message : "unknown";
		}
	}

	/**
	 * Drops the lease link of the open plan, it plans its own shipping
	 * again.
	 *
	 * @author raukk
	 */
	function unlink(): void {
		if (planUuid.value === undefined) return;

		error.value = undefined;
		sourcingStore.clearLeaseHost(planUuid.value);
	}

	return {
		host,
		leases,
		isLease,
		isHost,
		candidates,
		error,
		link,
		unlink,
	};
}
