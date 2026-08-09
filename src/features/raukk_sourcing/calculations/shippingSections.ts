// Section registry of the Shipping page's tab strip: the key list, the
// gate that decides which of them a user can actually reach, and the
// `?section=` deep link resolver. Pure functions, no store and no Vue —
// the page owns the ref, this owns the rules.

/** Sections of the Shipping page, in tab strip order */
export const RAUKK_SHIPPING_SECTIONS = [
	"settings",
	"fleet",
	"chains",
	"depots",
	"visuals",
	"calibration",
] as const;

export type RaukkShippingSection = (typeof RAUKK_SHIPPING_SECTIONS)[number];

/** Where the page opens when nothing says otherwise */
export const RAUKK_SHIPPING_DEFAULT_SECTION: RaukkShippingSection = "fleet";

/**
 * Sections reachable right now. Charging shipping is what produces the
 * fleet, the chains and every number the other sections render, so with
 * it switched off there is nothing to tab through — Settings, which
 * carries the switch, is the only way back.
 *
 * @author raukk
 *
 * @param {boolean} enabled Whether shipping is charged account wide
 * @returns {RaukkShippingSection[]} Reachable sections, in strip order
 */
export function raukkShippingSections(
	enabled: boolean
): RaukkShippingSection[] {
	return enabled ? [...RAUKK_SHIPPING_SECTIONS] : ["settings"];
}

/**
 * The section to show, given the current one and whether shipping is
 * charged. Kept separate from {@link raukkShippingSectionFromQuery} so
 * the page can re-run it when the switch flips: a user who turns
 * shipping off while standing on the Depots tab must land somewhere
 * that exists.
 *
 * @author raukk
 *
 * @param {RaukkShippingSection} current The section the page holds
 * @param {boolean} enabled Whether shipping is charged account wide
 * @returns {RaukkShippingSection} `current`, or the only reachable one
 */
export function raukkShippingResolveSection(
	current: RaukkShippingSection,
	enabled: boolean
): RaukkShippingSection {
	const reachable: RaukkShippingSection[] = raukkShippingSections(enabled);

	return reachable.includes(current) ? current : reachable[0];
}

/**
 * The `?section=` deep link, resolved. Anything unknown — a missing
 * param, an array of them, a stale key from an older build — falls back
 * rather than landing the user on a blank page, and a section the
 * shipping switch has closed off is not honoured either.
 *
 * The caller strips the param afterwards, the `?tool=` precedent in
 * `PlanView`: a back-nav must not resurrect a section the user has
 * since tabbed away from.
 *
 * @author raukk
 *
 * @param {unknown} raw `route.query.section`, whatever it turned out
 * to be
 * @param {boolean} enabled Whether shipping is charged account wide
 * @param {RaukkShippingSection} fallback Section to keep when the param
 * carries no usable value
 * @returns {RaukkShippingSection} The section to open
 */
export function raukkShippingSectionFromQuery(
	raw: unknown,
	enabled: boolean,
	fallback: RaukkShippingSection = RAUKK_SHIPPING_DEFAULT_SECTION
): RaukkShippingSection {
	const known: boolean =
		typeof raw === "string" &&
		(RAUKK_SHIPPING_SECTIONS as readonly string[]).includes(raw);

	return raukkShippingResolveSection(
		known ? (raw as RaukkShippingSection) : fallback,
		enabled
	);
}
