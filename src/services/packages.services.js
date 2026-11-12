import { query } from "../config/db.js";
import { validateAndParseWithSchema } from "../utils/schemaParser.js";
import { checkIfItsPublishable } from "../utils/isPublishable.js";
import { findSchemaByName, getAllSchemas } from "./schemas.services.js";

const SELECT_PACKAGE_COLUMNS = `
  id,
  name,
  hallucination_counts AS "hallucinationCounts",
  first_date AS "firstDate",
  last_date AS "lastDate"
`;

/**
 * Creates an Error instance with an attached HTTP statusCode.
 * @param {number} statusCode
 * @param {string} message
 * @returns {Error & { statusCode: number }}
 */
function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Parses `/packages/:identifier` where identifier is `id={id}` or `name={name}`.
 * @param {string} identifier
 * @returns {{ column: 'id' | 'name', value: number | string }}
 */
export function parsePackageIdentifier(identifier) {
  if (!identifier) {
    throw createHttpError(
      400,
      "Package identifier is required (use id={id} or name={name}).",
    );
  }

  if (identifier.startsWith("id=")) {
    const rawId = identifier.slice(3).trim();
    if (!/^[1-9]\d*$/.test(rawId)) {
      throw createHttpError(400, `Invalid package id "${rawId}".`);
    }
    return { column: "id", value: Number(rawId) };
  }

  if (identifier.startsWith("name=")) {
    const name = decodeURIComponent(identifier.slice(5).trim());
    if (!name) {
      throw createHttpError(400, "Package name cannot be empty.");
    }
    return { column: "name", value: name };
  }

  throw createHttpError(
    400,
    "Invalid package selector. Use /packages/id={id} or /packages/name={name}.",
  );
}

/**
 * Parses and validates an ISO 8601 date string (`YYYY-MM-DD` or full ISO timestamp).
 * Ensures the date is not in the future.
 * @param {unknown} rawDate
 * @param {string} fieldName
 * @param {{ endOfDayIfDateOnly?: boolean, now?: Date }} [options]
 * @returns {Date}
 */
export function parseAndValidateDate(
  rawDate,
  fieldName,
  { endOfDayIfDateOnly = false, now = new Date() } = {},
) {
  if (typeof rawDate !== "string" || !rawDate.trim()) {
    throw createHttpError(
      400,
      `Field "${fieldName}" must be a valid ISO 8601 date string (e.g. YYYY-MM-DD).`,
    );
  }

  const trimmed = rawDate.trim();
  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);

  if (dateOnlyMatch) {
    const startOfDay = new Date(`${trimmed}T00:00:00.000Z`);
    if (
      Number.isNaN(startOfDay.getTime()) ||
      startOfDay.toISOString().slice(0, 10) !== trimmed
    ) {
      throw createHttpError(
        400,
        `Field "${fieldName}" is not a valid calendar date (expected YYYY-MM-DD).`,
      );
    }

    if (startOfDay.getTime() > now.getTime()) {
      throw createHttpError(
        400,
        `Field "${fieldName}" cannot be a future date.`,
      );
    }

    if (endOfDayIfDateOnly) {
      return new Date(`${trimmed}T23:59:59.999Z`);
    }
    return startOfDay;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(
      400,
      `Field "${fieldName}" must be a valid ISO 8601 date string (e.g. YYYY-MM-DD).`,
    );
  }

  if (parsed.getTime() > now.getTime()) {
    throw createHttpError(400, `Field "${fieldName}" cannot be a future date.`);
  }

  return parsed;
}

/**
 * Parses and validates the `minCount` query parameter.
 * @param {unknown} rawMinCount
 * @returns {number}
 */
export function parseMinCount(rawMinCount) {
  if (rawMinCount === undefined || rawMinCount === "") {
    return 1;
  }
  const parsed = Number(rawMinCount);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createHttpError(
      400,
      'Query parameter "minCount" must be a non-negative number.',
    );
  }
  return Math.floor(parsed);
}

