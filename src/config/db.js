import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongo:27017/slopstorager';
const DB_NAME = process.env.MONGO_DB_NAME || 'slopstorager';
const COLLECTION_NAME = 'packages';

let client;
let db;

/**
 * Connects to MongoDB with retry logic and ensures indexes on the packages collection.
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

      const collection = db.collection(COLLECTION_NAME);
      await collection.createIndex({ name: 1 }, { unique: true });
      await collection.createIndex({ hallucinationCounts: -1 });

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
  return db.collection(COLLECTION_NAME);
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

