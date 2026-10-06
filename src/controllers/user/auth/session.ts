import { randomUUID } from "crypto";
import type { HydratedDocument } from "mongoose";
import { User } from "../../../models";
import { createAccessToken, createRefreshToken } from "../../../util/jwt";

const REFRESH_MS = 1000 * 60 * 60 * 24 * 7;

type UserDoc = HydratedDocument<Record<string, unknown>> & { _id: string; email?: string };

export async function issueSession(user: { _id: string; email?: string | null }) {
  const jti = randomUUID();
  const now = new Date().toISOString();
  const currentRefreshExpiresAt = new Date(Date.now() + REFRESH_MS).toISOString();
  await User.updateOne(
    { _id: user._id },
    { $set: { currentRefreshJti: jti, currentRefreshExpiresAt, updatedAt: now } },
  );
  const email = user.email || "";
  const token = await createAccessToken({ sub: user._id, email });
  const refreshToken = await createRefreshToken({ sub: user._id, email, jti });
  return { token, refreshToken };
}

export function clientUser(user: UserDoc | { toObject: () => Record<string, unknown> }) {
  const obj = user.toObject();
  const id = String(obj._id);
  delete obj._id;
  delete obj.passwordHash;
  delete obj.currentRefreshJti;
  delete obj.currentRefreshExpiresAt;
  return { id, ...obj };
}