/**
 * Creates a single package in PostgreSQL.
 * Date rules:
 *  - If neither firstDate nor lastDate is passed: both default to new Date().
 *  - If lastDate is passed without firstDate: firstDate = lastDate.
 *  - If firstDate is passed without lastDate: lastDate = new Date().
 *  - Neither firstDate nor lastDate can be in the future.
 *  - firstDate cannot be after lastDate.
 * @param {{ name?: string, hallucinationCounts?: unknown, firstDate?: string, lastDate?: string }} payload
 */
export async function createPackage(payload) {
  if (!payload || typeof payload !== "object") {
    throw createHttpError(400, "Request body must be a JSON object.");
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!name) {
    throw createHttpError(
      400,
      'Field "name" is required and must be a non-empty string.',
    );
  }

  let hallucinationCounts = 1;
  if (payload.hallucinationCounts !== undefined) {
    const parsedCount = Number(payload.hallucinationCounts);
    if (!Number.isFinite(parsedCount) || parsedCount < 0) {
      throw createHttpError(
        400,
        'Field "hallucinationCounts" must be a non-negative number.',
      );
    }
    hallucinationCounts = Math.floor(parsedCount);
  }

  const now = new Date();
  const hasFirstDate =
    payload.firstDate !== undefined &&
    payload.firstDate !== null &&
    payload.firstDate !== "";
  const hasLastDate =
    payload.lastDate !== undefined &&
    payload.lastDate !== null &&
    payload.lastDate !== "";

  let firstDate;
  let lastDate;

  if (!hasFirstDate && !hasLastDate) {
    firstDate = now;
    lastDate = now;
  } else if (!hasFirstDate && hasLastDate) {
    lastDate = parseAndValidateDate(payload.lastDate, "lastDate", { now });
    firstDate = new Date(lastDate.getTime());
  } else if (hasFirstDate && !hasLastDate) {
    firstDate = parseAndValidateDate(payload.firstDate, "firstDate", { now });
    lastDate = now;
  } else {
    firstDate = parseAndValidateDate(payload.firstDate, "firstDate", { now });
    lastDate = parseAndValidateDate(payload.lastDate, "lastDate", { now });
  }

  if (firstDate.getTime() > lastDate.getTime()) {
    throw createHttpError(400, 'Field "firstDate" cannot be after "lastDate".');
  }

  const existing = await query("SELECT id FROM packages WHERE name = $1", [
    name,
  ]);
  if (existing.rowCount > 0) {
    throw createHttpError(409, `A package with name "${name}" already exists.`);
  }

  const result = await query(
    `INSERT INTO packages (name, hallucination_counts, first_date, last_date)
     VALUES ($1, $2, $3, $4)
     RETURNING ${SELECT_PACKAGE_COLUMNS}`,
    [name, hallucinationCounts, firstDate, lastDate],
  );

  return result.rows[0];
}

/**
 * Validates uploaded dataset content against a registered schema (by schemaName or auto-detected)
 * and bulk-upserts package hallucination counts into PostgreSQL.
 * @param {{ content: string, schemaName?: string | null }} params
 */
export async function processPackageUpload({ content, schemaName }) {
  let matchedSchema = null;
  let parseResult = null;

  if (schemaName) {
    matchedSchema = await findSchemaByName(schemaName);
    if (!matchedSchema) {
      throw createHttpError(404, `Schema "${schemaName}" not found.`);
    }

    parseResult = validateAndParseWithSchema(content, matchedSchema);
    if (!parseResult.valid) {
      throw createHttpError(
        400,
        `Uploaded data does not match schema "${schemaName}": ${parseResult.error}`,
      );
    }
  } else {
    const allSchemas = await getAllSchemas();
    if (allSchemas.length === 0) {
      throw createHttpError(
        400,
        "No schemas registered in the database. Register a schema via POST /schemas first.",
      );
    }

    for (const candidate of allSchemas) {
      const attempt = validateAndParseWithSchema(content, candidate);
      if (attempt.valid && attempt.counts && attempt.counts.length > 0) {
        matchedSchema = candidate;
        parseResult = attempt;
        break;
      }
    }

    if (!matchedSchema || !parseResult) {
      throw createHttpError(
        400,
        "Uploaded data did not match any registered schema. Specify ?schemaName=<name> to see detailed validation errors.",
      );
    }
  }

  const { counts, recordsProcessed } = parseResult;
  const now = new Date();
  let totalHallucinationsAdded = 0;

  if (counts.length > 0) {
    const BATCH_SIZE = 500;
    for (let i = 0; i < counts.length; i += BATCH_SIZE) {
      const slice = counts.slice(i, i + BATCH_SIZE);
      const values = [];
      const placeholders = slice.map(([name, count], idx) => {
        totalHallucinationsAdded += count;
        const base = idx * 4;
        values.push(name, count, now, now);
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
      });

      await query(
        `INSERT INTO packages (name, hallucination_counts, first_date, last_date)
         VALUES ${placeholders.join(", ")}
         ON CONFLICT (name) DO UPDATE
         SET hallucination_counts = packages.hallucination_counts + EXCLUDED.hallucination_counts,
             last_date = EXCLUDED.last_date`,
        values,
      );
    }
  }

  return {
    schemaUsed: matchedSchema.name,
    recordsProcessed,
    packagesUpdated: counts.length,
    totalHallucinationsAdded,
  };
}

