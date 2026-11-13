import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseIdOrNameQuery,
  parseAndValidateDate,
  parseMinCount,
} from "../src/utils/querySelector.js";

describe("querySelector — parseIdOrNameQuery", () => {
  it("parses valid ?id= and ?name= selectors (including scoped npm names)", () => {
    assert.deepEqual(parseIdOrNameQuery({ id: "42" }, "Package"), {
      column: "id",
      value: 42,
    });
    assert.deepEqual(
      parseIdOrNameQuery({ name: " @scope/pkg-name " }, "Package"),
      {
        column: "name",
        value: "@scope/pkg-name",
      },
    );
  });

  it("returns null when selector is optional and omitted", () => {
    assert.equal(
      parseIdOrNameQuery({}, "Package", { required: false }),
      null,
    );
  });

  it("throws 400 for missing required selector, both id & name, or invalid values", () => {
    const invalidInputs = [
      {},
      { id: "1", name: "pkg" },
      { id: "0" },
      { id: "-5" },
      { id: "abc" },
      { id: "9999999999" },
      { id: "" },
      { name: "   " },
    ];

    for (const query of invalidInputs) {
      assert.throws(
        () => parseIdOrNameQuery(query, "Package"),
        (err) => err.statusCode === 400,
        `Expected 400 for query ${JSON.stringify(query)}`,
      );
    }
  });
});

describe("packages.services — parseAndValidateDate & parseMinCount", () => {
  const fixedNow = new Date("2026-06-15T12:00:00.000Z");

  it("parses valid YYYY-MM-DD and full ISO dates", () => {
    const startDate = parseAndValidateDate("2025-03-10", "firstDate", {
      now: fixedNow,
    });
    assert.equal(startDate.toISOString(), "2025-03-10T00:00:00.000Z");

    const endOfDay = parseAndValidateDate("2025-03-10", "lastDate", {
      endOfDayIfDateOnly: true,
      now: fixedNow,
    });
    assert.equal(endOfDay.toISOString(), "2025-03-10T23:59:59.999Z");
  });

  it("rejects future dates and invalid calendar dates with 400", () => {
    const badDates = ["2026-06-16", "2099-01-01T00:00:00.000Z", "2024-02-30", "not-a-date", ""];
    for (const d of badDates) {
      assert.throws(
        () => parseAndValidateDate(d, "lastDate", { now: fixedNow }),
        (err) => err.statusCode === 400,
        `Expected 400 for date "${d}"`,
      );
    }
  });

  it("parses minCount and defaults to 1", () => {
    assert.equal(parseMinCount(undefined), 1);
    assert.equal(parseMinCount(""), 1);
    assert.equal(parseMinCount("15"), 15);
    assert.equal(parseMinCount(0), 0);

    for (const bad of ["-1", "abc", -5]) {
      assert.throws(
        () => parseMinCount(bad),
        (err) => err.statusCode === 400,
      );
    }
  });
});
