import { MongoClient } from 'mongodb';

let cachedClient = global._mongoClient || null;
let cachedDb = global._mongoDb || null;

export async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is missing.');
  }

  const client = new MongoClient(uri);
  await client.connect();

  // Directly uses the database name specified in MONGODB_URI
  const db = client.db();

  if (process.env.NODE_ENV !== 'production') {
    global._mongoClient = client;
    global._mongoDb = db;
  }

  cachedClient = client;
  cachedDb = db;
  return { client, db };
}
