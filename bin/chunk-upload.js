#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

/**
 * Print CLI usage / help text.
 */
function printHelp() {
  console.log(`
Usage:
  node bin/chunk-upload.js <file> [options]
  ./bin/chunk-upload.js <file> [options]

Arguments:
  <file>                    Path to dataset file (.csv, .jsonl, .json)

Options:
  -s, --schema <name>       Schema name registered in the database (optional)
  -u, --url <url>           Base API URL (default: http://localhost:3000)
  -c, --chunk-size <mb>     Max chunk size in MB (default: 5)
      --keep-chunks         Do not delete temporary chunk files after upload
  -h, --help                Show this help message
`);
}

/**
 * Parse CLI arguments.
 */
function parseArgs(args) {
  const options = {
    file: null,
    schema: null,
    url: process.env.API_URL || "http://localhost:3000",
    chunkSizeMb: 5,
    keepChunks: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "-s" || arg === "--schema") {
      options.schema = args[++i];
    } else if (arg === "-u" || arg === "--url") {
      options.url = args[++i];
    } else if (arg === "-c" || arg === "--chunk-size") {
      const val = Number(args[++i]);
      if (!Number.isFinite(val) || val <= 0) {
        console.error("Error: --chunk-size must be a positive number.");
        process.exit(1);
      }
      options.chunkSizeMb = val;
    } else if (arg === "--keep-chunks") {
      options.keepChunks = true;
    } else if (!arg.startsWith("-") && !options.file) {
      options.file = arg;
    } else if (arg === "-f" || arg === "--file") {
      options.file = args[++i];
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return options;
}

/**
 * Detect format of input file.
 * Returns 'csv' | 'jsonl' | 'json_array'.
 */
function detectFormat(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv") return "csv";
  if (ext === ".jsonl") return "jsonl";

  // Inspect first non-whitespace character
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(1024);
  const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0);
  fs.closeSync(fd);

  const preview = buffer.toString("utf8", 0, bytesRead).trim();
  if (preview.startsWith("[")) {
    return "json_array";
  }
  return "jsonl";
}

/**
 * Split JSONL file into chunk files under maxBytes.
 */
