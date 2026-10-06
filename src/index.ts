import cors from "cors";
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { authRouter } from "./controllers/user/auth/router";
import { cloudinaryReady } from "./cloudinary";
import { connectDb } from "./db";
import { errorHandler } from "./http";
import { router } from "./routes";
import { initSocket } from "./socket";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));
// Photo saves upload the file bytes directly. express.json ignores these.
app.use(express.raw({ type: "image/*", limit: "25mb" }));
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
app.use(authRouter);
app.use(router);
app.use(errorHandler);

const port = Number(process.env.PORT || 4000);
const server = createServer(app);
initSocket(server);

connectDb()
  .then(() => {
    server.listen(port, () => {
      console.log(`sida-server listening on ${port}`);
      if (!cloudinaryReady()) {
        console.log("Cloudinary uploads are off until CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_SECRET are set.");
      }
    });
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Failed to start";
    console.error(message);
    process.exit(1);
  });
