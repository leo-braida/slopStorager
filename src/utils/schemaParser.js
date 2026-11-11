/**
 * Splits a CSV schema string by commas that are outside square brackets `[...]`.
 * Example: "$NAME$, prompt, $COUNT[, ]$" -> ["$NAME$", "prompt", "$COUNT[, ]$"]
 * @param {string} schemaStr
 * @returns {string[]}
 */
export function splitCsvSchemaColumns(schemaStr) {
  const result = [];
  let current = '';
  let bracketDepth = 0;

  for (let i = 0; i < schemaStr.length; i++) {
    const ch = schemaStr[i];
    if (ch === '[') {
      bracketDepth++;
      current += ch;
    } else if (ch === ']') {
      if (bracketDepth > 0) bracketDepth--;
      current += ch;
    } else if (ch === ',' && bracketDepth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim().length > 0 || schemaStr.endsWith(',')) { // check this || later (maybe we can keep just the first half)
    result.push(current.trim());
  }

  return result;
}

/**
 * Parses a single template token string into a structured descriptor.
 * Supported tokens:
 *  - $NAME$
 *  - $NAME[<sep>]$
 *  - $COUNT$
 *  - $COUNT[<sep>]$
 *  - $ARRAY_AS_COUNT$ (or $ARRAY_AS_COUNTS$)
 *  - $HALLUCINATION$ or $HALLUCINATION:<N>$
 * @param {unknown} rawToken
 * @returns {{ type: string, sep?: string, amount?: number }}
 */
export function parseToken(rawToken) {
  if (typeof rawToken !== 'string') {
    return { type: 'IGNORE' };
  }
  const token = rawToken.trim();

  if (/^\$NAME\$$/i.test(token)) {
    return { type: 'NAME' };
  }

  const nameSepMatch = token.match(/^\$NAME\[([\s\S]+)\]\$$/i);
  if (nameSepMatch) {
    return { type: 'NAME_SEP', sep: nameSepMatch[1] };
  }

  if (/^\$COUNT\$$/i.test(token)) {
    return { type: 'COUNT' };
  }

  const countSepMatch = token.match(/^\$COUNT\[([\s\S]+)\]\$$/i);
  if (countSepMatch) {
    return { type: 'COUNT_SEP', sep: countSepMatch[1] };
  }

  if (/^\$ARRAY_AS_COUNTS?\$$/i.test(token)) {
    return { type: 'ARRAY_AS_COUNT' };
  }

  const hallucinationMatch = token.match(/^\$HALLUCINATION(?::(\d+))?\$$/i);
  if (hallucinationMatch) {
    const amount = hallucinationMatch[1] !== undefined ? Number(hallucinationMatch[1]) : 1;
    return { type: 'HALLUCINATION', amount };
  }

  return { type: 'IGNORE' };
}

/**
 * Recursively collects all parsed tokens inside a JSON schema object.
 * @param {unknown} node
 * @returns {Array<{ type: string, path: string }>}
 */
function collectJsonSchemaTokens(node, currentPath = '') {
  const tokens = [];
  if (typeof node === 'string') {
    const parsed = parseToken(node);
    if (parsed.type !== 'IGNORE') {
      tokens.push({ ...parsed, path: currentPath });
    }
    return tokens;
  }

  if (Array.isArray(node)) {
    if (node.length > 0) {
      tokens.push(...collectJsonSchemaTokens(node[0], `${currentPath}[]`));
    }
    return tokens;
  }

  if (node && typeof node === 'object') {
    for (const [key, val] of Object.entries(node)) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      tokens.push(...collectJsonSchemaTokens(val, nextPath));
    }
  }

  return tokens;
}

/**
 * Validates a schema payload before saving/updating in MongoDB.
 * @param {{ format?: string, schema?: unknown, name?: string }} payload
 * @returns {{ valid: boolean, error?: string, normalized?: { format: 'CSV' | 'JSON', schema: unknown, name?: string } }}
 */