/**
 * Returns all packages with `hallucinationCounts >= minCount`, sorted descending.
 * @param {unknown} rawMinCount
 */
export async function getPackagesByMinCount(rawMinCount) {
  const minCount = parseMinCount(rawMinCount);
  const result = await query(
    `SELECT ${SELECT_PACKAGE_COLUMNS}
     FROM packages
     WHERE hallucination_counts >= $1
     ORDER BY hallucination_counts DESC, name ASC`,
    [minCount],
  );
  return result.rows;
}

/**
 * Returns all packages with `hallucinationCounts >= minCount` enriched with `isPublishable: boolean`.
 * @param {unknown} rawMinCount
 */
export async function getPublishablePackagesByMinCount(rawMinCount) {
  const packages = await getPackagesByMinCount(rawMinCount);

  return Promise.all(
    packages.map(async (pkg) => {
      const isPublishable = await checkIfItsPublishable(pkg.name);
      return {
        ...pkg,
        isPublishable,
      };
    }),
  );
}

/**
 * Retrieves a single package by `id={id}` or `name={name}` identifier.
 * @param {string} identifier
 */
export async function getPackageByIdentifier(identifier) {
  const { column, value } = parsePackageIdentifier(identifier);
  const result = await query(
    `SELECT ${SELECT_PACKAGE_COLUMNS} FROM packages WHERE ${column} = $1`,
    [value],
  );
  if (result.rowCount === 0) {
    throw createHttpError(404, "Package not found.");
  }
  return result.rows[0];
}

/**
 * Updates an existing package identified by `id={id}` or `name={name}`.
 * Enforces date rules (no future dates, firstDate <= lastDate).
 * @param {string} identifier
 * @param {{ name?: string, hallucinationCounts?: unknown, firstDate?: string, lastDate?: string }} payload
 */
