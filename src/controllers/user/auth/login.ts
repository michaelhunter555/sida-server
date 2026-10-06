import { createHash, randomUUID } from "crypto";
import type { Request, Response } from "express";
import { OAuth2Client } from "google-auth-library";
import * as jose from "jose";
import { User } from "../../../models";
import { hashPassword, verifyPassword } from "../../../util/password";
import { clientUser, issueSession } from "./session";

const APPLE_KEYS = jose.createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));

export async function login(req: Request, res: Response) {
  const provider = req.body?.provider;
  const timeZone = typeof req.body?.timeZone === "string" ? req.body.timeZone : "";

  try {
    if (provider === "google") {
      await loginWithGoogle(req, res, timeZone);
      return;
    }
    if (provider === "apple") {
      await loginWithApple(req, res, timeZone);
      return;
    }
    if (provider === "guest") {
      await loginAsGuest(req, res, timeZone);
      return;
    }
    if (provider === "email") {
      await loginWithEmail(req, res, timeZone);
      return;
    }
    res.status(400).json({ error: "Unknown login provider", ok: false });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Internal server error";
    res.status(500).json({ error: message, ok: false });
  }
}

async function loginWithEmail(req: Request, res: Response, timeZone: string) {
  const email = normalizeEmail(req.body?.email);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const creating = Boolean(req.body?.isNewManualSignUp);
  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required.", ok: false });
    return;
  }

  const existing = await User.findOne({ email }).select("+passwordHash");
  if (!existing) {
    if (!creating) {
      res.status(401).json({ error: "Invalid email or password", ok: false });
      return;
    }
    const created = await User.create({
      _id: randomUUID(),
      email,
      name: name || email.split("@")[0],
      passwordHash: await hashPassword(password),
      loginMethod: "email",
      emailVerified: false,
      isGuest: false,
      ...(timeZone ? { timeZone } : {}),
      updatedAt: new Date().toISOString(),
    });
    await sendSession(res, created, 201);
    return;
  }

  const passwordHash = typeof existing.get("passwordHash") === "string" ? existing.get("passwordHash") : "";
  if (!passwordHash || !(await verifyPassword(password, passwordHash))) {
    res.status(401).json({ error: "Invalid email or password", ok: false });
    return;
  }
  if (timeZone) existing.set("timeZone", timeZone);
  await existing.save();
  await sendSession(res, existing, 200);
}

async function loginWithGoogle(req: Request, res: Response, timeZone: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const idToken = typeof req.body?.idToken === "string" ? req.body.idToken : "";
  if (!clientId) {
    res.status(500).json({ error: "GOOGLE_CLIENT_ID is not set.", ok: false });
    return;
  }
  if (!idToken) {
    res.status(401).json({ error: "Invalid Google token", ok: false });
    return;
  }

  const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();
  const email = normalizeEmail(payload?.email);
  if (!email) {
    res.status(401).json({ error: "Invalid email", ok: false });
    return;
  }

  const { user, created } = await findOrCreate(email, {
    name: payload?.name || email.split("@")[0],
    loginMethod: "google",
    emailVerified: true,
    googleId: payload?.sub || "",
    imagePath: payload?.picture || "",
    timeZone,
  });
  await sendSession(res, user, created ? 201 : 200);
}

async function loginWithApple(req: Request, res: Response, timeZone: string) {
  const idToken = typeof req.body?.idToken === "string" ? req.body.idToken : "";
  const rawNonce = typeof req.body?.rawNonce === "string" ? req.body.rawNonce : "";
  if (!idToken) {
    res.status(401).json({ error: "Invalid or expired token", ok: false });
    return;
  }

  const audience = process.env.APPLE_CLIENT_ID || "com.michael.hunter22620.sida";
  const { payload } = await jose.jwtVerify(idToken, APPLE_KEYS, {
    issuer: "https://appleid.apple.com",
    audience,
  });
  if (payload.nonce && rawNonce) {
    const hashed = createHash("sha256").update(rawNonce).digest("hex");
    if (payload.nonce !== hashed && payload.nonce !== rawNonce) {
      res.status(401).json({ error: "Invalid nonce", ok: false });
      return;
    }
  }

  const appleId = typeof payload.sub === "string" ? payload.sub : "";
  const email = normalizeEmail(payload.email) || normalizeEmail(req.body?.email);
  const givenName = typeof req.body?.givenName === "string" ? req.body.givenName : "";
  const familyName = typeof req.body?.familyName === "string" ? req.body.familyName : "";
  const name = `${givenName} ${familyName}`.trim();

  let user = email ? await User.findOne({ email }) : null;
  if (!user && appleId) user = await User.findOne({ appleId });
  if (!user) {
    if (!email) {
      res.status(401).json({ error: "Invalid email", ok: false });
      return;
    }
    user = await User.create({
      _id: randomUUID(),
      email,
      name: name || "Apple User",
      appleId,
      loginMethod: "apple",
      emailVerified: true,
      isGuest: false,
      ...(timeZone ? { timeZone } : {}),
      updatedAt: new Date().toISOString(),
    });
    await sendSession(res, user, 201);
    return;
  }

  if (appleId) user.set("appleId", appleId);
  if (timeZone) user.set("timeZone", timeZone);
  await user.save();
  await sendSession(res, user, 200);
}

async function loginAsGuest(req: Request, res: Response, timeZone: string) {
  const localGuestId = typeof req.body?.localGuestId === "string" ? req.body.localGuestId.trim() : "";
  const email = localGuestId || randomUUID();
  const { user, created } = await findOrCreate(email, {
    name: "Guest User",
    loginMethod: "guest",
    emailVerified: false,
    isGuest: true,
    timeZone,
  });
  await sendSession(res, user, created ? 201 : 200);
}

async function findOrCreate(
  email: string,
  fields: {
    name: string;
    loginMethod: string;
    emailVerified: boolean;
    isGuest?: boolean;
    googleId?: string;
    imagePath?: string;
    timeZone?: string;
  },
) {
  const existing = await User.findOne({ email });
  if (existing) {
    if (fields.timeZone) existing.set("timeZone", fields.timeZone);
    if (fields.googleId) existing.set("googleId", fields.googleId);
    if (fields.imagePath) existing.set("imagePath", fields.imagePath);
    await existing.save();
    return { user: existing, created: false };
  }
  const user = await User.create({
    _id: randomUUID(),
    email,
    name: fields.name,
    loginMethod: fields.loginMethod,
    emailVerified: fields.emailVerified,
    isGuest: Boolean(fields.isGuest),
    ...(fields.googleId ? { googleId: fields.googleId } : {}),
    ...(fields.imagePath ? { imagePath: fields.imagePath } : {}),
    ...(fields.timeZone ? { timeZone: fields.timeZone } : {}),
    updatedAt: new Date().toISOString(),
  });
  return { user, created: true };
}

async function sendSession(res: Response, user: { _id: unknown; email?: string | null; toObject: () => Record<string, unknown> }, status: number) {
  const session = await issueSession({ _id: String(user._id), email: user.email });
  res.status(status).json({
    userData: clientUser(user),
    token: session.token,
    refreshToken: session.refreshToken,
    ok: true,
  });
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
