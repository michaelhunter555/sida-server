import type { Server as HttpServer } from "http";
import { Server, type Socket } from "socket.io";
import type { NotificationPayloads, Notifications } from "./lib/notifications";
import { ExpiredTokenError, verifyAccessToken } from "./util/jwt";

interface SocketData {
  userId: string;
  email: string;
}

let io: Server<Record<string, never>, Record<string, never>, Record<string, never>, SocketData> | null = null;

function roomFor(userId: string) {
  return `user:${userId}`;
}

/** Reads the access token from `auth.token` (socket.io-client `auth` option) or an Authorization header. */
function tokenFrom(socket: Socket): string {
  const auth = socket.handshake.auth as { token?: unknown };
  if (typeof auth?.token === "string" && auth.token) return auth.token;
  const header = socket.handshake.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

/** Attaches Socket.IO to the HTTP server. Every connection must present a valid access token. */
export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });

  io.use(async (socket, next) => {
    const token = tokenFrom(socket);
    if (!token) return next(new Error("MISSING_TOKEN"));
    try {
      const payload = await verifyAccessToken(token);
      socket.data.userId = payload.sub;
      socket.data.email = payload.email;
      next();
    } catch (error) {
      next(new Error(error instanceof ExpiredTokenError ? "EXPIRED_TOKEN" : "INVALID_TOKEN"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(roomFor(socket.data.userId));
  });

  return io;
}

/** Sends a typed notification to every connected device of one user. No-op when sockets aren't initialised. */
export function notifyUser<N extends Notifications>(userId: string, notification: N, payload: NotificationPayloads[N]) {
  if (!io || !userId) return;
  io.to(roomFor(userId)).emit(notification, payload);
}
