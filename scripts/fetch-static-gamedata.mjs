#!/usr/bin/env node
/**
 * Snapshots the static game data endpoints into bundled assets.
 *
 * Materials, recipes and buildings only change on a game update, which
 * means they only change between deploys. Shipping a snapshot lets a
 * first time visitor render immediately instead of blocking on ~250 KB
 * of uncompressed JSON, and the runtime cache still confirms it against
 * the backend in the background.
 *
 * Run by `pnpm build`. A failure here is never fatal: the committed
 * snapshot stays in place and the app falls back to fetching, so an
 * unreachable backend cannot break the build.
 *
 * @author raukk
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../src/assets/static/gamedata");

const BASE_URL =
	process.env.VITE_API_BASE_URL || "https://api.prunplanner.org";

const TIMEOUT_MS = 30_000;

/** Endpoint to asset filename, plus a floor on a plausible response. */
const SOURCES = [
	{ path: "/data/materials/", file: "materials.json", minRecords: 100 },
	{ path: "/data/recipes/", file: "recipes.json", minRecords: 100 },
	{ path: "/data/buildings/", file: "buildings.json", minRecords: 20 },
];

async function fetchJson(url) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}
		return await response.json();
	} finally {
		clearTimeout(timer);
	}
}

async function currentRecordCount(file) {
	try {
		const existing = JSON.parse(
			await readFile(resolve(OUT_DIR, file), "utf8")
		);
		return Array.isArray(existing) ? existing.length : 0;
	} catch {
		return 0;
	}
}

async function main() {
	await mkdir(OUT_DIR, { recursive: true });

	const results = [];
	let updated = 0;

	for (const source of SOURCES) {
		const url = `${BASE_URL}${source.path}`;

		try {
			const data = await fetchJson(url);

			if (!Array.isArray(data) || data.length < source.minRecords) {
				throw new Error(
					`implausible payload: ${
						Array.isArray(data) ? data.length : typeof data
					} records`
				);
			}

			await writeFile(
				resolve(OUT_DIR, source.file),
				JSON.stringify(data),
				"utf8"
			);

			updated += 1;
			results.push({ file: source.file, records: data.length });
			console.log(
				`[gamedata] ${source.file}: ${data.length} records from ${url}`
			);
		} catch (err) {
			const kept = await currentRecordCount(source.file);
			results.push({ file: source.file, records: kept, stale: true });
			console.warn(
				`[gamedata] ${source.file}: ${err.message}, keeping the committed snapshot (${kept} records)`
			);
		}
	}

	/*
		The manifest is what the app reads to decide how much to trust the
		snapshot. `capturedAt` only advances when every source refreshed:
		a partial run would otherwise date stale files as current.
	*/
	await writeFile(
		resolve(OUT_DIR, "manifest.json"),
		JSON.stringify(
			{
				capturedAt:
					updated === SOURCES.length
						? new Date().toISOString()
						: null,
				source: BASE_URL,
				sources: results,
			},
			null,
			"\t"
		) + "\n",
		"utf8"
	);
}

main().catch((err) => {
	// never fail the build over a snapshot
	console.warn(`[gamedata] snapshot skipped: ${err.message}`);
});
