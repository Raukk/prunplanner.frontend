// https://github.com/dumbmatter/fakeIndexedDB
import "fake-indexeddb/auto";

import MockAdapter from "axios-mock-adapter";

import config from "@/lib/config";
import { fioApiService } from "@/features/api/fioData.api";
import { beforeEach } from "vitest";

// raukk: the FIO REST API must never be hit from tests; test files
// needing fee data attach their own adapter to fioApiService.client
new MockAdapter(fioApiService.client).onAny().reply(404);

// Reset IndexedDB between test runs
beforeEach(async () => {
	// Close and delete DB from fake-indexeddb
	await indexedDB.deleteDatabase(config.INDEXEDDB_DBNAME);
});

if (typeof navigator === "undefined") {
	(global as any).navigator = {
		storage: {
			persist: async () => true,
		},
	};
}
