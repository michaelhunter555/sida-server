import mongoose from "mongoose";
import { ensureSeed } from "./seed";

export class MongoUnavailable extends Error {
  constructor(detail?: string) {
    super(detail ? `Cannot reach MongoDB. ${detail}` : "Cannot reach MongoDB. MONGODB_URI is not set.");
    this.name = "MongoUnavailable";
  }
}

export async function connectDb() {
  const uri = process.env.MONGODB_URI || "";
  if (!uri) throw new MongoUnavailable();
  try {
    await mongoose.connect(uri, {
      dbName: "sida",
      family: 4,
      serverSelectionTimeoutMS: 10000,
    });
    await mongoose.connection.db?.command({ ping: 1 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "connection failed";
    await mongoose.disconnect().catch(() => undefined);
    throw new MongoUnavailable(detail);
  }
  await ensureSeed();
}
