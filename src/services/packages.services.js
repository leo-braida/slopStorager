import { getPackagesCollection } from "../config/db.js";
import { validateAndParseWithSchema } from "../utils/schemaParser.js";
import { checkIfItsPublishable } from "../utils/isPublishable.js";
import { findSchemaByName, getAllSchemas } from "./schemas.services.js";

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
 * Validates uploaded dataset content against a registered schema (by schemaName or auto-detected)
 * and bulk-upserts package hallucination counts into the database.
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
  const packagesCol = getPackagesCollection();
  const now = new Date();
  let totalHallucinationsAdded = 0;

  if (counts.length > 0) {
    const operations = counts.map(([name, count]) => {
      totalHallucinationsAdded += count;
      return {
        updateOne: {
          filter: { name },
          update: {
            $inc: { hallucinationCounts: count },
            $set: { lastDate: now },
            $setOnInsert: { name, firstDate: now },
          },
          upsert: true,
        },
      };
    });

    await packagesCol.bulkWrite(operations);
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
  const packagesCol = getPackagesCollection();

  return packagesCol
    .find(
      { hallucinationCounts: { $gte: minCount } },
      { projection: { _id: 0 } },
    )
    .sort({ hallucinationCounts: -1, name: 1 })
    .toArray();
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