export function validateSchemaDefinition(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object.' };
  }

  const rawFormat = typeof payload.format === 'string' ? payload.format.trim().toUpperCase() : '';
  if (rawFormat !== 'CSV' && rawFormat !== 'JSON') {
    return { valid: false, error: 'Field "format" is required and must be either "JSON" or "CSV".' };
  }

  let schema = payload.schema;
  if (schema === undefined || schema === null) {
    return { valid: false, error: 'Field "schema" is required.' };
  }

  if (rawFormat === 'CSV') {
    if (typeof schema !== 'string' || !schema.trim()) {
      return { valid: false, error: 'For CSV format, "schema" must be a non-empty string of comma-separated column definitions.' };
    }
    const cols = splitCsvSchemaColumns(schema).map(parseToken);
    const hasName = cols.some((c) => c.type === 'NAME' || c.type === 'NAME_SEP');
    const hasCount = cols.some((c) => c.type === 'COUNT' || c.type === 'COUNT_SEP' || c.type === 'HALLUCINATION');

    if (!hasName) {
      return { valid: false, error: 'CSV schema must include at least one $NAME$ or $NAME[...]$ column.' };
    }
    if (!hasCount) {
      return { valid: false, error: 'CSV schema must include a count definition ($COUNT$, $COUNT[...]$, or $HALLUCINATION:N$).' };
    }
  } else {
    if (typeof schema === 'string') {
      try {
        schema = JSON.parse(schema);
      } catch {
        return { valid: false, error: 'For JSON format, "schema" must be a valid JSON object.' };
      }
    }
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return { valid: false, error: 'For JSON format, "schema" must be a JSON object.' };
    }

    const tokens = collectJsonSchemaTokens(schema);
    const hasName = tokens.some((t) => t.type === 'NAME' || t.type === 'NAME_SEP');
    const hasCount = tokens.some(
      (t) => t.type === 'COUNT' || t.type === 'COUNT_SEP' || t.type === 'ARRAY_AS_COUNT' || t.type === 'HALLUCINATION'
    );

    if (!hasName) {
      return { valid: false, error: 'JSON schema must include at least one $NAME$ or $NAME[...]$ field.' };
    }
    if (!hasCount) {
      return {
        valid: false,
        error: 'JSON schema must include a count definition ($COUNT$, $COUNT[...]$, $ARRAY_AS_COUNT$, or $HALLUCINATION:N$).'
      };
    }
  }

  const normalizedName =
    typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : undefined;

  return {
    valid: true,
    normalized: {
      format: rawFormat,
      schema,
      ...(normalizedName ? { name: normalizedName } : {})
    }
  };
}

/**
 * Cleans a raw package name by trimming whitespace and stripping surrounding quotes.
 * @param {string} raw
 * @returns {string}
 */
function cleanPackageName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
}

/**
 * Splits a string value by a separator descriptor (e.g. ", " or ",").
 * Trims each item and filters out empty strings.
 * @param {string} value
 * @param {string} sep
 * @returns {string[]}
 */
function splitBySeparator(value, sep) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const effectiveSep = sep.trim() || sep;
  return value
    .split(effectiveSep)
    .map((item) => cleanPackageName(item))
    .filter(Boolean);
}

/**
 * Parses RFC-4180 CSV text into an array of string arrays (rows).
 * @param {string} content
 * @returns {string[][]}
 */
export function parseCsvRows(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
      } else if (ch === '\r' && next === '\n') {
        row.push(field.trim());
        if (row.some((cell) => cell !== '')) rows.push(row);
        row = [];
        field = '';
        i++;
      } else if (ch === '\n' || ch === '\r') {
        row.push(field.trim());
        if (row.some((cell) => cell !== '')) rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell !== '')) {
    rows.push(row);
  }

  return rows;
}

const COMMON_CSV_HEADERS = new Set([
  'model',
  'models',
  'prompt',
  'question',
  'package',
  'packages',
  'existent packages',
  'existent_packages',
  'hallucinated packages',
  'hallucinated_packages',
  'hallucation_count',
  'hallucination_count',
  'count',
  'amount'
]);

/**
 * Determines whether the first CSV row is a header row.
 * @param {string[]} firstRow
 * @param {Array<{ raw: string, parsed: { type: string } }>} colDefs
 * @returns {boolean}
 */
function isCsvHeaderRow(firstRow, colDefs) {
  for (let i = 0; i < colDefs.length; i++) {
    const def = colDefs[i];
    const cell = (firstRow[i] || '').trim();
    const cellLower = cell.toLowerCase();

    if (def.parsed.type === 'COUNT') {
      const num = Number(cell);
      if (!Number.isFinite(num) || cell === '') {
        return true;
      }
    }

    if (def.parsed.type === 'IGNORE' && def.raw && cellLower === def.raw.toLowerCase()) {
      return true;
    }
  }

  return firstRow.every((cell) => COMMON_CSV_HEADERS.has(cell.trim().toLowerCase()));
}

/**
 * Validates and parses CSV content against a CSV schema definition.
 * @param {string} content
 * @param {string} schemaStr
 * @returns {{ valid: boolean, error?: string, counts?: Array<[string, number]>, recordsProcessed?: number }}
 */
