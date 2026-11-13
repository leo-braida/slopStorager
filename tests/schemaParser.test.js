import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  splitCsvSchemaColumns,
  parseToken,
  validateSchemaDefinition,
  validateAndParseWithSchema,
} from "../src/utils/schemaParser.js";

describe("schemaParser — splitCsvSchemaColumns & parseToken", () => {
  it("splits CSV schema columns while preserving commas inside brackets", () => {
    const cols = splitCsvSchemaColumns("$HALLUCINATION$, prompt, $NAME[, ]$");
    assert.deepEqual(cols, ["$HALLUCINATION$", "prompt", "$NAME[, ]$"]);
  });

  it("parses supported template tokens accurately", () => {
    const cases = [
      ["$NAME$", { type: "NAME" }],
      ["$NAME[,]$", { type: "NAME_SEP", sep: "," }],
      ["$COUNT$", { type: "COUNT" }],
      ["$COUNT[;]$", { type: "COUNT_SEP", sep: ";" }],
      ["$ARRAY_AS_COUNT$", { type: "ARRAY_AS_COUNT" }],
      ["$HALLUCINATION$", { type: "HALLUCINATION", amount: 1 }],
      ["$HALLUCINATION:5$", { type: "HALLUCINATION", amount: 5 }],
      ["$IGNORE$", { type: "IGNORE" }],
      ["prompt", { type: "IGNORE" }],
    ];

    for (const [input, expected] of cases) {
      assert.deepEqual(parseToken(input), expected, `Failed for token ${input}`);
    }
  });
});

describe("schemaParser — validateSchemaDefinition", () => {
  it("accepts valid CSV and JSON schema definitions", () => {
    const csvRes = validateSchemaDefinition({
      name: "csv_test",
      format: "csv",
      schema: "$HALLUCINATION$,prompt,$NAME[,]$",
    });
    assert.equal(csvRes.valid, true);
    assert.equal(csvRes.normalized.format, "CSV");

    const jsonRes = validateSchemaDefinition({
      name: "json_test",
      format: "json",
      schema: {
        package: "$NAME$",
        question: { models: "$ARRAY_AS_COUNT$" },
      },
    });
    assert.equal(jsonRes.valid, true);
    assert.equal(jsonRes.normalized.format, "JSON");
  });

  it("rejects schemas missing $NAME$ or count definitions", () => {
    const missingName = validateSchemaDefinition({
      format: "CSV",
      schema: "prompt,$COUNT$",
    });
    assert.equal(missingName.valid, false);

    const missingCount = validateSchemaDefinition({
      format: "CSV",
      schema: "model,prompt,$NAME[,]$",
    });
    assert.equal(missingCount.valid, false);

    const badFormat = validateSchemaDefinition({
      format: "XML",
      schema: "$NAME$,$COUNT$",
    });
    assert.equal(badFormat.valid, false);
  });
});

describe("schemaParser — validateAndParseWithSchema", () => {
  it("parses CSV dataset with header row and $HALLUCINATION$ + $NAME[,]$", () => {
    const schemaDoc = {
      format: "CSV",
      schema: "$HALLUCINATION$,prompt,$NAME[,]$",
    };
    const csvContent = [
      "model,prompt,packages",
      'gpt-4,"Build an app","alpha-pkg, beta-pkg"',
      'claude,"Build a cli","beta-pkg, gamma-pkg"',
    ].join("\n");

    const res = validateAndParseWithSchema(csvContent, schemaDoc);
    assert.equal(res.valid, true);
    assert.equal(res.recordsProcessed, 2);
    const countsObj = Object.fromEntries(res.counts);
    assert.deepEqual(countsObj, {
      "beta-pkg": 2,
      "alpha-pkg": 1,
      "gamma-pkg": 1,
    });
  });

  it("parses CSV dataset with $COUNT[;]$ separator", () => {
    const schemaDoc = {
      format: "CSV",
      schema: "$NAME$,prompt,$COUNT[;]$",
    };
    const csvContent = [
      "package,prompt,models",
      "pkg-one,test prompt,gpt-4;claude;gemini",
      "pkg-two,other prompt,gpt-4",
    ].join("\n");

    const res = validateAndParseWithSchema(csvContent, schemaDoc);
    assert.equal(res.valid, true);
    assert.deepEqual(Object.fromEntries(res.counts), {
      "pkg-one": 3,
      "pkg-two": 1,
    });
  });

  it("parses JSON nested array dataset and JSONL dataset", () => {
    const nestedSchema = {
      format: "JSON",
      schema: {
        model: "$IGNORE$",
        packages: [{ name: "$NAME$", amount: "$COUNT$" }],
      },
    };
    const jsonContent = JSON.stringify([
      {
        model: "gpt-4",
        packages: [
          { name: "pkg-a", amount: 4 },
          { name: "pkg-b", amount: 2 },
        ],
      },
      {
        model: "claude",
        packages: [{ name: "pkg-a", amount: 3 }],
      },
    ]);

    const jsonRes = validateAndParseWithSchema(jsonContent, nestedSchema);
    assert.equal(jsonRes.valid, true);
    assert.deepEqual(Object.fromEntries(jsonRes.counts), {
      "pkg-a": 7,
      "pkg-b": 2,
    });

    const jsonlSchema = {
      format: "JSON",
      schema: {
        model: "$HALLUCINATION$",
        modulenotfound: "$NAME$",
      },
    };
    const jsonlContent = [
      JSON.stringify({ model: "gpt-4", modulenotfound: ["pkg-x", "pkg-y"] }),
      JSON.stringify({ model: "gpt-4", modulenotfound: [] }),
      JSON.stringify({ model: "claude", modulenotfound: ["pkg-x"] }),
    ].join("\n");

    const jsonlRes = validateAndParseWithSchema(jsonlContent, jsonlSchema);
    assert.equal(jsonlRes.valid, true);
    assert.deepEqual(Object.fromEntries(jsonlRes.counts), {
      "pkg-x": 2,
      "pkg-y": 1,
    });
  });

  it("rejects non-conforming datasets", () => {
    const csvSchema = { format: "CSV", schema: "$NAME$,$COUNT$" };
    const mismatchCols = validateAndParseWithSchema(
      "a,b,c\n1,2,3",
      csvSchema,
    );
    assert.equal(mismatchCols.valid, false);
  });
});
