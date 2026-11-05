import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATABASE_PATH = path.join(__dirname, 'database.jsonl');

/**
 * Analyzes the database file and returns package counts sorted descending.
 * @param {string} [filePath=DEFAULT_DATABASE_PATH]
 * @returns {Array<[string, number]>}
 */
export function getPackageCounts(filePath = DEFAULT_DATABASE_PATH) {
  const data = fs.readFileSync(filePath, 'utf8');
  const lines = data.split('\n');
  const counts = {};

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (Array.isArray(obj.modulenotfound)) {
        for (const module of obj.modulenotfound) {
          counts[module] = (counts[module] || 0) + 1;
        }
      }
    } catch {
      // Skip invalid JSON lines
    }
  }

  return Object.entries(counts)
    .map(([key, val]) => [key.replace(/^['"]|['"]$/g, ''), val])
    .sort((a, b) => b[1] - a[1]);
}

/**
 * Returns packages that repeat at least minCount times.
 * @param {number} [minCount=5]
 * @param {string} [filePath=DEFAULT_DATABASE_PATH]
 * @returns {Array<{ name: string, count: number }>}
 */
export function getRepeatedPackages(minCount = 5, filePath = DEFAULT_DATABASE_PATH) {
  return getPackageCounts(filePath)
    .filter(([_, count]) => count >= minCount)
    .map(([name, count]) => ({ name, count }));
}

// If executed directly, maintain original CLI output behavior
if (process.argv[1] === __filename) {
  try {
    const sortedCounts = getPackageCounts();
    console.log('{');
    sortedCounts.forEach(([key, val], index) => {
      const isLast = index === sortedCounts.length - 1;
      console.log(`  ${key}: ${val}${isLast ? '' : ','}`);
    });
    console.log('}');
  } catch (err) {
    console.error('Error:', err.message);
  }
}
