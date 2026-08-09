// The one palette every raukk visualization draws from: the surfaces a
// mark can sit on, the neutral ink ramp, and the interactive accent.
// Values are the app's own Tailwind tokens wherever the app has one, so
// a chart never invents a color the rest of PRUNplanner does not use.
//
// CATEGORICAL series colors are NOT here — they live with the report
// that owns their meaning (`RAUKK_OVERSUB_SLOT_COLORS` in
// oversubDisplay.ts, the cargo class colors in shippingMapDisplay.ts);
// a series' meaning must stay next to its data. The alert pair IS here:
// "past capacity" means the same thing on every view, and a second red
// would read as a second verdict.
//
// Consumed two ways, both of which must agree: SVG presentation
// attributes bind the constants directly, `<style>` blocks read the CSS
// vars of `RAUKK_VIZ_CSS_VARS`, which a section root spreads.

// Types & Interfaces
import { CSSProperties } from "vue";

/**
 * Surfaces a mark can sit on. A halo, a knockout gap or a chip must
 * always be painted in the surface it is punched out of — pick the one
 * matching the container, never a value that merely looks close.
 *
 * @author raukk
 */
export const RAUKK_VIZ_SURFACE = {
	/** The page itself, `--app-bg`: knockout gaps between marks drawn
	 * straight onto the view with no plot container of their own */
	page: "#030707",
	/** Full-bleed plot canvas of a bordered SVG container (star maps,
	 * the capacity plane). One step up from the page so the frame reads
	 * as a plot, and neutral — a blue-black canvas puts the map views in
	 * a different app to the rest of the report */
	plot: "#0a0b0b",
	/** Hairlines, grid rules and system rings ON a plot canvas, plus the
	 * fill of a marker that stands for nothing measurable */
	rule: "#2c2c2a",
	/** Chip, badge and pill surface of the HTML tabs, `background` */
	chip: "#212529",
	/** A marker carrying no reading at all, `pp-primary` */
	inert: "#1e1e1e",
} as const;

/**
 * The neutral ink ramp, brightest first. Warm gray on purpose: it
 * carries no verdict, so it can never be mistaken for the red/amber
 * status pair or for a categorical series color.
 *
 * `muted` and `faint` are the same values as
 * `RAUKK_OVERSUB_STATUS_COLORS.other` / `.external`; those two names
 * state the meaning, these state the weight.
 *
 * @author raukk
 */
export const RAUKK_VIZ_INK = {
	/** Emphasized stroke or tick: a node outline, the 100% rule */
	bright: "#c3c2b7",
	/** Secondary text, axis labels, the "no reading" stroke */
	base: "#898781",
	/** Folded/aggregate fills */
	muted: "#6b6a64",
	/** Structural strokes: unselected boxes, neutral node fills */
	dim: "#565650",
	/** The quietest thing still meant to be seen */
	faint: "#4a4a46",
} as const;

/**
 * `RAUKK_VIZ_INK.base` as bare rgb channels, for the `rgba()` ramps the
 * tabs build inline. Kept beside the hex so the two cannot drift.
 *
 * @author raukk
 */
export const RAUKK_VIZ_INK_RGB: string = "137, 135, 129";

/**
 * The one alert pair of the visualizations. Every view that can say
 * "past capacity" says it in this red, and every view that can say
 * "the figure behind this is out of date" says it in this amber — a
 * second red would read as a second, different verdict.
 *
 * Status is never carried by color alone; the glyph and the printed
 * number carry it too (see the oversubscription report's conventions).
 *
 * @author raukk
 */
export const RAUKK_VIZ_ALERT = {
	/** The app's `negative`: fills, washes, bar segments */
	solid: "#c70039",
	/** `solid` lifted enough to read as text or a hairline on a dark
	 * ground, where the solid value goes muddy */
	text: "#ff5470",
	/** `solid` as bare channels, for the inline `rgba()` washes */
	rgb: "199, 0, 57",
	/** Stale / provisional amber */
	warn: "#fab219",
} as const;

/**
 * Hue of the single-hue utilization ramp — see `raukkOversubBlueRamp`,
 * which is the only thing allowed to pick an alpha on it. The solid
 * value is the ramp's own stroke.
 *
 * @author raukk
 */
export const RAUKK_VIZ_RAMP = {
	rgb: "57, 135, 229",
	stroke: "rgba(57, 135, 229, 0.85)",
	solid: "#3987e5",
} as const;

/**
 * `prunplanner` lime, the app's interactive accent. Reserved for
 * affordances — selection rings, expand links — and for a positive
 * readout, never for a categorical series.
 *
 * @author raukk
 */
export const RAUKK_VIZ_ACCENT = {
	/** Selection ring, link text, positive figures */
	solid: "#c0e219",
	/** The same lime as a filled bar, where solid lime would shout */
	wash: "rgba(192, 226, 24, 0.45)",
} as const;

/**
 * The palette as CSS custom properties, to spread onto the style of a
 * section root so its `<style>` blocks can read the same values the SVG
 * attributes bind. Scoped styles cannot see these across a Teleport —
 * `RaukkOversubTooltip` renders into `body` and states that in place.
 *
 * @author raukk
 *
 * @returns {CSSProperties} Custom property declarations
 */
export const RAUKK_VIZ_CSS_VARS: CSSProperties = {
	"--rviz-page": RAUKK_VIZ_SURFACE.page,
	"--rviz-plot": RAUKK_VIZ_SURFACE.plot,
	"--rviz-rule": RAUKK_VIZ_SURFACE.rule,
	"--rviz-chip": RAUKK_VIZ_SURFACE.chip,
	"--rviz-inert": RAUKK_VIZ_SURFACE.inert,
	"--rviz-ink-bright": RAUKK_VIZ_INK.bright,
	"--rviz-ink": RAUKK_VIZ_INK.base,
	"--rviz-ink-muted": RAUKK_VIZ_INK.muted,
	"--rviz-ink-dim": RAUKK_VIZ_INK.dim,
	"--rviz-ink-faint": RAUKK_VIZ_INK.faint,
	"--rviz-ink-rgb": RAUKK_VIZ_INK_RGB,
	"--rviz-ramp-rgb": RAUKK_VIZ_RAMP.rgb,
	"--rviz-ramp-stroke": RAUKK_VIZ_RAMP.stroke,
	"--rviz-ramp-solid": RAUKK_VIZ_RAMP.solid,
	"--rviz-alert": RAUKK_VIZ_ALERT.solid,
	"--rviz-alert-text": RAUKK_VIZ_ALERT.text,
	"--rviz-alert-rgb": RAUKK_VIZ_ALERT.rgb,
	"--rviz-warn": RAUKK_VIZ_ALERT.warn,
	"--rviz-accent": RAUKK_VIZ_ACCENT.solid,
	"--rviz-accent-wash": RAUKK_VIZ_ACCENT.wash,
} as CSSProperties;
