import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getRepeatedPackages } from './analyze.js';
import { checkIfItsPublishable } from './isPublicable.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CSV_OUTPUT = path.join(__dirname, 'packages_availability.csv');

/**
 * Escapes a field for CSV output if it contains special characters.
 * @param {string} value
 * @returns {string}
 */
function escapeCsv(value) {
  if (!value) return '';
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Converts arrays of available and not-available packages into a 2-column CSV string.
 * @param {string[]} available
 * @param {string[]} notAvailable
 * @returns {string}
 */
export function formatToCsv(available, notAvailable) {
  const maxRows = Math.max(available.length, notAvailable.length);
  const rows = ['Available,Not Available'];

  for (let i = 0; i < maxRows; i++) {
    const availCol = escapeCsv(available[i] || '');
    const notAvailCol = escapeCsv(notAvailable[i] || '');
    rows.push(`${availCol},${notAvailCol}`);
  }

  return rows.join('\n') + '\n';
}

/**
 * Main execution function:
 * 1. Reads packages repeating >= minCount times from analyze.js
 * 2. Checks availability on NPM using isPublicable.js
 * 3. Generates and writes the 2-column CSV
 *
 * @param {object} [options]
 * @param {number} [options.minCount=5]
 * @param {string} [options.outputCsvPath=DEFAULT_CSV_OUTPUT]
 */
export async function run({ minCount = 3, outputCsvPath = DEFAULT_CSV_OUTPUT } = {}) {
  console.log(`\n🔍 Finding packages that repeat at least ${minCount} times...`);
  const packages = getRepeatedPackages(minCount);

  console.log(`Found ${packages.length} packages meeting the threshold (repeats >= ${minCount}):\n`);

  const available = [];
  const notAvailable = [];

  for (let i = 0; i < packages.length; i++) {
    const { name, count } = packages[i];
    process.stdout.write(`[${i + 1}/${packages.length}] Checking "${name}" (count: ${count})... `);

    const isAvailable = await checkIfItsPublishable(name);

    if (isAvailable) {
      console.log('✅ AVAILABLE');
      available.push(name);
    } else {
      console.log('❌ NOT AVAILABLE');
      notAvailable.push(name);
    }
  }

  const csvContent = formatToCsv(available, notAvailable);
  fs.writeFileSync(outputCsvPath, csvContent, 'utf8');

  console.log('\n📊 Summary:');
  console.log(` - Total packages checked: ${packages.length}`);
  console.log(` - Available: ${available.length}`);
  console.log(` - Not Available: ${notAvailable.length}`);
  console.log(`\n📄 CSV output saved to: ${outputCsvPath}\n`);

  return { available, notAvailable, outputCsvPath };
}

// Run if executed directly
if (process.argv[1] === __filename) {
  run().catch((err) => {
    console.error('Fatal error running verification:', err);
    process.exit(1);
  });
}