function validateAndParseCsv(content, schemaStr) {
  const trimmed = content.trim();
  if (!trimmed) {
    return { valid: false, error: 'Uploaded content is empty.' };
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return { valid: false, error: 'Uploaded content appears to be JSON, but the selected schema format is CSV.' };
  }

  const rawCols = splitCsvSchemaColumns(schemaStr);
  const colDefs = rawCols.map((raw) => ({ raw, parsed: parseToken(raw) }));

  const rows = parseCsvRows(trimmed);
  if (rows.length === 0) {
    return { valid: false, error: 'No CSV rows found in uploaded content.' };
  }

  let startIdx = 0;
  if (rows.length > 1 && isCsvHeaderRow(rows[0], colDefs)) {
    startIdx = 1;
  }

  const dataRows = rows.slice(startIdx);
  if (dataRows.length === 0) {
    return { valid: false, error: 'CSV contains no data rows.' };
  }

  const countsMap = {};
  let recordsProcessed = 0;

  for (let rIdx = 0; rIdx < dataRows.length; rIdx++) {
    const row = dataRows[rIdx];
    const lineNum = startIdx + rIdx + 1;

    if (row.length !== colDefs.length) {
      return {
        valid: false,
        error: `CSV row ${lineNum} has ${row.length} column(s), but schema expects ${colDefs.length} column(s).`
      };
    }

    const rowNames = [];
    let rowCount = null;

    for (let cIdx = 0; cIdx < colDefs.length; cIdx++) {
      const { parsed } = colDefs[cIdx];
      const cell = row[cIdx] ?? '';

      if (parsed.type === 'NAME') {
        const cleaned = cleanPackageName(cell);
        if (!cleaned) {
          return {
            valid: false,
            error: `CSV row ${lineNum}, column ${cIdx + 1} ($NAME$) is empty.`
          };
        }
        rowNames.push(cleaned);
      } else if (parsed.type === 'NAME_SEP') {
        const names = splitBySeparator(cell, parsed.sep);
        rowNames.push(...names);
      } else if (parsed.type === 'COUNT') {
        const num = Number(cell);
        if (cell === '' || !Number.isFinite(num) || num < 0) {
          return {
            valid: false,
            error: `CSV row ${lineNum}, column ${cIdx + 1} ($COUNT$) must be a non-negative number, got "${cell}".`
          };
        }
        rowCount = num;
      } else if (parsed.type === 'COUNT_SEP') {
        const items = splitBySeparator(cell, parsed.sep);
        if (items.length === 0) {
          return {
            valid: false,
            error: `CSV row ${lineNum}, column ${cIdx + 1} ($COUNT[${parsed.sep}]$) has no countable values.`
          };
        }
        rowCount = items.length;
      } else if (parsed.type === 'HALLUCINATION') {
        rowCount = parsed.amount;
      }
    }

    if (rowCount === null) {
      rowCount = 1;
    }

    recordsProcessed++;
    for (const pkgName of rowNames) {
      countsMap[pkgName] = (countsMap[pkgName] || 0) + rowCount;
    }
  }

  const sortedCounts = Object.entries(countsMap).sort((a, b) => b[1] - a[1]);
  return {
    valid: true,
    counts: sortedCounts,
    recordsProcessed
  };
}

/**
 * Checks whether a JSON schema sub-tree contains any relevant ($NAME...$ or count) tokens.
 * @param {unknown} schemaNode
 * @returns {boolean}
 */
function hasRelevantTokens(schemaNode) {
  return collectJsonSchemaTokens(schemaNode).length > 0;
}

/**
 * Evaluates a single JSON data object against a JSON schema object node.
 * Accumulates extracted { names, count } pairs into `extractedPairs`.
 * Returns `{ valid: boolean, error?: string }`.
 *
 * @param {unknown} dataNode
 * @param {Record<string, unknown>} schemaNode
 * @param {Array<{ names: string[], count: number }>} extractedPairs
 * @param {number | null} inheritedCount
 * @param {string} pathPrefix
 * @returns {{ valid: boolean, error?: string, localNames: string[], localCount: number | null }}
 */