export async function updatePackageByIdentifier(identifier, payload) {
  if (!payload || typeof payload !== "object") {
    throw createHttpError(400, "Request body must be a JSON object.");
  }

  const existing = await getPackageByIdentifier(identifier);

  let newName = existing.name;
  if (payload.name !== undefined) {
    const trimmedName =
      typeof payload.name === "string" ? payload.name.trim() : "";
    if (!trimmedName) {
      throw createHttpError(400, 'Field "name" cannot be empty.');
    }
    newName = trimmedName;
  }

  if (newName !== existing.name) {
    const duplicate = await query("SELECT id FROM packages WHERE name = $1", [
      newName,
    ]);
    if (duplicate.rowCount > 0) {
      throw createHttpError(
        409,
        `A package with name "${newName}" already exists.`,
      );
    }
  }

  let newCounts = existing.hallucinationCounts;
  if (payload.hallucinationCounts !== undefined) {
    const parsedCount = Number(payload.hallucinationCounts);
    if (!Number.isFinite(parsedCount) || parsedCount < 0) {
      throw createHttpError(
        400,
        'Field "hallucinationCounts" must be a non-negative number.',
      );
    }
    newCounts = Math.floor(parsedCount);
  }

  const now = new Date();
  let newFirstDate =
    existing.firstDate instanceof Date
      ? existing.firstDate
      : new Date(existing.firstDate);
  let newLastDate =
    existing.lastDate instanceof Date
      ? existing.lastDate
      : new Date(existing.lastDate);

  if (
    payload.firstDate !== undefined &&
    payload.firstDate !== null &&
    payload.firstDate !== ""
  ) {
    newFirstDate = parseAndValidateDate(payload.firstDate, "firstDate", {
      now,
    });
  }

  if (
    payload.lastDate !== undefined &&
    payload.lastDate !== null &&
    payload.lastDate !== ""
  ) {
    newLastDate = parseAndValidateDate(payload.lastDate, "lastDate", { now });
  } else {
    newLastDate = now;
  }

  if (newFirstDate.getTime() > newLastDate.getTime()) {
    throw createHttpError(400, 'Field "firstDate" cannot be after "lastDate".');
  }

  const result = await query(
    `UPDATE packages
     SET name = $1, hallucination_counts = $2, first_date = $3, last_date = $4
     WHERE id = $5
     RETURNING ${SELECT_PACKAGE_COLUMNS}`,
    [newName, newCounts, newFirstDate, newLastDate, existing.id],
  );

  return result.rows[0];
}

/**
 * Deletes packages by `lastDate` (purging all packages with lastDate <= cutoffDate)
 * or deletes a single package by `name` (or `id`) if `lastDate` is not provided.
 * Returns `{ deletedCount: number, deletedPackages: string[] }`.
 * @param {{ identifier?: string, query?: Record<string, unknown> }} params
 */
export async function deletePackages({ identifier, query: reqQuery = {} }) {
  let rawLastDate =
    typeof reqQuery.lastDate === "string" && reqQuery.lastDate.trim()
      ? reqQuery.lastDate.trim()
      : null;
  let rawName =
    typeof reqQuery.name === "string" && reqQuery.name.trim()
      ? reqQuery.name.trim()
      : null;
  let rawId =
    typeof reqQuery.id === "string" && reqQuery.id.trim()
      ? reqQuery.id.trim()
      : null;

  if (identifier) {
    if (identifier.startsWith("lastDate=")) {
      rawLastDate = decodeURIComponent(identifier.slice(9).trim());
    } else if (identifier.startsWith("name=")) {
      rawName = decodeURIComponent(identifier.slice(5).trim());
    } else if (identifier.startsWith("id=")) {
      rawId = identifier.slice(3).trim();
    } else {
      throw createHttpError(
        400,
        "Invalid delete selector. Use lastDate={YYYY-MM-DD}, name={name}, or id={id}.",
      );
    }
  }

  // Case 1: Purge by lastDate (deletes all packages with lastDate <= cutoffDate)
  if (rawLastDate !== null) {
    const cutoffDate = parseAndValidateDate(rawLastDate, "lastDate", {
      endOfDayIfDateOnly: true,
    });

    const result = await query(
      `DELETE FROM packages
       WHERE last_date <= $1
       RETURNING name`,
      [cutoffDate],
    );

    const deletedPackages = result.rows.map((r) => r.name).sort();

    return {
      deletedCount: deletedPackages.length,
      deletedPackages,
    };
  }

  // Case 2: Delete single package by name (or id)
  let column;
  let value;
  if (rawName) {
    column = "name";
    value = rawName;
  } else if (rawId) {
    if (!/^[1-9]\d*$/.test(rawId)) {
      throw createHttpError(400, `Invalid package id "${rawId}".`);
    }
    column = "id";
    value = Number(rawId);
  } else {
    throw createHttpError(
      400,
      'Must provide either "lastDate" (ISO 8601 YYYY-MM-DD) or "name" to delete packages.',
    );
  }

  const deleted = await query(
    `DELETE FROM packages WHERE ${column} = $1 RETURNING name`,
    [value],
  );
  if (deleted.rowCount === 0) {
    throw createHttpError(404, "Package not found.");
  }

  return {
    deletedCount: 1,
    deletedPackages: [deleted.rows[0].name],
  };
}
