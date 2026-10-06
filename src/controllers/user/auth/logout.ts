import type { Request, Response } from "express";
import type { AuthedRequest } from "../../../middleware/requireAuth";
import { User } from "../../../models";

export async function logout(req: Request, res: Response) {
  const userId = String(req.params.userId || "");
  const authUserId = (req as AuthedRequest).userId;
  if (!userId || authUserId !== userId) {
    res.status(403).json({ error: "Forbidden", ok: false });
    return;
  }
  await User.updateOne({ _id: userId }, { $set: { currentRefreshJti: "", currentRefreshExpiresAt: "" } });
  res.json({ ok: true });
}