function evaluateJsonNode(dataNode, schemaNode, extractedPairs, inheritedCount = null, pathPrefix = 'root') {
  if (!dataNode || typeof dataNode !== 'object' || Array.isArray(dataNode)) {
    return {
      valid: false,
      error: `Expected a JSON object at "${pathPrefix}", got ${Array.isArray(dataNode) ? 'array' : typeof dataNode}.`,
      localNames: [],
      localCount: null
    };
  }

  const localNames = [];
  let localCount = null;
  const deferredArraySubtrees = [];

  for (const [key, schemaVal] of Object.entries(schemaNode)) {
    const fieldPath = pathPrefix === 'root' ? key : `${pathPrefix}.${key}`;

    if (typeof schemaVal === 'string') {
      const token = parseToken(schemaVal);
      if (token.type === 'IGNORE') {
        continue;
      }

      if (token.type === 'HALLUCINATION') {
        localCount = token.amount;
        continue;
      }

      if (!(key in dataNode)) {
        return {
          valid: false,
          error: `Missing required field "${fieldPath}" for token ${schemaVal}.`,
          localNames: [],
          localCount: null
        };
      }

      const dataVal = dataNode[key];

      if (token.type === 'NAME') {
        if (typeof dataVal === 'string') {
          const clean = cleanPackageName(dataVal);
          if (!clean) {
            return {
              valid: false,
              error: `Field "${fieldPath}" ($NAME$) must be a non-empty string.`,
              localNames: [],
              localCount: null
            };
          }
          localNames.push(clean);
        } else if (Array.isArray(dataVal)) {
          for (const item of dataVal) {
            if (typeof item !== 'string') {
              return {
                valid: false,
                error: `Field "${fieldPath}" ($NAME$) array must contain strings.`,
                localNames: [],
                localCount: null
              };
            }
            const clean = cleanPackageName(item);
            if (clean) localNames.push(clean);
          }
        } else {
          return {
            valid: false,
            error: `Field "${fieldPath}" ($NAME$) must be a string or array of strings, got ${typeof dataVal}.`,
            localNames: [],
            localCount: null
          };
        }
      } else if (token.type === 'NAME_SEP') {
        if (typeof dataVal !== 'string') {
          return {
            valid: false,
            error: `Field "${fieldPath}" ($NAME[${token.sep}]$) must be a string, got ${typeof dataVal}.`,
            localNames: [],
            localCount: null
          };
        }
        localNames.push(...splitBySeparator(dataVal, token.sep));
      } else if (token.type === 'COUNT') {
        const num = typeof dataVal === 'number' ? dataVal : Number(dataVal);
        if (typeof dataVal === 'boolean' || dataVal === null || dataVal === '' || !Number.isFinite(num) || num < 0) {
          return {
            valid: false,
            error: `Field "${fieldPath}" ($COUNT$) must be a non-negative number, got ${JSON.stringify(dataVal)}.`,
            localNames: [],
            localCount: null
          };
        }
        localCount = num;
      } else if (token.type === 'COUNT_SEP') {
        if (typeof dataVal !== 'string') {
          return {
            valid: false,
            error: `Field "${fieldPath}" ($COUNT[${token.sep}]$) must be a string, got ${typeof dataVal}.`,
            localNames: [],
            localCount: null
          };
        }
        localCount = splitBySeparator(dataVal, token.sep).length;
      } else if (token.type === 'ARRAY_AS_COUNT') {
        if (!Array.isArray(dataVal)) {
          return {
            valid: false,
            error: `Field "${fieldPath}" ($ARRAY_AS_COUNT$) must be an array, got ${typeof dataVal}.`,
            localNames: [],
            localCount: null
          };
        }
        localCount = dataVal.length;
      }
    } else if (schemaVal && typeof schemaVal === 'object') {
      const subSchemaObj = Array.isArray(schemaVal) ? schemaVal[0] : schemaVal;
      if (!subSchemaObj || typeof subSchemaObj !== 'object' || !hasRelevantTokens(subSchemaObj)) {
        continue;
      }

      if (!(key in dataNode)) {
        return {
          valid: false,
          error: `Missing required nested field "${fieldPath}".`,
          localNames: [],
          localCount: null
        };
      }

      const dataVal = dataNode[key];
      if (Array.isArray(dataVal)) {
        deferredArraySubtrees.push({ dataArray: dataVal, subSchemaObj, fieldPath });
      } else if (dataVal && typeof dataVal === 'object') {
        const subResult = evaluateJsonNode(dataVal, subSchemaObj, extractedPairs, inheritedCount, fieldPath);
        if (!subResult.valid) {
          return subResult;
        }
        localNames.push(...subResult.localNames);
        if (subResult.localCount !== null) {
          localCount = subResult.localCount;
        }
      } else {
        return {
          valid: false,
          error: `Field "${fieldPath}" must be an object or array of objects, got ${typeof dataVal}.`,
          localNames: [],
          localCount: null
        };
      }
    }
  }

  const effectiveCount = localCount !== null ? localCount : inheritedCount;

  for (const { dataArray, subSchemaObj, fieldPath } of deferredArraySubtrees) {
    for (let i = 0; i < dataArray.length; i++) {
      const elemResult = evaluateJsonNode(
        dataArray[i],
        subSchemaObj,
        extractedPairs,
        effectiveCount,
        `${fieldPath}[${i}]`
      );
      if (!elemResult.valid) {
        return elemResult;
      }
      if (elemResult.localNames.length > 0) {
        const countToUse = elemResult.localCount !== null ? elemResult.localCount : (effectiveCount ?? 1);
        extractedPairs.push({ names: elemResult.localNames, count: countToUse });
      }
    }
  }

  return {
    valid: true,
    localNames,
    localCount
  };
}

