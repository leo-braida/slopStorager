const PG_INT4_MAX = 2147483647;

/**
 * Creates an Error instance with an attached HTTP statusCode.
 * @param {number} statusCode
 * @param {string} message
 * @returns {Error & { statusCode: number }}
 */
export function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Parses `?id={id}` or `?name={name}` query parameters into a parameterized column selector.
 * Throws a 400 HTTP error if both are provided or if a provided value is invalid.
 * @param {Record<string, unknown>} reqQuery
 * @param {string} resourceName
 * @param {{ required?: boolean }} [options]
 * @returns {{ column: 'id' | 'name', value: number | string } | null}
 */
export function parseIdOrNameQuery(
  reqQuery = {},
  resourceName = "Resource",
  { required = true } = {},
) {
  const hasId = reqQuery?.id !== undefined;
  const hasName = reqQuery?.name !== undefined;

  if (hasId && hasName) {
    throw createHttpError(
      400,
      'Provide either query parameter "id" or "name", not both.',
    );
  }

  if (!hasId && !hasName) {
    if (!required) {
      return null;
    }
    throw createHttpError(
      400,
      `${resourceName} selector is required (use ?id={id} or ?name={name}).`,
    );
  }

  const lowerName = resourceName.toLowerCase();

  if (hasId) {
    if (typeof reqQuery.id !== "string") {
      throw createHttpError(400, `Invalid ${lowerName} id.`);
    }
    const rawId = reqQuery.id.trim();
    const numericId = Number(rawId);
    if (!/^[1-9]\d*$/.test(rawId) || numericId > PG_INT4_MAX) {
      throw createHttpError(400, `Invalid ${lowerName} id "${rawId}".`);
    }
    return { column: "id", value: numericId };
  }

  if (typeof reqQuery.name !== "string") {
    throw createHttpError(
      400,
      `${resourceName} name must be a non-empty string.`,
    );
  }
  const name = reqQuery.name.trim();
  if (!name) {
    throw createHttpError(400, `${resourceName} name cannot be empty.`);
  }
  return { column: "name", value: name };
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
