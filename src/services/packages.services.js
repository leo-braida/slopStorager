import { query } from "../config/db.js";
import { validateAndParseWithSchema } from "../utils/schemaParser.js";
import { checkIfItsPublishable } from "../utils/isPublishable.js";
import {
  createHttpError,
  parseIdOrNameQuery,
  parseAndValidateDate,
  parseMinCount,
} from "../utils/querySelector.js";
import { findSchemaByName, getAllSchemas } from "./schemas.services.js";

export { parseAndValidateDate, parseMinCount };

const SELECT_PACKAGE_COLUMNS = `
  id,
  name,
  hallucination_counts AS "hallucinationCounts",
  first_date AS "firstDate",
  last_date AS "lastDate"
`;

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
 * Retrieves a single package using `{ column, value }` selector.
 * @param {{ column: 'id' | 'name', value: number | string }} selector
 */
async function getPackageBySelector(selector) {
  const result = await query(
    `SELECT ${SELECT_PACKAGE_COLUMNS} FROM packages WHERE ${selector.column} = $1`,
    [selector.value],
  );
  if (result.rowCount === 0) {
    throw createHttpError(404, "Package not found.");
  }
  return result.rows[0];
}

/**
 * Retrieves packages matching `?minCount=` or a single package via `?id={id}` / `?name={name}`.
 * @param {Record<string, unknown>} [reqQuery]
 */
export async function getPackages(reqQuery = {}) {
  const selector = parseIdOrNameQuery(reqQuery, "Package", { required: false });
  if (selector) {
    if (reqQuery.minCount !== undefined) {
      throw createHttpError(400, 'Cannot combine "minCount" with "id" or "name".');
    }
    return getPackageBySelector(selector);
  }
  return getPackagesByMinCount(reqQuery.minCount);
}

/**
 * Retrieves a single package by `?id={id}` or `?name={name}` query parameter.
 * @param {Record<string, unknown>} reqQuery
 */
export async function getPackageByQuery(reqQuery) {
  const selector = parseIdOrNameQuery(reqQuery, "Package", { required: true });
  return getPackageBySelector(selector);
}

/**
 * Updates an existing package identified by `?id={id}` or `?name={name}` query parameter.
 * Enforces date rules (no future dates, firstDate <= lastDate).
 * @param {Record<string, unknown>} reqQuery
 * @param {{ name?: string, hallucinationCounts?: unknown, firstDate?: string, lastDate?: string }} payload
 */
export async function updatePackageByQuery(reqQuery, payload) {
  if (!payload || typeof payload !== "object") {
    throw createHttpError(400, "Request body must be a JSON object.");
  }

  const existing = await getPackageByQuery(reqQuery);

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
 * Deletes packages by `?lastDate={YYYY-MM-DD}` (purging all packages with lastDate <= cutoffDate)
 * or deletes a single package by `?name={name}` or `?id={id}`.
 * Returns `{ deletedCount: number, deletedPackages: string[] }`.
 * @param {Record<string, unknown>} [reqQuery]
 */
export async function deletePackages(reqQuery = {}) {
  const hasLastDate = reqQuery?.lastDate !== undefined;
  const selector = parseIdOrNameQuery(reqQuery, "Package", { required: false });

  if (hasLastDate && selector) {
    throw createHttpError(
      400,
      'Provide either "lastDate" or a single selector ("id" or "name"), not both.',
    );
  }

  // Case 1: Purge by lastDate (deletes all packages with lastDate <= cutoffDate)
  if (hasLastDate) {
    const cutoffDate = parseAndValidateDate(reqQuery.lastDate, "lastDate", {
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
  if (!selector) {
    throw createHttpError(
      400,
      'Must provide either "lastDate" (ISO 8601 YYYY-MM-DD), "id", or "name" to delete packages.',
    );
  }

  const deleted = await query(
    `DELETE FROM packages WHERE ${selector.column} = $1 RETURNING name`,
    [selector.value],
  );
  if (deleted.rowCount === 0) {
    throw createHttpError(404, "Package not found.");
  }

  return {
    deletedCount: 1,
    deletedPackages: [deleted.rows[0].name],
  };
}
