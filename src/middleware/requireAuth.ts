import type { NextFunction, Request, Response } from "express";
import { ExpiredTokenError, verifyAccessToken } from "../util/jwt";

export type AuthedRequest = Request & { userId: string; userEmail: string };

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) {
    res.status(401).json({ error: "MISSING_TOKEN", action: "logout", ok: false });
    return;
  }

  try {
    const payload = await verifyAccessToken(token);
    (req as AuthedRequest).userId = payload.sub;
    (req as AuthedRequest).userEmail = payload.email;
    next();
  } catch (error) {
    if (error instanceof ExpiredTokenError) {
      res.status(401).json({ error: "EXPIRED_TOKEN", ok: false });
      return;
    }
    res.status(401).json({ error: "INVALID_TOKEN", action: "logout", ok: false });
  }
}