/**
 * Parses raw text into an array of JSON objects (supports JSON array, single JSON object, or JSONL).
 * @param {string} content
 * @returns {{ valid: boolean, records?: Array<Record<string, unknown>>, error?: string }}
 */
function parseJsonRecords(content) {
  const trimmed = content.trim();
  if (!trimmed) {
    return { valid: false, error: 'Uploaded content is empty.' };
  }

  // Try standard JSON first
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return { valid: false, error: 'Uploaded JSON array is empty.' };
      }
      return { valid: true, records: parsed };
    }
    if (parsed && typeof parsed === 'object') {
      return { valid: true, records: [parsed] };
    }
    return { valid: false, error: 'Uploaded JSON must be an object or array of objects.' };
  } catch {
    // Fallback to JSONL (newline-delimited JSON)
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const records = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]);
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
          return { valid: false, error: `Line ${i + 1} is not a valid JSON object.` };
        }
        records.push(obj);
      } catch {
        return {
          valid: false,
          error: 'Uploaded content is not valid JSON or JSONL.'
        };
      }
    }
    if (records.length === 0) {
      return { valid: false, error: 'Uploaded content contains no JSON records.' };
    }
    return { valid: true, records };
  }
}

/**
 * Validates and parses JSON/JSONL content against a JSON schema definition.
 * @param {string} content
 * @param {Record<string, unknown>} schemaObj
 * @returns {{ valid: boolean, error?: string, counts?: Array<[string, number]>, recordsProcessed?: number }}
 */
function validateAndParseJson(content, schemaObj) {
  const parsedRecords = parseJsonRecords(content);
  if (!parsedRecords.valid) {
    return { valid: false, error: parsedRecords.error };
  }

  const { records } = parsedRecords;
  const countsMap = {};
  let recordsProcessed = 0;

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const extractedPairs = [];
    const evalResult = evaluateJsonNode(record, schemaObj, extractedPairs, null, `record[${i}]`);

    if (!evalResult.valid) {
      return { valid: false, error: evalResult.error };
    }

    if (evalResult.localNames.length > 0) {
      const countToUse = evalResult.localCount !== null ? evalResult.localCount : 1;
      extractedPairs.push({ names: evalResult.localNames, count: countToUse });
    }

    recordsProcessed++;
    for (const { names, count } of extractedPairs) {
      for (const pkgName of names) {
        countsMap[pkgName] = (countsMap[pkgName] || 0) + count;
      }
    }
  }

  const sortedCounts = Object.entries(countsMap).sort((a, b) => b[1] - a[1]);
  return {
    valid: true,
    counts: sortedCounts,
    recordsProcessed
  };
}

/**
 * Validates that `content` follows `schemaDoc` (checking the parameters that matter: name & count)
 * and extracts aggregated package hallucination counts.
 * @param {string} content
 * @param {{ format: string, schema: unknown, name?: string }} schemaDoc
 * @returns {{ valid: boolean, error?: string, counts?: Array<[string, number]>, recordsProcessed?: number }}
 */
export function validateAndParseWithSchema(content, schemaDoc) {
  const format = String(schemaDoc.format || '').toUpperCase();
  if (format === 'CSV') {
    return validateAndParseCsv(content, String(schemaDoc.schema));
  }
  if (format === 'JSON') {
    const schemaObj =
      typeof schemaDoc.schema === 'string' ? JSON.parse(schemaDoc.schema) : schemaDoc.schema;
    return validateAndParseJson(content, schemaObj);
  }
  return { valid: false, error: `Unsupported schema format "${schemaDoc.format}".` };
}
