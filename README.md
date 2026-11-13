# SlopStorager

**SlopStorager** is a Proof of Concept (POC) API for tracking, aggregating, and analyzing **AI-hallucinated software package names** to help defend against **slopsquatting** attacks.

---

## Why SlopStorager?

### The Slopsquatting Problem
When Large Language Models (LLMs) generate code or recommend dependencies, they frequently **hallucinate** package names that do not exist in public registries like npm. Attackers can register those hallucinated names and publish malicious code under them — a supply-chain attack known as **slopsquatting**.

Crucially, LLM package hallucinations are **not purely random** — they follow repeatable patterns. Different models, prompts, and runs often hallucinate the exact same non-existent package names multiple times.

### How This POC Helps
SlopStorager gives registry maintainers (such as **npm maintainers**) and security teams a centralized store to track hallucinated package names over time:

- **Schema-Agnostic Ingestion**: Define custom **Schemas** (`CSV`, `JSON`, or `JSONL`) so datasets from any research benchmark or model evaluation pipeline can be ingested without writing one-off scripts.
- **Frequency & Recency Tracking**: Each package stores its cumulative `hallucinationCounts`, `firstDate`, and `lastDate`.
- **High-Risk Filtering (`minCount`)**: Filter packages by minimum hallucination frequency (e.g., `?minCount=10`) to surface names that models repeatedly invent and prioritize them for defensive blocking or reservation.
- **Registry Availability Check (`publishable`)**: Cross-check stored hallucinated names against the live npm registry via `GET /packages/publishable` to identify which repeated hallucinations are currently unclaimed and therefore exploitable.
- **Lifecycle Purge (`lastDate`)**: Because LLMs and their training cutoffs evolve, maintainers can periodically purge stale entries whose `lastDate` is on or before a cutoff date (`DELETE /packages?lastDate=YYYY-MM-DD`).

---

## Tech Stack

- **Runtime**: Node.js 20+ (ESM)
- **Web Framework**: Express 5 (`express`)
- **Database**: PostgreSQL 16 (`pg`)
- **File Uploads**: Multer (`multer`, 50 MB single-request limit + chunked upload CLI for larger files)
- **Registry Check**: `npm-name`
- **Tests**: Node built-in test runner (`node:test`, `node:assert/strict`)
- **Containerization**: Docker & Docker Compose

---

## Project Structure

```text
slopStorager/
├── bin/
│   └── chunk-upload.js          # Standalone CLI to split & upload large datasets in chunks
├── src/
│   ├── config/
│   │   └── db.js                # PostgreSQL pool, startup retry, and table initialization
│   ├── controllers/
│   │   ├── packages.controllers.js
│   │   └── schemas.controllers.js
│   ├── routes/
│   │   ├── packages.routes.js
│   │   └── schemas.routes.js
│   ├── services/
│   │   ├── packages.services.js # CRUD, upload upsert, publishability, and lastDate purge
│   │   └── schemas.services.js  # Schema persistence and validation
│   ├── utils/
│   │   ├── isPublishable.js     # Checks npm package name availability via npm-name
│   │   ├── querySelector.js     # Validates ?id=, ?name=, dates, and minCount params
│   │   └── schemaParser.js      # Parses CSV/JSON/JSONL datasets against custom schemas
│   └── main.js                  # Express app entry point
├── testDataset/                 # 7 sample CSV and JSON datasets in varied formats
├── tests/
│   ├── endpoints.test.js        # HTTP router & endpoint integration tests
│   ├── schemaParser.test.js     # Unit tests for dataset & schema token parsing
│   └── validators.test.js       # Unit tests for query selectors, dates, and minCount
├── database.jsonl               # Sample JSONL evaluation dataset
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## Getting Started

### Option 1: Docker Compose (Recommended)

Start both the PostgreSQL database (`slopstorager-postgres`) and the API server (`slopstorager-api`):

```bash
docker compose up -d --build
```

- **API Base URL**: `http://localhost:3000`
- **PostgreSQL**: `localhost:5432` (database: `slopstorager`, user/password: `postgres`/`postgres`)

On startup, `src/config/db.js` automatically creates the `packages` and `schemas` tables and indexes if they do not already exist.

### Option 2: Run Locally

Requires Node.js 20+ and a running PostgreSQL instance:

```bash
npm install
PORT=3000 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/slopstorager npm start
```

### Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP port the Express server listens on |
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/slopstorager` | PostgreSQL connection string |

---

## Database Model

### `schemas`
Stores registered dataset format templates.

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | `SERIAL PRIMARY KEY` | Auto-incrementing integer ID |
| `name` | `TEXT NOT NULL UNIQUE` | Schema identifier name |
| `format` | `VARCHAR(10) NOT NULL` | `'CSV'` or `'JSON'` |
| `schema` | `JSONB NOT NULL` | Column string (for CSV) or template object (for JSON/JSONL) |
| `created_at` | `TIMESTAMPTZ NOT NULL` | Creation timestamp |
| `updated_at` | `TIMESTAMPTZ NOT NULL` | Last update timestamp |

### `packages`
Stores aggregated hallucinated package metrics.

| Column | Type | Notes |
| :--- | :--- | :--- |
| `id` | `SERIAL PRIMARY KEY` | Auto-incrementing integer ID |
| `name` | `TEXT NOT NULL UNIQUE` | Package name |
| `hallucination_counts` | `INTEGER NOT NULL DEFAULT 1` | Total times observed (`>= 0`) |
| `first_date` | `TIMESTAMPTZ NOT NULL` | First recorded occurrence |
| `last_date` | `TIMESTAMPTZ NOT NULL` | Most recent occurrence (used for purge) |

---

## Schema Template Tokens

Before uploading a dataset, you register a **schema** describing which fields hold package names, how counts should be derived, and which fields to ignore.

| Token | Applies To | Behavior |
| :--- | :--- | :--- |
| `$NAME$` | CSV / JSON | Extracts a package name string (or every string in a JSON array) |
| `$NAME[<sep>]$` | CSV / JSON | Splits a single string by `<sep>` into multiple package names (e.g., `$NAME[,]$`) |
| `$COUNT$` | CSV / JSON | Uses the field's numeric value as the hallucination count |
| `$COUNT[<sep>]$` | CSV / JSON | Splits a string by `<sep>` and uses the number of items as the count (e.g., `$COUNT[;]$`) |
| `$ARRAY_AS_COUNT$` | JSON | Uses the length of a JSON array as the hallucination count |
| `$HALLUCINATION$` | CSV / JSON | Adds `1` hallucination per row/record regardless of the field's content |
| `$HALLUCINATION:<N>$` | CSV / JSON | Adds `N` hallucinations per row/record regardless of the field's content |
| `$IGNORE$` (or plain text) | CSV / JSON | Column/field is skipped |

Every schema must include at least one `$NAME$` / `$NAME[...]$` token and at least one count token (`$COUNT$`, `$COUNT[...]$`, `$ARRAY_AS_COUNT$`, or `$HALLUCINATION$`).

### Schema Examples

1. **CSV with comma-separated packages (1 count per line, e.g. `testDataset/1_model_prompt_packages.csv`)**:
   ```json
   {
     "name": "csv_model_prompt_packages",
     "format": "CSV",
     "schema": "$HALLUCINATION$,prompt,$NAME[,]$\n"
   }
   ```
2. **CSV with package name and explicit numeric count (`testDataset/3_package_hallucination_count.csv`)**:
   ```json
   {
     "name": "csv_package_count",
     "format": "CSV",
     "schema": "$NAME$,$COUNT$\n"
   }
   ```
3. **Nested JSON array of package objects (`testDataset/5_model_packages_amount.json`)**:
   ```json
   {
     "name": "json_model_packages_amount",
     "format": "JSON",
     "schema": {
       "model": "$IGNORE$",
       "packages": [
         {
           "name": "$NAME$",
           "amount": "$COUNT$"
         }
       ]
     }
   }
   ```
4. **JSONL with an array of hallucinated packages per record (`database.jsonl`)**:
   ```json
   {
     "name": "jsonl_database_modulenotfound",
     "format": "JSON",
     "schema": {
       "model": "$HALLUCINATION$",
       "modulenotfound": "$NAME$"
     }
   }
   ```

---

## API Reference

All single-resource operations and filters use **query parameters** (`?id=`, `?name=`, `?lastDate=`, `?minCount=`, `?schemaName=`).

### Schemas (`/schemas`)

#### `POST /schemas` — Register a Schema
- **Body (`application/json`)**:
  ```json
  {
    "name": "csv_package_count",
    "format": "CSV",
    "schema": "$NAME$,$COUNT$\n"
  }
  ```
- **Responses**: `201 Created`, `400 Bad Request` (missing/invalid tokens or format), `409 Conflict` (duplicate name).

#### `GET /schemas` — List or Fetch Schemas
- `GET /schemas` — Returns an array of all registered schemas (`200 OK`).
- `GET /schemas?id={id}` — Returns the matching schema object (`200 OK`, `400`, `404`).
- `GET /schemas?name={name}` — Returns the matching schema object (`200 OK`, `400`, `404`).

#### `PUT /schemas` — Update a Schema
- **Query**: `?id={id}` or `?name={name}` (mutually exclusive).
- **Body (`application/json`)**: Any subset of `{ "name", "format", "schema" }`.
- **Responses**: `200 OK`, `400 Bad Request`, `404 Not Found`, `409 Conflict`.

#### `DELETE /schemas` — Delete a Schema
- **Query**: `?id={id}` or `?name={name}`.
- **Responses**: `200 OK` (`{ "message": "Schema deleted successfully.", "schema": { ... } }`), `400 Bad Request`, `404 Not Found`.

---

### Packages (`/packages`)

#### `POST /packages/upload` — Bulk Upload Dataset
Parses and validates a dataset file against a schema, then atomically inserts new packages or increments `hallucinationCounts` and updates `lastDate` for existing packages.
- **Query (optional)**: `?schemaName={name}` (can also be sent as a form field). If provided, validates strictly against that schema (`404` if unknown, `400` if data does not conform). If omitted, tries all registered schemas and uses the first match.
- **Body**: `multipart/form-data` with key `file`, or raw text/JSON/CSV body (up to `50 MB`).
- **Response (`200 OK`)**:
  ```json
  {
    "message": "File uploaded and database populated successfully.",
    "schemaUsed": "csv_package_count",
    "recordsProcessed": 120,
    "packagesUpdated": 45,
    "totalHallucinationsAdded": 87
  }
  ```

#### `POST /packages` — Create a Package Manually
- **Body (`application/json`)**:
  ```json
  {
    "name": "example-hallucinated-pkg",
    "hallucinationCounts": 3,
    "firstDate": "2024-01-10T08:00:00.000Z",
    "lastDate": "2024-06-20T18:30:00.000Z"
  }
  ```
- **Date Rules**:
  - Neither `firstDate` nor `lastDate` passed → both default to `now`.
  - Only `lastDate` passed → `firstDate` is set equal to `lastDate`.
  - Only `firstDate` passed → `lastDate` defaults to `now`.
  - Future dates are rejected (`400 Bad Request`).
  - `firstDate > lastDate` is rejected (`400 Bad Request`).
- **Responses**: `201 Created`, `400 Bad Request`, `409 Conflict` (duplicate name).

#### `GET /packages` — Query Packages
- `GET /packages` or `GET /packages?minCount={n}` — Lists packages with `hallucinationCounts >= minCount` (default `1`), ordered by `hallucinationCounts DESC, name ASC`.
- `GET /packages?id={id}` or `GET /packages?name={name}` — Fetches a single package object (`200 OK`, `404 Not Found`). Cannot be combined with `minCount` (`400`).

#### `GET /packages/publishable` — Check npm Availability
- `GET /packages/publishable` or `GET /packages/publishable?minCount={n}`
- Returns the filtered package list enriched with `"isPublishable": true | false` checked live against npm via `npm-name`.

#### `PUT /packages` — Update a Package
- **Query**: `?id={id}` or `?name={name}`.
- **Body (`application/json`)**: Any subset of `{ "name", "hallucinationCounts", "firstDate", "lastDate" }` (enforces the same date and uniqueness rules).
- **Responses**: `200 OK`, `400 Bad Request`, `404 Not Found`, `409 Conflict`.

#### `DELETE /packages` — Purge by `lastDate` or Delete Single Package
- **Bulk Purge by Date**:
  `DELETE /packages?lastDate={YYYY-MM-DD}`
  Deletes all packages whose `lastDate <= YYYY-MM-DDT23:59:59.999Z` (also accepts full ISO timestamps; future dates are rejected with `400`).
- **Single Package Delete**:
  `DELETE /packages?name={name}` or `DELETE /packages?id={id}` (`404` if not found).
- **Response (`200 OK`)**:
  ```json
  {
    "message": "Package(s) deleted successfully.",
    "deletedCount": 2,
    "deletedPackages": [
      "old-pkg-a",
      "old-pkg-b"
    ]
  }
  ```

---

## Chunked Upload CLI (Large Datasets)

For datasets larger than the API's single-request 50 MB limit (or to stream huge `.csv`, `.jsonl`, or `.json` arrays smoothly), use [bin/chunk-upload.js](file:///Users/merendas/Documents/tcc/slopStorager/bin/chunk-upload.js):

```bash
npm run upload:chunk -- database.jsonl -s jsonl_database_modulenotfound -c 5
```

### CLI Options

| Flag | Default | Description |
| :--- | :--- | :--- |
| `<file>` / `-f, --file <path>` | *(required)* | Input `.csv`, `.jsonl`, or `.json` file |
| `-s, --schema <name>` | *(auto-detect)* | Registered schema name (`?schemaName=`) |
| `-u, --url <url>` | `http://localhost:3000` | Target API base URL (`API_URL` env var supported) |
| `-c, --chunk-size <mb>` | `5` | Max size per chunk in MB |
| `--keep-chunks` | `false` | Keep temporary split chunk files after upload |
| `-h, --help` | — | Show help message |

---

## Running Automated Tests

The test suite uses Node's built-in test runner (`node:test`) covering unit tests ([tests/schemaParser.test.js](file:///Users/merendas/Documents/tcc/slopStorager/tests/schemaParser.test.js), [tests/validators.test.js](file:///Users/merendas/Documents/tcc/slopStorager/tests/validators.test.js)) and HTTP endpoint/router tests ([tests/endpoints.test.js](file:///Users/merendas/Documents/tcc/slopStorager/tests/endpoints.test.js)).

### Run Inside Docker
```bash
docker compose exec api npm test
```

With code coverage report:
```bash
docker compose exec api node --test --experimental-test-coverage
```

### Run Locally
```bash
npm test
```

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
