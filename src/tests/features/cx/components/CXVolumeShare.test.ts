import { describe, it, expect } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

// Components
import CXVolumeShare from "@/features/cx/components/CXVolumeShare.vue";

// Util
import { calculateCXVolumeShare } from "@/features/cx/cxVolumeShare";

// Locales
import cx_volume from "@/locales/en_US/cx_volume.json";
import terms from "@/locales/en_US/terms.json";

// Types & Interfaces
import { ICXVolumeShare } from "@/features/cx/cxVolumeShare.types";

const i18n = createI18n({
	legacy: false,
	locale: "en_US",
	messages: { en_US: { cx_volume, terms } },
});

function render(share: ICXVolumeShare | undefined): VueWrapper {
	return mount(CXVolumeShare, {
		props: { share },
		global: {
			plugins: [i18n],
			stubs: {
				PTooltip: {
					template:
						'<div><span class="trigger"><slot name="trigger" /></span><span class="content"><slot /></span></div>',
				},
			},
		},
	});
}

/** The LDE case: 135.98 / day into AI1's 2,311 units over 7 days */
const lde: ICXVolumeShare = calculateCXVolumeShare("LDE", "AI1", 135.98, {
	sumTraded7d: 2311,
	sumTraded30d: 9656,
	universeSumTraded7d: 9018,
	universeSumTraded30d: 35213,
});

/** A sale the market absorbs without moving */
const rat: ICXVolumeShare = calculateCXVolumeShare("RAT", "AI1", 12, {
	sumTraded7d: 70000,
	sumTraded30d: 300000,
	universeSumTraded7d: 210000,
	universeSumTraded30d: 900000,
});

describe("CXVolumeShare", () => {
	it("renders nothing without a share", () => {
		expect(render(undefined).text()).toBe("");
	});

	it("labels the 7d share and its exchange", () => {
		const trigger = render(lde).find(".trigger");

		expect(trigger.text()).toContain("41.2% of AI1 7D vol");
	});

	it("shows the warning triangle over the threshold", () => {
		expect(render(lde).find(".trigger svg").exists()).toBe(true);
	});

	it("stays quiet below the threshold but still reports the share", () => {
		const wrapper = render(rat);

		expect(wrapper.find(".trigger svg").exists()).toBe(false);
		expect(wrapper.find(".trigger").text()).toContain("of AI1 7D vol");
	});

	it("colours red over the red threshold", () => {
		expect(render(lde).find(".trigger > div").classes()).toContain(
			"text-negative"
		);
	});

	it("colours amber between the thresholds", () => {
		// 8 / day against 1,000 units over 7 days is 5.6% at AI1
		const share: ICXVolumeShare = calculateCXVolumeShare("HE3", "AI1", 8, {
			sumTraded7d: 1000,
			sumTraded30d: 5000,
			universeSumTraded7d: 4000,
			universeSumTraded30d: 20000,
		});

		expect(share.level).toBe("yellow");
		expect(render(share).find(".trigger > div").classes()).toContain(
			"text-amber-400"
		);
	});

	it("stays grey below both thresholds", () => {
		expect(render(rat).find(".trigger > div").classes()).toContain(
			"text-white/40"
		);
	});

	it("names an illiquid exchange instead of a share", () => {
		const share: ICXVolumeShare = calculateCXVolumeShare("BSE", "CI1", 4, {
			sumTraded7d: 0,
			sumTraded30d: 0,
			universeSumTraded7d: 0,
			universeSumTraded30d: 0,
		});
		const wrapper = render(share);

		expect(wrapper.find(".trigger").text()).toContain("CI1 barely trades");
		expect(wrapper.find(".content").text()).toContain(
			"CI1 traded 0 units of BSE in 7 days."
		);
	});

	it("carries both windows and the universe context in the tooltip", () => {
		const content = render(lde).find(".content").text();

		expect(content).toContain("2,311 units traded");
		expect(content).toContain("9,656 units traded");
		expect(content).toContain("9,018 units traded");
		expect(content).toContain("UNIVERSE");
	});

	it("omits the universe lines when the sale is universe wide", () => {
		const share: ICXVolumeShare = calculateCXVolumeShare(
			"LDE",
			"UNIVERSE",
			10,
			{
				sumTraded7d: 9018,
				sumTraded30d: 35213,
				universeSumTraded7d: 9018,
				universeSumTraded30d: 35213,
			}
		);
		const lines = render(share).findAll(".content > div > div");

		// intro, 7d, 30d — no repeated universe pair
		expect(lines).toHaveLength(3);
	});

	it("says so when the window traded nothing but the sale is tiny", () => {
		// under a unit a week, so not illiquid, but no share either
		const share: ICXVolumeShare = calculateCXVolumeShare(
			"BSE",
			"AI1",
			0.05,
			{
				sumTraded7d: 0,
				sumTraded30d: 0,
				universeSumTraded7d: 0,
				universeSumTraded30d: 0,
			}
		);
		const wrapper = render(share);

		expect(share.level).toBe("none");
		expect(wrapper.find(".trigger").text()).toContain("no AI1 7D volume");
		expect(wrapper.find(".content").text()).toContain("nothing traded");
	});
});