async function splitJsonl(inputPath, outputDir, maxBytes) {
  const chunkPaths = [];
  let chunkIndex = 1;
  let currentBytes = 0;
  let currentStream = null;

  function openNextChunk() {
    if (currentStream) {
      currentStream.end();
    }
    const chunkPath = path.join(
      outputDir,
      `chunk_${String(chunkIndex++).padStart(4, "0")}.jsonl`,
    );
    chunkPaths.push(chunkPath);
    currentStream = fs.createWriteStream(chunkPath, { encoding: "utf8" });
    currentBytes = 0;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  openNextChunk();

  for await (const line of rl) {
    if (!line.trim()) continue;
    const lineBytes = Buffer.byteLength(line, "utf8") + 1; // +1 for newline
    if (currentBytes > 0 && currentBytes + lineBytes > maxBytes) {
      openNextChunk();
    }
    currentStream.write(line + "\n");
    currentBytes += lineBytes;
  }

  if (currentStream) {
    currentStream.end();
    await new Promise((resolve) => currentStream.on("finish", resolve));
  }

  return chunkPaths;
}

/**
 * Split CSV file into chunk files under maxBytes, repeating the header in each chunk.
 */
async function splitCsv(inputPath, outputDir, maxBytes) {
  const chunkPaths = [];
  let chunkIndex = 1;
  let header = "";
  let headerBytes = 0;
  let currentBytes = 0;
  let currentStream = null;

  function openNextChunk() {
    if (currentStream) {
      currentStream.end();
    }
    const chunkPath = path.join(
      outputDir,
      `chunk_${String(chunkIndex++).padStart(4, "0")}.csv`,
    );
    chunkPaths.push(chunkPath);
    currentStream = fs.createWriteStream(chunkPath, { encoding: "utf8" });
    currentStream.write(header + "\n");
    currentBytes = headerBytes;
  }

  const rl = readline.createInterface({
    input: fs.createReadStream(inputPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let isFirstLine = true;

  for await (const line of rl) {
    if (isFirstLine) {
      header = line;
      headerBytes = Buffer.byteLength(header, "utf8") + 1;
      isFirstLine = false;
      openNextChunk();
      continue;
    }

    if (!line.trim()) continue;
    const lineBytes = Buffer.byteLength(line, "utf8") + 1;

    if (currentBytes > headerBytes && currentBytes + lineBytes > maxBytes) {
      openNextChunk();
    }
    currentStream.write(line + "\n");
    currentBytes += lineBytes;
  }

  if (currentStream) {
    currentStream.end();
    await new Promise((resolve) => currentStream.on("finish", resolve));
  }

  return chunkPaths;
}

/**
 * Split JSON Array file into valid JSON sub-arrays `[...]` under maxBytes.
 */
async function splitJsonArray(inputPath, outputDir, maxBytes) {
  const content = fs.readFileSync(inputPath, "utf8");
  const parsed = JSON.parse(content);

  if (!Array.isArray(parsed)) {
    throw new Error("Expected a top-level JSON array in " + inputPath);
  }

  const chunkPaths = [];
  let chunkIndex = 1;
  let currentItems = [];
  let currentBytes = 2; // For '[' and ']'

  function flushChunk() {
    if (currentItems.length === 0) return;
    const chunkPath = path.join(
      outputDir,
      `chunk_${String(chunkIndex++).padStart(4, "0")}.json`,
    );
    chunkPaths.push(chunkPath);
    fs.writeFileSync(chunkPath, JSON.stringify(currentItems, null, 2), "utf8");
    currentItems = [];
    currentBytes = 2;
  }

  for (const item of parsed) {
    const itemStr = JSON.stringify(item);
    const itemBytes = Buffer.byteLength(itemStr, "utf8") + 2; // comma and newline

    if (currentItems.length > 0 && currentBytes + itemBytes > maxBytes) {
      flushChunk();
    }
    currentItems.push(item);
    currentBytes += itemBytes;
  }

  flushChunk();
  return chunkPaths;
}

/**
 * Split a dataset file into chunks.
 * Returns { chunks: string[], tempDir: string | null }
 */
async function splitFile(inputPath, maxBytes) {
  const stat = fs.statSync(inputPath);
  if (stat.size <= maxBytes) {
    // No splitting required
    return { chunks: [inputPath], tempDir: null };
  }

  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "slopstorager-chunks-"),
  );
  const format = detectFormat(inputPath);
  let chunks = [];

  if (format === "csv") {
    chunks = await splitCsv(inputPath, tempDir, maxBytes);
  } else if (format === "json_array") {
    chunks = await splitJsonArray(inputPath, tempDir, maxBytes);
  } else {
    chunks = await splitJsonl(inputPath, tempDir, maxBytes);
  }

  return { chunks, tempDir };
}

/**
 * Upload a single chunk file to POST /packages/upload.
 */
async function uploadChunk(chunkPath, baseUrl, schemaName) {
  const url = new URL("/packages/upload", baseUrl);
  if (schemaName) {
    url.searchParams.set("schemaName", schemaName);
  }

  const fileBytes = fs.readFileSync(chunkPath);
  const blob = new Blob([fileBytes]);
  const formData = new FormData();
  formData.append("file", blob, path.basename(chunkPath));

  const response = await fetch(url.toString(), {
    method: "POST",
    body: formData,
  });

  const bodyText = await response.text();
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch {
    // Keep json null
  }

  if (!response.ok) {
    const errMsg = json?.error || bodyText || response.statusText;
    throw new Error(`Upload failed (${response.status}): ${errMsg}`);
  }

  return json;
}

/**
 * Main execution.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.file) {
    console.error("Error: Missing required <file> argument.");
    printHelp();
    process.exit(1);
  }

  const resolvedFilePath = path.resolve(process.cwd(), options.file);
  if (!fs.existsSync(resolvedFilePath)) {
    console.error(`Error: File not found: ${resolvedFilePath}`);
    process.exit(1);
  }

  const fileSize = fs.statSync(resolvedFilePath).size;
  const maxBytes = Math.floor(options.chunkSizeMb * 1024 * 1024);

  console.log("=== SlopStorager Chunked Upload CLI ===");
  console.log(`File:       ${resolvedFilePath} (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`Target API: ${options.url}`);
  console.log(`Schema:     ${options.schema || "(auto-detect)"}`);
  console.log(`Chunk Size: ${options.chunkSizeMb} MB`);

  let splitResult = null;
  try {
    console.log("\nPreparing file chunks...");
    splitResult = await splitFile(resolvedFilePath, maxBytes);
    const { chunks, tempDir } = splitResult;

    console.log(`Total chunks: ${chunks.length}`);

    let totalRecords = 0;
    let totalUpdated = 0;
    let totalAdded = 0;
    let schemaUsed = null;

    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = chunks[i];
      const chunkSize = fs.statSync(chunkPath).size;
      process.stdout.write(
        `[${i + 1}/${chunks.length}] Uploading ${path.basename(chunkPath)} (${(chunkSize / 1024).toFixed(1)} KB)... `,
      );

      const res = await uploadChunk(chunkPath, options.url, options.schema);
      totalRecords += res.recordsProcessed || 0;
      totalUpdated += res.packagesUpdated || 0;
      totalAdded += res.totalHallucinationsAdded || 0;
      schemaUsed = res.schemaUsed || schemaUsed;

      console.log(`OK (records: ${res.recordsProcessed}, added: ${res.totalHallucinationsAdded})`);
    }

    console.log("\n=== Upload Complete ===");
    console.log(`Schema used:                 ${schemaUsed || options.schema || "(auto-detect)"}`);
    console.log(`Total records processed:     ${totalRecords}`);
    console.log(`Packages updated:            ${totalUpdated}`);
    console.log(`Total hallucinations added:  ${totalAdded}`);

    if (tempDir) {
      if (options.keepChunks) {
        console.log(`Temporary chunks kept at:    ${tempDir}`);
      } else {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log("Temporary chunks cleaned up.");
      }
    }
  } catch (err) {
    console.error(`\nUpload failed: ${err.message}`);
    if (splitResult?.tempDir && !options.keepChunks) {
      try {
        fs.rmSync(splitResult.tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error on exit
      }
    }
    process.exit(1);
  }
}

main();
