import type { Request, Response } from "express";
import type { AuthedRequest } from "../../../middleware/requireAuth";
import { User } from "../../../models";
import { isExpoPushToken } from "../../../util/expo";

export async function storePushToken(req: Request, res: Response) {
  const userId = String(req.params.userId || "");
  const authUserId = (req as AuthedRequest).userId;
  if (!userId || authUserId !== userId) {
    res.status(403).json({ error: "Forbidden", ok: false });
    return;
  }

  const pushToken = typeof req.body?.pushToken === "string" ? req.body.pushToken.trim() : "";
  if (!pushToken) {
    res.status(400).json({ error: "A push token is required.", ok: false });
    return;
  }
  if (!isExpoPushToken(pushToken)) {
    res.status(400).json({ error: "Invalid push token", ok: false });
    return;
  }

  await User.updateOne(
    { _id: userId },
    { $set: { pushToken, updatedAt: new Date().toISOString() } },
  );
  res.json({ ok: true });
}
