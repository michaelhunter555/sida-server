import { Router } from "express";
import { asyncRoute } from "../../../http";
import { requireAuth } from "../../../middleware/requireAuth";
import { login } from "./login";
import { logout } from "./logout";
import { refresh } from "./refresh";
import { storePushToken } from "./store-token";

export const authRouter = Router();

authRouter.post("/auth/login", asyncRoute(login));
authRouter.post("/auth/refresh/:userId", asyncRoute(refresh));
authRouter.post("/auth/logout/:userId", requireAuth, asyncRoute(logout));
authRouter.post("/auth/store-token/:userId", requireAuth, asyncRoute(storePushToken));
