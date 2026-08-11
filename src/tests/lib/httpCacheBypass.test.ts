import { describe, it, expect } from "vitest";

import {
	beginHttpCacheBypass,
	isHttpCacheBypassed,
	withHttpCacheBypass,
} from "@/lib/httpCacheBypass";

describe("httpCacheBypass", () => {
	it("leaves paths alone while no bypass is open", () => {
		expect(isHttpCacheBypassed()).toBe(false);
		expect(withHttpCacheBypass("/data/materials/")).toBe(
			"/data/materials/"
		);
	});

	it("busts a path while a bypass is open", () => {
		const release = beginHttpCacheBypass();

		expect(withHttpCacheBypass("/data/materials/")).toMatch(
			/^\/data\/materials\/\?_cb=\d+$/
		);

		release();

		expect(withHttpCacheBypass("/data/materials/")).toBe(
			"/data/materials/"
		);
	});

	it("appends to a path that already carries a query", () => {
		const release = beginHttpCacheBypass();

		expect(withHttpCacheBypass("/data/x/?a=1")).toMatch(
			/^\/data\/x\/\?a=1&_cb=\d+$/
		);

		release();
	});

	it("stays open until every holder releases", () => {
		// two refreshes overlapping must not end each other's window
		const releaseOuter = beginHttpCacheBypass();
		const releaseInner = beginHttpCacheBypass();

		releaseInner();
		expect(isHttpCacheBypassed()).toBe(true);

		releaseOuter();
		expect(isHttpCacheBypassed()).toBe(false);
	});

	it("ignores a release called twice", () => {
		const releaseOuter = beginHttpCacheBypass();
		const releaseInner = beginHttpCacheBypass();

		releaseInner();
		releaseInner();

		// the double release must not have closed the outer window
		expect(isHttpCacheBypassed()).toBe(true);

		releaseOuter();
		expect(isHttpCacheBypassed()).toBe(false);
	});
});
