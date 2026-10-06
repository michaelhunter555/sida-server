import type { Request, Response } from "express";
import { User } from "../../../models";
import { ExpiredTokenError, verifyRefreshToken } from "../../../util/jwt";
import { issueSession } from "./session";

export async function refresh(req: Request, res: Response) {
  const userId = String(req.params.userId || "");
  const refreshToken = typeof req.body?.refreshToken === "string" ? req.body.refreshToken : "";
  if (!userId || !refreshToken) {
    res.status(401).json({ error: "INVALID_REFRESH", action: "logout", ok: false });
    return;
  }

  try {
    const payload = await verifyRefreshToken(refreshToken);
    if (payload.sub !== userId || !payload.jti) {
      res.status(401).json({ error: "INVALID_REFRESH", action: "logout", ok: false });
      return;
    }

    const user = await User.findById(userId).select("+currentRefreshJti +currentRefreshExpiresAt");
    if (!user) {
      res.status(401).json({ error: "INVALID_REFRESH", action: "logout", ok: false });
      return;
    }

    const currentJti = user.get("currentRefreshJti");
    const expiresAt = user.get("currentRefreshExpiresAt");
    const expired = typeof expiresAt === "string" && expiresAt && Date.parse(expiresAt) <= Date.now();
    if (currentJti !== payload.jti || expired) {
      res.status(401).json({ error: "INVALID_REFRESH", action: "logout", ok: false });
      return;
    }

    const email = user.get("email");
    const session = await issueSession({
      _id: String(user._id),
      email: typeof email === "string" ? email : "",
    });
    res.json({ token: session.token, refreshToken: session.refreshToken, ok: true });
  } catch (error) {
    if (error instanceof ExpiredTokenError) {
      res.status(401).json({ error: "EXPIRED_TOKEN", action: "logout", ok: false });
      return;
    }
    console.error(error);
    res.status(401).json({ error: "INVALID_REFRESH", action: "logout", ok: false });
  }
}
