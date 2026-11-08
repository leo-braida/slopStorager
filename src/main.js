import express from 'express';
import multer from 'multer';
import { connectDB, getPackagesCollection } from './config/db.js';
import { parseJsonlContent } from './analyze.js';
import { checkIfItsPublishable } from './isPublicable.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Support raw text / jsonl payloads in addition to multipart/form-data
app.use(
  express.text({
    type: ['text/*', 'application/x-ndjson', 'application/jsonl', 'application/json'],
    limit: '50mb'
  })
);

/**
 * Helper to parse and validate the `minCount` query parameter.
 * @param {unknown} rawMinCount
 * @returns {{ minCount: number, error?: string }}
 */
function parseMinCount(rawMinCount) {
  if (rawMinCount === undefined || rawMinCount === '') {
    return { minCount: 1 };
  }
  const parsed = Number(rawMinCount);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { minCount: 1, error: 'Query parameter "minCount" must be a non-negative number.' };
  }
  return { minCount: Math.floor(parsed) };
}

/**
 * POST /upload
 * Uploads a .jsonl file (multipart/form-data or raw body) and populates MongoDB.
 */
app.post('/upload', upload.any(), async (req, res) => {
  try {
    let content = '';

    if (Array.isArray(req.files) && req.files.length > 0) {
      content = req.files.map((f) => f.buffer.toString('utf8')).join('\n');
    } else if (typeof req.body === 'string' && req.body.trim().length > 0) {
      content = req.body;
    } else {
      return res.status(400).json({
        error: 'No file or JSONL content provided. Upload a file via multipart/form-data (field "file") or send raw JSONL in the request body.'
      });
    }

    const { counts, validLines } = parseJsonlContent(content);

    if (validLines === 0) {
      return res.status(400).json({
        error: 'Uploaded content contains no valid JSON lines.'
      });
    }

    const collection = getPackagesCollection();
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
              $setOnInsert: { name, firstDate: now }
            },
            upsert: true
          }
        };
      });

      await collection.bulkWrite(operations);
    }

    return res.status(200).json({
      message: 'File uploaded and database populated successfully.',
      linesProcessed: validLines,
      packagesUpdated: counts.length,
      totalHallucinationsAdded
    });
  } catch (error) {
    console.error('Error in POST /upload:', error);
    return res.status(500).json({ error: 'Internal server error while processing upload.' });
  }
});

/**
 * GET /getPackages
 * Query param: minCount (optional, default 1)
 * Returns packages that hallucinated at least minCount times.
 */
app.get('/getPackages', async (req, res) => {
  try {
    const { minCount, error } = parseMinCount(req.query.minCount);
    if (error) {
      return res.status(400).json({ error });
    }

    const collection = getPackagesCollection();
    const packages = await collection
      .find({ hallucinationCounts: { $gte: minCount } }, { projection: { _id: 0 } })
      .sort({ hallucinationCounts: -1, name: 1 })
      .toArray();

    return res.status(200).json(packages);
  } catch (error) {
    console.error('Error in GET /getPackages:', error);
    return res.status(500).json({ error: 'Internal server error while fetching packages.' });
  }
});

/**
 * GET /getPublicables
 * Query param: minCount (optional, default 1)
 * Returns packages that hallucinated at least minCount times along with `isPublicable` boolean.
 */
app.get('/getPublicables', async (req, res) => {
  try {
    const { minCount, error } = parseMinCount(req.query.minCount);
    if (error) {
      return res.status(400).json({ error });
    }

    const collection = getPackagesCollection();
    const packages = await collection
      .find({ hallucinationCounts: { $gte: minCount } }, { projection: { _id: 0 } })
      .sort({ hallucinationCounts: -1, name: 1 })
      .toArray();

    const results = await Promise.all(
      packages.map(async (pkg) => {
        const isPublicable = await checkIfItsPublishable(pkg.name);
        return {
          ...pkg,
          isPublicable
        };
      })
    );

    return res.status(200).json(results);
  } catch (error) {
    console.error('Error in GET /getPublicables:', error);
    return res.status(500).json({ error: 'Internal server error while checking publicable packages.' });
  }
});

async function startServer() {
  try {
    await connectDB();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server listening on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

startServer();

export { app };
