import { query } from "../config/db.js";
import { validateSchemaDefinition } from "../utils/schemaParser.js";

const SELECT_SCHEMA_COLUMNS = `
  id,
  name,
  format,
  schema,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
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
 * Parses `/schemas/:identifier` where identifier is `id={id}` or `name={name}`.
 * @param {string} identifier
 * @returns {{ column: 'id' | 'name', value: number | string }}
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
    if (!/^[1-9]\d*$/.test(rawId)) {
      throw createHttpError(400, `Invalid schema id "${rawId}".`);
    }
    return { column: "id", value: Number(rawId) };
  }

  if (identifier.startsWith("name=")) {
    const name = decodeURIComponent(identifier.slice(5).trim());
    if (!name) {
      throw createHttpError(400, "Schema name cannot be empty.");
    }
    return { column: "name", value: name };
  }

  throw createHttpError(
    400,
    "Invalid schema selector. Use /schemas/id={id} or /schemas/name={name}.",
  );
}

/**
 * Creates and persists a new schema in PostgreSQL.
 * @param {{ format?: string, schema?: unknown, name?: string }} payload
 */
export async function createSchema(payload) {
  const validation = validateSchemaDefinition(payload);
  if (!validation.valid) {
    throw createHttpError(400, validation.error);
  }

  const { format, schema } = validation.normalized;
  const name = validation.normalized.name || `schema_${Date.now()}`;

  const existing = await query("SELECT id FROM schemas WHERE name = $1", [
    name,
  ]);
  if (existing.rowCount > 0) {
    throw createHttpError(409, `A schema with name "${name}" already exists.`);
  }

  const result = await query(
    `INSERT INTO schemas (name, format, schema, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())
     RETURNING ${SELECT_SCHEMA_COLUMNS}`,
    [name, format, JSON.stringify(schema)],
  );

  return result.rows[0];
}

/**
 * Retrieves all registered schemas sorted by creation date.
 */
export async function getAllSchemas() {
  const result = await query(
    `SELECT ${SELECT_SCHEMA_COLUMNS} FROM schemas ORDER BY created_at ASC, id ASC`,
  );
  return result.rows;
}

/**
 * Retrieves a single schema by `id={id}` or `name={name}` identifier.
 * @param {string} identifier
 */
export async function getSchemaByIdentifier(identifier) {
  const { column, value } = parseSchemaIdentifier(identifier);
  const result = await query(
    `SELECT ${SELECT_SCHEMA_COLUMNS} FROM schemas WHERE ${column} = $1`,
    [value],
  );
  if (result.rowCount === 0) {
    throw createHttpError(404, "Schema not found.");
  }
  return result.rows[0];
}

/**
 * Retrieves a single schema by its exact `name` (returns null if not found).
 * @param {string} name
 */
export async function findSchemaByName(name) {
  const result = await query(
    `SELECT ${SELECT_SCHEMA_COLUMNS} FROM schemas WHERE name = $1`,
    [name],
  );
  return result.rows[0] || null;
}

/**
 * Updates an existing schema identified by `id={id}` or `name={name}`.
 * @param {string} identifier
 * @param {{ format?: string, schema?: unknown, name?: string }} payload
 */
export async function updateSchemaByIdentifier(identifier, payload) {
  const existing = await getSchemaByIdentifier(identifier);

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
    const duplicate = await query("SELECT id FROM schemas WHERE name = $1", [
      newName,
    ]);
    if (duplicate.rowCount > 0) {
      throw createHttpError(
        409,
        `A schema with name "${newName}" already exists.`,
      );
    }
  }

  const result = await query(
    `UPDATE schemas
     SET name = $1, format = $2, schema = $3::jsonb, updated_at = NOW()
     WHERE id = $4
     RETURNING ${SELECT_SCHEMA_COLUMNS}`,
    [
      newName,
      validation.normalized.format,
      JSON.stringify(validation.normalized.schema),
      existing.id,
    ],
  );

  return result.rows[0];
}

/**
 * Deletes a schema identified by `id={id}` or `name={name}`.
 * @param {string} identifier
 */
export async function deleteSchemaByIdentifier(identifier) {
  const { column, value } = parseSchemaIdentifier(identifier);
  const result = await query(
    `DELETE FROM schemas WHERE ${column} = $1 RETURNING ${SELECT_SCHEMA_COLUMNS}`,
    [value],
  );
  if (result.rowCount === 0) {
    throw createHttpError(404, "Schema not found.");
  }
  return result.rows[0];
}
