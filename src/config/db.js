import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/slopstorager';
const DB_NAME = process.env.MONGO_DB_NAME || 'slopstorager';
const PACKAGES_COLLECTION = 'packages';
const SCHEMAS_COLLECTION = 'schemas';

let client;
let db;

/**
 * Connects to MongoDB with retry logic and ensures indexes on packages and schemas collections.
 * @param {number} [retries=10]
 * @param {number} [delayMs=2000]
 * @returns {Promise<import('mongodb').Db>}
 */
export async function connectDB(retries = 10, delayMs = 2000) {
  if (db) return db;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      client = new MongoClient(MONGO_URI);
      await client.connect();
      db = client.db(DB_NAME);

      const packagesCol = db.collection(PACKAGES_COLLECTION);
      await packagesCol.createIndex({ name: 1 }, { unique: true });
      await packagesCol.createIndex({ hallucinationCounts: -1 });

      const schemasCol = db.collection(SCHEMAS_COLLECTION);
      await schemasCol.createIndex({ name: 1 }, { unique: true });

      console.log(`Connected to MongoDB at ${MONGO_URI}`);
      return db;
    } catch (err) {
      console.warn(`MongoDB connection attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Returns the MongoDB 'packages' collection.
 * @returns {import('mongodb').Collection}
 */
export function getPackagesCollection() {
  if (!db) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return db.collection(PACKAGES_COLLECTION);
}

/**
 * Returns the MongoDB 'schemas' collection.
 * @returns {import('mongodb').Collection}
 */
export function getSchemasCollection() {
  if (!db) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return db.collection(SCHEMAS_COLLECTION);
}

/**
 * Closes the MongoDB client connection.
 */
export async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
