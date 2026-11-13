import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

let server = null;
let setPoolFn = null;
let baseUrl = process.env.API_URL || "http://localhost:3000";
let schemasStore = [];
let packagesStore = [];
let nextSchemaId = 1;
let nextPackageId = 1;

function createMockPool() {
  return {
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();

      // --- SCHEMAS QUERIES ---
      if (normalized.startsWith("SELECT id FROM schemas WHERE name = $1")) {
        const found = schemasStore.filter((s) => s.name === params[0]);
        return { rows: found, rowCount: found.length };
      }

      if (normalized.startsWith("INSERT INTO schemas")) {
        const [name, format, rawSchema] = params;
        const row = {
          id: nextSchemaId++,
          name,
          format,
          schema: JSON.parse(rawSchema),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        schemasStore.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (
        normalized.startsWith("SELECT ") &&
        normalized.includes("FROM schemas ORDER BY")
      ) {
        return { rows: [...schemasStore], rowCount: schemasStore.length };
      }

      if (
        normalized.startsWith("SELECT ") &&
        normalized.includes("FROM schemas WHERE id = $1")
      ) {
        const found = schemasStore.filter((s) => s.id === params[0]);
        return { rows: found, rowCount: found.length };
      }

      if (
        normalized.startsWith("SELECT ") &&
        normalized.includes("FROM schemas WHERE name = $1")
      ) {
        const found = schemasStore.filter((s) => s.name === params[0]);
        return { rows: found, rowCount: found.length };
      }

      if (normalized.startsWith("UPDATE schemas")) {
        const [name, format, rawSchema, id] = params;
        const idx = schemasStore.findIndex((s) => s.id === id);
        if (idx === -1) return { rows: [], rowCount: 0 };
        schemasStore[idx] = {
          ...schemasStore[idx],
          name,
          format,
          schema: JSON.parse(rawSchema),
          updatedAt: new Date().toISOString(),
        };
        return { rows: [schemasStore[idx]], rowCount: 1 };
      }

      if (normalized.startsWith("DELETE FROM schemas WHERE")) {
        const byId = normalized.includes("WHERE id = $1");
        const idx = schemasStore.findIndex((s) =>
          byId ? s.id === params[0] : s.name === params[0],
        );
        if (idx === -1) return { rows: [], rowCount: 0 };
        const [deleted] = schemasStore.splice(idx, 1);
        return { rows: [deleted], rowCount: 1 };
      }

      // --- PACKAGES QUERIES ---
      if (normalized.startsWith("SELECT id FROM packages WHERE name = $1")) {
        const found = packagesStore.filter((p) => p.name === params[0]);
        return { rows: found, rowCount: found.length };
      }

      if (normalized.includes("ON CONFLICT (name) DO UPDATE")) {
        for (let i = 0; i < params.length; i += 4) {
          const [name, count, firstDate, lastDate] = params.slice(i, i + 4);
          const existing = packagesStore.find((p) => p.name === name);
          if (existing) {
            existing.hallucinationCounts += count;
            existing.lastDate = new Date(lastDate).toISOString();
          } else {
            packagesStore.push({
              id: nextPackageId++,
              name,
              hallucinationCounts: count,
              firstDate: new Date(firstDate).toISOString(),
              lastDate: new Date(lastDate).toISOString(),
            });
          }
        }
        return { rows: [], rowCount: params.length / 4 };
      }

      if (normalized.startsWith("INSERT INTO packages")) {
        const [name, hallucinationCounts, firstDate, lastDate] = params;
        const row = {
          id: nextPackageId++,
          name,
          hallucinationCounts,
          firstDate: new Date(firstDate).toISOString(),
          lastDate: new Date(lastDate).toISOString(),
        };
        packagesStore.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (
        normalized.startsWith("SELECT ") &&
        normalized.includes("FROM packages WHERE hallucination_counts >= $1")
      ) {
        const minCount = params[0];
        const rows = packagesStore
          .filter((p) => p.hallucinationCounts >= minCount)
          .sort(
            (a, b) =>
              b.hallucinationCounts - a.hallucinationCounts ||
              a.name.localeCompare(b.name),
          );
        return { rows, rowCount: rows.length };
      }

      if (
        normalized.startsWith("SELECT ") &&
        normalized.includes("FROM packages WHERE id = $1")
      ) {
        const found = packagesStore.filter((p) => p.id === params[0]);
        return { rows: found, rowCount: found.length };
      }

      if (
        normalized.startsWith("SELECT ") &&
        normalized.includes("FROM packages WHERE name = $1")
      ) {
        const found = packagesStore.filter((p) => p.name === params[0]);
        return { rows: found, rowCount: found.length };
      }

      if (normalized.startsWith("UPDATE packages")) {
        const [name, hallucinationCounts, firstDate, lastDate, id] = params;
        const idx = packagesStore.findIndex((p) => p.id === id);
        if (idx === -1) return { rows: [], rowCount: 0 };
        packagesStore[idx] = {
          id,
          name,
          hallucinationCounts,
          firstDate: new Date(firstDate).toISOString(),
          lastDate: new Date(lastDate).toISOString(),
        };
        return { rows: [packagesStore[idx]], rowCount: 1 };
      }

      if (normalized.startsWith("DELETE FROM packages WHERE last_date <= $1")) {
        const cutoffMs = new Date(params[0]).getTime();
        const deleted = [];
        packagesStore = packagesStore.filter((p) => {
          if (new Date(p.lastDate).getTime() <= cutoffMs) {
            deleted.push({ name: p.name });
            return false;
          }
          return true;
        });
        return { rows: deleted, rowCount: deleted.length };
      }

      if (normalized.startsWith("DELETE FROM packages WHERE")) {
        const byId = normalized.includes("WHERE id = $1");
        const idx = packagesStore.findIndex((p) =>
          byId ? p.id === params[0] : p.name === params[0],
        );
        if (idx === -1) return { rows: [], rowCount: 0 };
        const [deleted] = packagesStore.splice(idx, 1);
        return { rows: [{ name: deleted.name }], rowCount: 1 };
      }

      throw new Error(`Unhandled SQL in mock pool: ${normalized}`);
    },
  };
}

async function apiRequest(method, path, body, contentType = "application/json") {
  const headers = {};
  let payload;
  if (body !== undefined) {
    headers["Content-Type"] = contentType;
    payload =
      contentType === "application/json" ? JSON.stringify(body) : String(body);
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: payload,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

describe("HTTP Endpoint & Router Tests (/schemas & /packages)", () => {
  before(async () => {
    try {
      const [{ app }, { setPool }] = await Promise.all([
        import("../src/main.js"),
        import("../src/config/db.js"),
      ]);
      setPoolFn = setPool;
      setPool(createMockPool());
      await new Promise((resolve) => {
        server = app.listen(0, "127.0.0.1", () => {
          const { port } = server.address();
          baseUrl = `http://127.0.0.1:${port}`;
          resolve();
        });
      });
    } catch {
      // Fallback to running container at baseUrl if local node_modules lacks express/pg
    }
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (setPoolFn) {
      setPoolFn(null);
    }
  });

  beforeEach(() => {
    schemasStore = [];
    packagesStore = [];
    nextSchemaId = 1;
    nextPackageId = 1;
  });

  it("handles /schemas CRUD and query parameter validation", async () => {
    // Ensure clean state for test schema names
    await apiRequest("DELETE", "/schemas?name=__test_csv_counts");
    await apiRequest("DELETE", "/schemas?name=__test_csv_counts_updated");

    // POST /schemas -> 201
    const createRes = await apiRequest("POST", "/schemas", {
      name: "__test_csv_counts",
      format: "CSV",
      schema: "$NAME$,$COUNT$",
    });
    assert.equal(createRes.status, 201);
    const schemaId = createRes.data.schema.id;
    assert.equal(typeof schemaId, "number");

    // Duplicate POST /schemas -> 409
    const dupRes = await apiRequest("POST", "/schemas", {
      name: "__test_csv_counts",
      format: "CSV",
      schema: "$NAME$,$COUNT$",
    });
    assert.equal(dupRes.status, 409);

    // GET /schemas (all) -> 200 array
    const listRes = await apiRequest("GET", "/schemas");
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.data));
    assert.ok(listRes.data.some((s) => s.id === schemaId));

    // GET /schemas?id= and ?name= -> 200 object
    const byId = await apiRequest("GET", `/schemas?id=${schemaId}`);
    assert.equal(byId.status, 200);
    assert.equal(byId.data.name, "__test_csv_counts");

    const byName = await apiRequest("GET", "/schemas?name=__test_csv_counts");
    assert.equal(byName.status, 200);
    assert.equal(byName.data.id, schemaId);

    // Rejects passing both ?id= and ?name= -> 400
    const bothParams = await apiRequest(
      "GET",
      `/schemas?id=${schemaId}&name=__test_csv_counts`,
    );
    assert.equal(bothParams.status, 400);

    // PUT /schemas?id= -> 200
    const updateRes = await apiRequest("PUT", `/schemas?id=${schemaId}`, {
      name: "__test_csv_counts_updated",
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.data.schema.name, "__test_csv_counts_updated");

    // DELETE /schemas?name= -> 200
    const delRes = await apiRequest(
      "DELETE",
      "/schemas?name=__test_csv_counts_updated",
    );
    assert.equal(delRes.status, 200);

    // Verify 404 after deletion
    const notFound = await apiRequest("GET", `/schemas?id=${schemaId}`);
    assert.equal(notFound.status, 404);
  });

  it("handles /packages CRUD, date validation, upload, and ?lastDate= purge", async () => {
    await apiRequest("DELETE", "/packages?name=__test_old_pkg_1975");
    await apiRequest(
      "DELETE",
      `/packages?name=${encodeURIComponent("@__test_scope/recent-pkg")}`,
    );
    await apiRequest("DELETE", "/packages?name=__test_uploaded_pkg");
    await apiRequest("DELETE", "/schemas?name=__test_simple_csv");

    // Create package with only lastDate -> firstDate equals lastDate
    const createOld = await apiRequest("POST", "/packages", {
      name: "__test_old_pkg_1975",
      hallucinationCounts: 5,
      lastDate: "1975-05-10T00:00:00.000Z",
    });
    assert.equal(createOld.status, 201);
    const oldPkgId = createOld.data.package.id;
    assert.equal(
      createOld.data.package.firstDate,
      "1975-05-10T00:00:00.000Z",
    );

    // Create package with default dates
    const createRecent = await apiRequest("POST", "/packages", {
      name: "@__test_scope/recent-pkg",
      hallucinationCounts: 12,
    });
    assert.equal(createRecent.status, 201);
    const recentPkgId = createRecent.data.package.id;

    // Reject firstDate > lastDate -> 400
    const badOrder = await apiRequest("POST", "/packages", {
      name: "__test_bad_dates",
      firstDate: "2025-05-10T00:00:00.000Z",
      lastDate: "2025-01-01T00:00:00.000Z",
    });
    assert.equal(badOrder.status, 400);

    // Reject future date -> 400
    const futureRes = await apiRequest("POST", "/packages", {
      name: "__test_future_pkg",
      lastDate: "2099-01-01T00:00:00.000Z",
    });
    assert.equal(futureRes.status, 400);

    // GET /packages?minCount=10 -> includes @__test_scope/recent-pkg and excludes __test_old_pkg_1975
    const filtered = await apiRequest("GET", "/packages?minCount=10");
    assert.equal(filtered.status, 200);
    assert.ok(filtered.data.some((p) => p.name === "@__test_scope/recent-pkg"));
    assert.ok(!filtered.data.some((p) => p.name === "__test_old_pkg_1975"));

    // GET /packages?name=@__test_scope/recent-pkg -> 200 single object
    const byName = await apiRequest(
      "GET",
      `/packages?name=${encodeURIComponent("@__test_scope/recent-pkg")}`,
    );
    assert.equal(byName.status, 200);
    assert.equal(byName.data.id, recentPkgId);
    assert.equal(byName.data.hallucinationCounts, 12);

    // Reject combining ?minCount= and ?id= -> 400
    const combinedGet = await apiRequest(
      "GET",
      `/packages?id=${oldPkgId}&minCount=5`,
    );
    assert.equal(combinedGet.status, 400);

    // PUT /packages?id= -> 200
    const putRes = await apiRequest("PUT", `/packages?id=${oldPkgId}`, {
      hallucinationCounts: 20,
      lastDate: "1975-06-01T00:00:00.000Z",
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.data.package.hallucinationCounts, 20);

    // Upload dataset via POST /packages/upload?schemaName=...
    const schemaRes = await apiRequest("POST", "/schemas", {
      name: "__test_simple_csv",
      format: "CSV",
      schema: "$NAME$,$COUNT$",
    });
    assert.equal(schemaRes.status, 201);

    const uploadRes = await apiRequest(
      "POST",
      "/packages/upload?schemaName=__test_simple_csv",
      "__test_uploaded_pkg,7\n",
      "text/plain",
    );
    assert.equal(uploadRes.status, 200);
    assert.equal(uploadRes.data.packagesUpdated, 1);

    // DELETE /packages?lastDate=1975-12-31 -> purges __test_old_pkg_1975
    const purgeRes = await apiRequest(
      "DELETE",
      "/packages?lastDate=1975-12-31",
    );
    assert.equal(purgeRes.status, 200);
    assert.ok(purgeRes.data.deletedPackages.includes("__test_old_pkg_1975"));

    // Clean up remaining test packages & schema via DELETE ?name= and ?id=
    const singleDel = await apiRequest(
      "DELETE",
      "/packages?name=__test_uploaded_pkg",
    );
    assert.equal(singleDel.status, 200);
    assert.deepEqual(singleDel.data.deletedPackages, ["__test_uploaded_pkg"]);

    const idDel = await apiRequest("DELETE", `/packages?id=${recentPkgId}`);
    assert.equal(idDel.status, 200);
    assert.deepEqual(idDel.data.deletedPackages, ["@__test_scope/recent-pkg"]);

    const pkgNotFound = await apiRequest("GET", `/packages?id=${recentPkgId}`);
    assert.equal(pkgNotFound.status, 404);

    await apiRequest("DELETE", "/schemas?name=__test_simple_csv");

    // Reject DELETE without selector -> 400
    const emptyDel = await apiRequest("DELETE", "/packages");
    assert.equal(emptyDel.status, 400);
  });
});
