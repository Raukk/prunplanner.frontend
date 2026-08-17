# FIO / FNAR reference resources

External, third-party resources for FIO — the community data collection layer for Prosperous Universe that PRUNplanner reads from. Not maintained by this project; treat everything here as subject to change without notice.

| Resource | URL | What it is |
| --- | --- | --- |
| Projects overview | <https://fnar.net/page/projects/> | FNAR Industries' landing page for the FIO toolchain: REST server, browser extension, FIO Web, Discord bots (FIDO, UFOBot, ApexChat), deprecated FIO UI. |
| REST API docs | <https://doc.fnar.net/> | Swagger UI over the live spec at <https://doc.fnar.net/api.json>. The only endpoint-level contract that exists. |
| Source | <https://gitlab.com/fnar/fio> | GitLab **group** (not a single repo) holding every FIO component. |

Related: <https://fio.fnar.net> (FIO Web app, planet search + burn rate), <https://gitlab.com/fnar/fio/support> (issue tracker for FIO as a whole, plus a short "About FIO" writeup).

## The GitLab group

Ordered by relevance to us; language from the GitLab API, last activity as of 2026-08-16.

| Project | Language | Last activity | Notes |
| --- | --- | --- | --- |
| `fnar/fio/fiorest` | C# 99% | 2026-07-10 | The REST server behind `rest.fnar.net`. Entity Framework over SQLite locally / Postgres in production; README covers self-hosting (`--databasefilepath`, `--migrate`, `--port`) and the model/migration rules. Payload shapes referenced by the API docs as "see FIORest source" live here. |
| `fnar/fio/fioapi` | C# 99% | 2026-08-13 | Most recently active API project in the group. |
| `fnar/fio/fioweb` | JS 82% | 2026-03-16 | Web frontend at fio.fnar.net. |
| `fnar/fio/fioextension`, `extension-common`, `extension-fio-unified` | mixed | 2023–2026 | Browser extension / TamperMonkey script that scrapes APEX and POSTs the data. Explains why most `POST` endpoints exist. |
| `fnar/fio/fido`, `ufobot`, `apexchat` | — | 2023–2026 | Discord bots. |
| `fnar/fio/fioui`, `fiowebserver`, `fioapiweb`, `ember-ui` | — | 2021–2024 | Dormant/deprecated. |

All public; none declare a license file (the API spec itself declares MIT).

## REST API essentials

- Host `rest.fnar.net`, basePath `/`, Swagger 2.0, spec version 1.0.0, MIT.
- 192 paths. 94 require auth, 17 require admin. `GET` = read, `POST` = either data submission from the extension or a search/mutation.
- Auth: `POST /auth/login` with credentials returns an `AuthToken` GUID; send it as a bare `Authorization: <token>` header (`apiKey` security scheme, no `Bearer` prefix). Long-lived keys via `POST /auth/createapikey` / `listapikeys` / `revokeapikey`. User-scoped data additionally needs the target user to have granted a permission — the spec tags these `permissionStorage`, `permissionProduction`, `permissionBuilding`, `permissionWorkforce`, `permissionContracts`, `permissionFlight`, `permissionShipmentTracking`.
- Public (no auth) groups worth knowing: `planet`, `material`, `recipes`, `building`, `systemstars`, `exchange`, `localmarket`, `global`, `rain` static data.

### Endpoint groups

| Group | Highlights |
| --- | --- |
| `planet` | `GET /planet/{Planet}`, `GET /planet/allplanets`, `GET /planet/allplanets/full` (the fat one — every planet with resources, fees, environment), `POST /planet/search`. |
| `systemstars` | `GET /systemstars`, `/systemstars/star/{Star}`, `/systemstars/jumpcount/{Source}/{Destination}`, `/systemstars/jumproute/...`, `/systemstars/worldsectors`. |
| `exchange` | `GET /exchange/all` (summary), `/exchange/full` (with orders), `/exchange/{Ticker}`, `/exchange/cxpc/{Ticker}[/{TimeStamp}]` price charts, `/exchange/station`. |
| `localmarket` | Ads by planet, company, or shipping source/destination; `POST /localmarket/search`. |
| `material`, `recipes`, `building` | `allmaterials`, `allrecipes`, `/recipes/{Ticker}`, `/building/allbuildings`, `/building/{Ticker}`. |
| `storage`, `sites`, `workforce`, `production` | Per-user, permission-gated: `GET /storage/{UserName}`, `/sites/{UserName}[/{Planet}]`, `/sites/warehouses/{UserName}`, `/workforce/{UserName}`, `/production/{UserName}`. |
| `ship` | `GET /ship/ships/{UserName}`, `/ship/ships/fuel/{UserName}`, `/ship/flights/{UserName}`. |
| `global` | `GET /global/simulationdata` (game tick/version metadata), `/global/workforceneeds`, `/global/comexexchanges`, `/global/countries`. |
| `rain` | 18 normalized/flattened variants of the above (`/rain/buildingcosts`, `/rain/recipeinputs`, `/rain/planetresources`, `/rain/prices`, `/rain/user*`), convenient for tabular consumption. |
| `csv` | 31 endpoints returning CSV for spreadsheets — the docs suggest `=IMPORTDATA("https://rest.fnar.net/csv/ENDPOINT")`. Includes `burnrate`, `buildingcosts`, `cxpc/{Ticker}`, `infrastructure/*`, `prices`. |
| `contract`, `cxos`, `chat`, `company`, `user`, `usersettings`, `infrastructure`, `auth`, `admin` | Remainder. |

A snapshot of the spec is vendored at [fio-rest-api.swagger.json](./fio-rest-api.swagger.json) (fetched 2026-08-16 from `doc.fnar.net/api.json`) so endpoint lookups work offline. It will drift — re-fetch before trusting it for anything new.

## Where PRUNplanner already touches FIO

- Direct browser → FIO calls go through `FIOApiService` in [src/features/api/fioData.api.ts](../src/features/api/fioData.api.ts), a separate axios instance so PRUNplanner auth interceptors and no-cache headers do not leak into FIO requests (those headers break its CORS preflight). Base URL `config.FIO_BASE_URL`, default `https://rest.fnar.net`, overridable with `VITE_FIO_BASE_URL`.
- Currently the only direct call is planet fees, consumed by the `GetFIOPlanetFees` query in [usePlanCalculation.ts](../src/features/planning/usePlanCalculation.ts) and applied in `calculations/productionFeeCalculations.ts`.
- User storage/sites data (`fio_storage_*`, `fio_sites_planets` in `planningStore`) arrives via the PRUNplanner backend, which holds the user's FIO API key (`userStore.hasFIO`, `profile.fio_apikey`) — not from the browser.
- Static data checked into `src/features/raukk_sourcing/` was sourced from `rest.fnar.net/planet/allplanets/full` and `rest.fnar.net/systemstars/star/*`; `routeDistance.ts` cites `/global/simulationdata`.
- Unrelated but adjacent, already cited in source comments: the PCT community wiki (<https://pct.fnar.net/>) for ship blueprints and building degradation.
