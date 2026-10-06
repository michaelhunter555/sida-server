import { errors, jwtVerify, SignJWT } from "jose";

const ACCESS_TTL = "15m";
const REFRESH_TTL = "7d";

export class ExpiredTokenError extends Error {
  constructor() {
    super("EXPIRED_TOKEN");
    this.name = "ExpiredTokenError";
  }
}

function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set.");
  return new TextEncoder().encode(secret);
}

export async function createAccessToken(payload: { sub: string; email: string }) {
  return new SignJWT({ email: payload.email, tokenUse: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(secretKey());
}

export async function createRefreshToken(payload: { sub: string; email: string; jti: string }) {
  return new SignJWT({ email: payload.email, tokenUse: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setJti(payload.jti)
    .setIssuedAt()
    .setExpirationTime(REFRESH_TTL)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string) {
  return verify(token, "access");
}

export async function verifyRefreshToken(token: string) {
  return verify(token, "refresh");
}

async function verify(token: string, tokenUse: "access" | "refresh") {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.tokenUse !== tokenUse || typeof payload.sub !== "string") {
      throw new Error("Invalid token");
    }
    return {
      sub: payload.sub,
      email: typeof payload.email === "string" ? payload.email : "",
      jti: typeof payload.jti === "string" ? payload.jti : "",
    };
  } catch (error) {
    if (error instanceof errors.JWTExpired) throw new ExpiredTokenError();
    throw error;
  }
}
