import { ObjectId } from "mongodb";
import { getSchemasCollection } from "../config/db.js";
import { validateSchemaDefinition } from "../utils/schemaParser.js";

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
 * Parses `/schemas/:identifier` where identifier is `id={id}` or `name={name}`.
 * @param {string} identifier
 * @returns {Record<string, unknown>}
 */
export function parseSchemaIdentifier(identifier) {
  if (!identifier) {
    throw createHttpError(
      400,
      "Schema identifier is required (use id={id} or name={name}).",
    );
  }

  if (identifier.startsWith("id=")) {
    const rawId = identifier.slice(3).trim();
    if (!ObjectId.isValid(rawId)) {
      throw createHttpError(400, `Invalid schema id "${rawId}".`);
    }
    return { _id: new ObjectId(rawId) };
  }

  if (identifier.startsWith("name=")) {
    const name = decodeURIComponent(identifier.slice(5).trim());
    if (!name) {
      throw createHttpError(400, "Schema name cannot be empty.");
    }
    return { name };
  }

  throw createHttpError(
    400,
    "Invalid schema selector. Use /schemas/id={id} or /schemas/name={name}.",
  );
}

/**
 * Creates and persists a new schema in MongoDB.
 * @param {{ format?: string, schema?: unknown, name?: string }} payload
 */
export async function createSchema(payload) {
  const validation = validateSchemaDefinition(payload);
  if (!validation.valid) {
    throw createHttpError(400, validation.error);
  }

  const schemasCol = getSchemasCollection();
  const { format, schema } = validation.normalized;
  const name = validation.normalized.name || `schema_${Date.now()}`;

  const existing = await schemasCol.findOne({ name });
  if (existing) {
    throw createHttpError(409, `A schema with name "${name}" already exists.`);
  }

  const now = new Date();
  const doc = {
    name,
    format,
    schema,
    createdAt: now,
    updatedAt: now,
  };

  const result = await schemasCol.insertOne(doc);
  return {
    _id: result.insertedId,
    ...doc,
  };
}

/**
 * Retrieves all registered schemas sorted by creation date.
 */
export async function getAllSchemas() {
  const schemasCol = getSchemasCollection();
  return schemasCol.find({}).sort({ createdAt: 1 }).toArray();
}

/**
 * Retrieves a single schema by `id={id}` or `name={name}` identifier.
 * @param {string} identifier
 */
export async function getSchemaByIdentifier(identifier) {
  const filter = parseSchemaIdentifier(identifier);
  const schemasCol = getSchemasCollection();
  const schemaDoc = await schemasCol.findOne(filter);
  if (!schemaDoc) {
    throw createHttpError(404, "Schema not found.");
  }
  return schemaDoc;
}

/**
 * Retrieves a single schema by its exact `name` (returns null if not found).
 * @param {string} name
 */
export async function findSchemaByName(name) {
  const schemasCol = getSchemasCollection();
  return schemasCol.findOne({ name });
}

/**
 * Updates an existing schema identified by `id={id}` or `name={name}`.
 * @param {string} identifier
 * @param {{ format?: string, schema?: unknown, name?: string }} payload
 */
export async function updateSchemaByIdentifier(identifier, payload) {
  const filter = parseSchemaIdentifier(identifier);
  const schemasCol = getSchemasCollection();

  const existing = await schemasCol.findOne(filter);
  if (!existing) {
    throw createHttpError(404, "Schema not found.");
  }

  const mergedPayload = {
    format: payload?.format !== undefined ? payload.format : existing.format,
    schema: payload?.schema !== undefined ? payload.schema : existing.schema,
    name: payload?.name !== undefined ? payload.name : existing.name,
  };

  const validation = validateSchemaDefinition(mergedPayload);
  if (!validation.valid) {
    throw createHttpError(400, validation.error);
  }

  const newName = validation.normalized.name || existing.name;
  if (newName !== existing.name) {
    const duplicate = await schemasCol.findOne({ name: newName });
    if (duplicate) {
      throw createHttpError(
        409,
        `A schema with name "${newName}" already exists.`,
      );
    }
  }

  const updatedFields = {
    name: newName,
    format: validation.normalized.format,
    schema: validation.normalized.schema,
    updatedAt: new Date(),
  };

  await schemasCol.updateOne({ _id: existing._id }, { $set: updatedFields });

  return {
    ...existing,
    ...updatedFields,
  };
}

/**
 * Deletes a schema identified by `id={id}` or `name={name}`.
 * @param {string} identifier
 */
export async function deleteSchemaByIdentifier(identifier) {
  const filter = parseSchemaIdentifier(identifier);
  const schemasCol = getSchemasCollection();

  const deleted = await schemasCol.findOneAndDelete(filter);
  if (!deleted) {
    throw createHttpError(404, "Schema not found.");
  }

  return deleted;
}
