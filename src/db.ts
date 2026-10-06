import mongoose from "mongoose";
import { ensureSeed } from "./seed";

export class MongoUnavailable extends Error {
  constructor() {
    super("Cannot reach MongoDB. Check MONGODB_URI in sida-server/.env.");
    this.name = "MongoUnavailable";
  }
}

export async function connectDb() {
  const uri = process.env.MONGODB_URI || "";
  if (!uri) throw new MongoUnavailable();
  try {
    await mongoose.connect(uri, {
      dbName: "sida",
      serverSelectionTimeoutMS: 10000,
    });
    await mongoose.connection.db?.command({ ping: 1 });
  } catch {
    await mongoose.disconnect().catch(() => undefined);
    throw new MongoUnavailable();
  }
  await ensureSeed();
}
