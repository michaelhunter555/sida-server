import { randomUUID } from "crypto";
import { type Request, Router } from "express";
import { loadBundle } from "./bundle";
import { cloudinaryReady, uploadImage } from "./cloudinary";
import { HttpError, asyncRoute } from "./http";
import { type AuthedRequest, requireAuth } from "./middleware/requireAuth";
import { estimateFromPoints, generateRoomCloud, presetForRoom, roundPoints, type Vec3 } from "./lib/estimate";
import { DOCUMENT_EMAIL, claimMeta } from "./lib/matrix";
import { Notifications } from "./lib/notifications";
import { notifyUser } from "./socket";
import { CLAIM_TYPES, type ClaimType, type ScanRegion, type ScanSource, type Section } from "./lib/types";
import {
  Claim,
  DocumentRequest,
  Limitation,
  Photo,
  Reading,
  Room,
  Scan,
  User,
  publicId,
} from "./models";
import { resetSeed } from "./seed";

export const router = Router();

const ROOF_SLOPES = [
  ["Front Slope", "F"],
  ["Right Slope", "R"],
  ["Back Slope", "B"],
  ["Left Slope", "L"],
] as const;

const ELEVATIONS = ["Front Elevation", "Right Elevation", "Rear Elevation", "Left Elevation"];

router.get(
  "/api/claims",
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = (req as AuthedRequest).userId;
    const account = await User.findById(userId).select("isGuest").lean<{ isGuest?: boolean }>();
    const filter = account?.isGuest
      ? { $or: [{ demo: true }, { ownerId: userId }] }
      : { ownerId: userId };
    const claims = await Claim.find(filter).sort({ updatedAt: -1 }).lean<{ _id: string; inspectionCount?: number }[]>();
    const photos = await Photo.find({ deletedAt: null }).select("claimId inspection").lean<{ claimId: string; inspection?: string }[]>();
    const byClaim = new Map<string, { photos: number; inspections: Set<string> }>();
    for (const photo of photos) {
      const bucket = byClaim.get(photo.claimId) ?? { photos: 0, inspections: new Set<string>() };
      bucket.photos += 1;
      bucket.inspections.add(photo.inspection || "initial");
      byClaim.set(photo.claimId, bucket);
    }
    res.json(
      claims.map((doc) => {
        const stats = byClaim.get(String(doc._id));
        return {
          ...publicId(doc),
          photoCount: stats?.photos ?? 0,
          inspectionCount: stats?.inspections.size ?? doc.inspectionCount ?? 1,
        };
      }),
    );
  }),
);

router.post(
  "/api/claims",
  requireAuth,
  asyncRoute(async (req, res) => {
    const body = req.body ?? {};
    const claimType = body.claimType as ClaimType;
    if (!body.insuredName || !body.claimNumber || !CLAIM_TYPES.includes(claimType)) {
      throw new HttpError(400, "Insured name, claim number, and claim type are required.");
    }
    const now = new Date().toISOString();
    const claimId = randomUUID();
    await Claim.create({
      _id: claimId,
      claimNumber: String(body.claimNumber).trim(),
      insuredName: String(body.insuredName).trim(),
      dateOfLoss: body.dateOfLoss || "",
      riskAddress: body.riskAddress || "",
      carrier: body.carrier || "",
      claimType,
      syncStatus: "local",
      triggers: [],
      policeReport: body.policeReport || "",
      inspectionCount: 1,
      demo: false,
      ownerId: (req as AuthedRequest).userId,
      createdAt: now,
      updatedAt: now,
    });
    const meta = claimMeta(claimType);
    const rooms = ELEVATIONS.map((name) => ({
      _id: randomUUID(),
      claimId,
      name,
      section: "exterior" as Section,
      triggers: [] as string[],
    }));
    if (meta.roof) {
      for (const [name, slopeCode] of ROOF_SLOPES) {
        rooms.push({ _id: randomUUID(), claimId, name, section: "roof", triggers: [], slopeCode } as (typeof rooms)[number] & {
          slopeCode: string;
        });
      }
    }
    await Room.insertMany(rooms);
    if (meta.water) {
      await DocumentRequest.create({
        _id: randomUUID(),
        claimId,
        label: meta.id === "water_roof" ? "Roofing invoice" : "Plumbing invoice",
        requested: false,
        email: DOCUMENT_EMAIL,
      });
    }
    res.json({ id: claimId });
  }),
);

router.get(
  "/api/places",
  requireAuth,
  asyncRoute(async (req, res) => {
    const raw = req.query.query;
    const query = (Array.isArray(raw) ? raw[0] : raw);
    const input = typeof query === "string" ? query.trim() : "";
    if (input.length < 3) {
      res.json({ ok: true, predictions: [] });
      return;
    }
    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) throw new HttpError(500, "GOOGLE_MAPS_API_KEY is not set.");

    const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
      },
      body: JSON.stringify({ input }),
    });
    const json = (await response.json()) as {
      suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string } } }[];
    };
    if (!response.ok) throw new HttpError(502, "Address search failed.");

    const predictions = (json.suggestions ?? []).flatMap((item) => {
      const description = item.placePrediction?.text?.text;
      const placeId = item.placePrediction?.placeId;
      if (!description || !placeId) return [];
      return [{ description, place_id: placeId }];
    });
    res.json({ ok: true, predictions });
  }),
);

router.get(
  "/api/claims/:id",
  asyncRoute(async (req, res) => {
    const doc = await Claim.findById(req.params.id).lean<{ _id: string }>();
    if (!doc) throw new HttpError(404, "Claim not found");
    console.log("retrieved claim")
    res.json(publicId(doc));
  }),
);

router.patch(
  "/api/claims/:id",
  asyncRoute(async (req, res) => {
    const allowed = ["insuredName", "claimNumber", "dateOfLoss", "riskAddress", "carrier", "claimType", "syncStatus", "triggers", "policeReport"];
    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    for (const key of allowed) {
      if (key in req.body) update[key] = req.body[key];
    }
    const result = await Claim.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean<{ _id: string }>();
    if (!result) throw new HttpError(404, "Claim not found");
    res.json(publicId(result));
  }),
);

router.get(
  "/api/claims/:id/bundle",
  asyncRoute(async (req, res) => {
    const bundle = await loadBundle(String(req.params.id));
    if (!bundle) throw new HttpError(404, "Claim not found");
    res.json(bundle);
  }),
);

router.post(
  "/api/claims/:id/rooms",
  asyncRoute(async (req, res) => {
    const claimId = String(req.params.id);
    const name = String(req.body.name || "").trim();
    const section = (req.body.section || "interior") as Section;
    if (!name) throw new HttpError(400, "Room name is required.");
    const claim = await Claim.findById(claimId).lean();
    if (!claim) throw new HttpError(404, "Claim not found");
    const doc = {
      _id: randomUUID(),
      claimId,
      name,
      section,
      lossRole: req.body.lossRole || (section === "interior" ? "Unknown" : undefined),
      triggers: Array.isArray(req.body.triggers) ? req.body.triggers : [],
      slopeCode: req.body.slopeCode,
    };
    await Room.create(doc);
    await Claim.updateOne({ _id: claimId }, { $set: { updatedAt: new Date().toISOString() } });
    res.json(publicId(doc));
  }),
);

router.post(
  "/api/claims/:id/photos",
  requireAuth,
  asyncRoute(async (req, res) => {
    const claimId = String(req.params.id);
    const claim = await Claim.findById(claimId).lean();
    if (!claim) throw new HttpError(404, "Claim not found");
    const userId = (req as AuthedRequest).userId;
    const account = await User.findById(userId).select("preferences.iptc").lean<{ preferences?: { iptc?: boolean } }>();
    const now = new Date().toISOString();
    const fields = photoFields(req);
    const chip = fields.chip || "Overview";
    const photoId = randomUUID();
    const imageData = photoBytes(req);
    const uploaded = imageData.startsWith("data:") && cloudinaryReady()
      ? await uploadImage(imageData, `sida/${claimId}/${photoId}`)
      : null;
    const doc = {
      _id: photoId,
      claimId,
      roomId: fields.roomId || null,
      chip,
      captionCode: fields.captionCode || undefined,
      caption: fields.caption || defaultCaption(chip, fields.captionCode),
      damageCategory: fields.damageCategory || undefined,
      lkq: fields.lkq,
      kind: fields.kind || "standard",
      hasImage: Boolean(uploaded || imageData),
      imageUrl: uploaded?.url || "",
      cloudinaryPublicId: uploaded?.publicId || "",
      imageData: uploaded ? "" : imageData,
      voiceNote: fields.voiceNote,
      iptcHeadline: chip,
      iptcWritten: account?.preferences?.iptc !== false,
      gps: fields.gps,
      capturedAt: now,
      syncStatus: "pending",
      inspection: fields.inspection || "initial",
      deletedAt: null,
    };
    await Photo.create(doc);
    await Claim.updateOne({ _id: claimId }, { $set: { updatedAt: now, syncStatus: "pending" } });
    const { imageData: _stored, ...rest } = doc;
    res.json(publicId(rest));
    notifyUser(userId, Notifications.imageUploadedNotification, {
      photoId,
      claimId,
      roomId: doc.roomId,
      chip,
      hasImage: doc.hasImage,
    });
  }),
);

router.post(
  "/api/claims/:id/limitations",
  asyncRoute(async (req, res) => {
    const reason = String(req.body.reason || "").trim();
    const key = String(req.body.key || "").trim();
    if (!key || !reason) throw new HttpError(400, "A limitation needs the item and a reason.");
    const doc = {
      _id: randomUUID(),
      claimId: String(req.params.id),
      key,
      reason,
      createdAt: new Date().toISOString(),
    };
    await Limitation.create(doc);
    res.json(publicId(doc));
  }),
);

router.patch(
  "/api/rooms/:id",
  asyncRoute(async (req, res) => {
    const allowed = [
      "name",
      "section",
      "lossRole",
      "triggers",
      "iicrcCategory",
      "iicrcClass",
      "scopeNote",
      "slopeCode",
      "hitCount",
      "windCount",
      "pitch",
      "measurements",
    ];
    const update: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) update[key] = req.body[key];
    }
    const result = await Room.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean<{ _id: string; claimId?: string }>();
    if (!result) throw new HttpError(404, "Room not found");
    if (result.claimId) {
      await Claim.updateOne({ _id: result.claimId }, { $set: { updatedAt: new Date().toISOString(), syncStatus: "pending" } });
    }
    res.json(publicId(result));
  }),
);

router.post(
  "/api/rooms/:id/readings",
  asyncRoute(async (req, res) => {
    const room = await Room.findById(req.params.id).lean<{ _id: string; claimId: string }>();
    if (!room) throw new HttpError(404, "Room not found");
    const value = Number(req.body.value);
    if (!req.body.location || !Number.isFinite(value)) {
      throw new HttpError(400, "Location and a numeric value are required.");
    }
    const doc = {
      _id: randomUUID(),
      roomId: String(req.params.id),
      claimId: room.claimId,
      location: String(req.body.location),
      value,
      unit: req.body.unit || "WME",
      instrument: req.body.instrument || "Delmhorst BD-2100",
      createdAt: new Date().toISOString(),
    };
    await Reading.create(doc);
    res.json(publicId(doc));
  }),
);

router.get(
  "/api/rooms/:id/scan",
  asyncRoute(async (req, res) => {
    const doc = await Scan.findOne({ roomId: req.params.id }).lean<{ _id: string }>();
    if (!doc) throw new HttpError(404, "No scan for this room");
    res.json(publicId(doc));
  }),
);

router.post(
  "/api/rooms/:id/scan",
  asyncRoute(async (req, res) => {
    const room = await Room.findById(req.params.id).lean<{ _id: string; claimId: string; name?: string }>();
    if (!room) throw new HttpError(404, "Room not found");
    const source: ScanSource =
      req.body.source === "lidar" ? "lidar" : req.body.source === "upload" ? "upload" : "generated";
    const measured = [req.body.lengthFt, req.body.widthFt, req.body.heightFt].map(Number);
    const hasDims = measured.every((n) => Number.isFinite(n) && n > 0);
    let raw = Array.isArray(req.body.points) ? (req.body.points as number[][]) : [];
    if (raw.length === 0 && source === "lidar") {
      // LiDAR region measurements give us wall dimensions, not a point cloud.
      // Build the rectangular cloud from them so the rest of the pipeline round-trips.
      if (!hasDims) throw new HttpError(400, "lengthFt, widthFt and heightFt are required for a LiDAR scan");
      raw = generateRoomCloud(measured[0], measured[1], measured[2]);
    } else if (req.body.generate && raw.length === 0) {
      const preset = presetForRoom(room.name || "Room");
      raw = generateRoomCloud(preset.lengthFt, preset.widthFt, preset.heightFt);
    }
    const regions = parseRegions(req.body.regions);
    const points = roundPoints(
      raw
        .filter((point) => Array.isArray(point) && point.length >= 3 && point.slice(0, 3).every((n) => Number.isFinite(Number(n))))
        .slice(0, 8000)
        .map((point) => [Number(point[0]), Number(point[1]), Number(point[2])] as Vec3),
    );
    const estimate = estimateFromPoints(points);
    const lengthFt = numberOr(req.body.lengthFt, estimate.lengthFt);
    const widthFt = numberOr(req.body.widthFt, estimate.widthFt);
    const heightFt = numberOr(req.body.heightFt, estimate.heightFt);
    const areaSqFt = Math.round(lengthFt * widthFt * 10) / 10;
    const now = new Date().toISOString();
    const existing = await Scan.findOne({ roomId: room._id }).lean<{ _id: string; createdAt?: string }>();
    const scanId = existing?._id || randomUUID();
    const doc = {
      _id: scanId,
      roomId: room._id,
      claimId: room.claimId,
      points,
      pointCount: points.length,
      lengthFt,
      widthFt,
      heightFt,
      areaSqFt,
      floorOk: estimate.floorOk,
      ceilingOk: estimate.ceilingOk,
      wallsOk: estimate.wallsOk,
      source,
      ...(regions.length ? { regions } : {}),
      unitNote: req.body.unitNote || "",
      createdAt: existing?.createdAt || now,
    };
    await Scan.replaceOne({ _id: scanId }, doc, { upsert: true });
    await Room.updateOne(
      { _id: room._id },
      {
        $set: {
          measurements: {
            lengthFt,
            widthFt,
            heightFt,
            areaSqFt,
            source: req.body.manual ? "manual" : source === "lidar" ? "lidar" : "scan",
          },
        },
      },
    );
    await Claim.updateOne({ _id: room.claimId }, { $set: { updatedAt: now, syncStatus: "pending" } });
    const { points: _points, ...summary } = doc;
    res.json({ ...publicId(summary), pointCount: points.length });
  }),
);

router.get(
  "/api/photos/:id",
  asyncRoute(async (req, res) => {
    const doc = await Photo.findById(req.params.id).select("-imageData").lean<{ _id: string }>();
    if (!doc) throw new HttpError(404, "Photo not found");
    res.json(publicId(doc));
  }),
);

router.patch(
  "/api/photos/:id",
  asyncRoute(async (req, res) => {
    const allowed = ["roomId", "chip", "captionCode", "caption", "damageCategory", "lkq", "voiceNote", "kind"];
    const update: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) update[key] = req.body[key];
    }
    if (typeof update.chip === "string") update.iptcHeadline = update.chip;
    const result = await Photo.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).select("-imageData").lean<{ _id: string }>();
    if (!result) throw new HttpError(404, "Photo not found");
    res.json(publicId(result));
  }),
);

router.delete(
  "/api/photos/:id",
  asyncRoute(async (req, res) => {
    const result = await Photo.findByIdAndUpdate(
      req.params.id,
      { $set: { deletedAt: new Date().toISOString() } },
      { new: true },
    )
      .select("-imageData")
      .lean<{ _id: string }>();
    if (!result) throw new HttpError(404, "Photo not found");
    res.json(publicId(result));
  }),
);

router.get(
  "/api/photos/:id/file",
  asyncRoute(async (req, res) => {
    const photo = await Photo.findById(req.params.id).lean<{ imageUrl?: string; imageData?: string; chip?: string }>();
    if (!photo) throw new HttpError(404, "Not found");
    if (typeof photo.imageUrl === "string" && photo.imageUrl.startsWith("https://")) {
      res.redirect(302, photo.imageUrl);
      return;
    }
    const data = typeof photo.imageData === "string" ? photo.imageData : "";
    if (!data.startsWith("data:")) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="100%" height="100%" fill="#0F2A44"/><text x="50%" y="50%" fill="white" font-size="24" font-family="sans-serif" text-anchor="middle">${escapeXml(photo.chip || "Photo")}</text></svg>`;
      res.type("image/svg+xml").send(svg);
      return;
    }
    const comma = data.indexOf(",");
    const meta = data.slice(0, comma);
    const body = data.slice(comma + 1);
    const mime = /data:([^;]+)/.exec(meta)?.[1] || "application/octet-stream";
    res.setHeader("Cache-Control", "public, max-age=86400");
    if (meta.includes("base64")) {
      res.type(mime).send(Buffer.from(body, "base64"));
      return;
    }
    res.type(mime).send(decodeURIComponent(body));
  }),
);

router.patch(
  "/api/documents/:id",
  asyncRoute(async (req, res) => {
    const result = await DocumentRequest.findByIdAndUpdate(
      req.params.id,
      { $set: { requested: Boolean(req.body.requested) } },
      { new: true },
    ).lean<{ _id: string }>();
    if (!result) throw new HttpError(404, "Document request not found");
    res.json(publicId(result));
  }),
);

router.get(
  "/api/settings",
  requireAuth,
  asyncRoute(async (req, res) => {
    res.json(await settingsForUser((req as AuthedRequest).userId));
  }),
);

router.patch(
  "/api/settings",
  requireAuth,
  asyncRoute(async (req, res) => {
    const userId = (req as AuthedRequest).userId;
    const user = await User.findById(userId).select("name preferences").lean<{ name?: string; preferences?: Partial<UserPreferences> }>();
    if (!user) throw new HttpError(404, "User not found");

    const preferences = preferencesFor(user.preferences);
    if (typeof req.body.license === "string") preferences.license = req.body.license;
    if (typeof req.body.defaultCarrier === "string") preferences.defaultCarrier = req.body.defaultCarrier;
    if (typeof req.body.iptc === "boolean") preferences.iptc = req.body.iptc;
    if (typeof req.body.wifiSync === "boolean") preferences.wifiSync = req.body.wifiSync;
    if (typeof req.body.cellSync === "boolean") preferences.cellSync = req.body.cellSync;
    if (typeof req.body.voiceNotesInExport === "boolean") preferences.voiceNotesInExport = req.body.voiceNotesInExport;
    const update: Record<string, unknown> = { preferences, updatedAt: new Date().toISOString() };
    if (typeof req.body.name === "string") update.name = req.body.name.trim();
    await User.updateOne({ _id: userId }, { $set: update });
    res.json(await settingsForUser(userId));
  }),
);

router.post(
  "/api/seed",
  asyncRoute(async (_req, res) => {
    await resetSeed();
    res.json({ ok: true });
  }),
);

type UserPreferences = {
  license: string;
  defaultCarrier: string;
  iptc: boolean;
  wifiSync: boolean;
  cellSync: boolean;
  voiceNotesInExport: boolean;
};

function preferencesFor(value?: Partial<UserPreferences> | null): UserPreferences {
  return {
    license: typeof value?.license === "string" ? value.license : "",
    defaultCarrier: typeof value?.defaultCarrier === "string" ? value.defaultCarrier : "",
    iptc: typeof value?.iptc === "boolean" ? value.iptc : true,
    wifiSync: typeof value?.wifiSync === "boolean" ? value.wifiSync : true,
    cellSync: typeof value?.cellSync === "boolean" ? value.cellSync : false,
    voiceNotesInExport: typeof value?.voiceNotesInExport === "boolean" ? value.voiceNotesInExport : false,
  };
}

async function settingsForUser(userId: string) {
  const user = await User.findById(userId).select("name isGuest preferences").lean<{
    name?: string;
    isGuest?: boolean;
    preferences?: Partial<UserPreferences>;
  }>();
  if (!user) throw new HttpError(404, "User not found");

  const preferences = preferencesFor(user.preferences);
  const stored = user.preferences;
  const complete = stored && (Object.keys(preferences) as (keyof UserPreferences)[]).every((key) => stored[key] === preferences[key]);
  if (!complete) await User.updateOne({ _id: userId }, { $set: { preferences } });

  const usage = await usageForUser(userId, Boolean(user.isGuest));
  return { id: userId, name: user.name || "", ...preferences, ...usage };
}

async function usageForUser(userId: string, isGuest: boolean) {
  const filter = isGuest ? { $or: [{ demo: true }, { ownerId: userId }] } : { ownerId: userId };
  const claimIds = await Claim.find(filter).distinct("_id");
  if (!claimIds.length) return { storageUsedGb: 0, softDeleted: 0 };

  const [softDeleted, stored] = await Promise.all([
    Photo.countDocuments({ claimId: { $in: claimIds }, deletedAt: { $type: "string", $ne: "" } }),
    Photo.aggregate<{ bytes?: number }>([
      {
        $match: {
          claimId: { $in: claimIds },
          $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }, { deletedAt: "" }],
        },
      },
      { $group: { _id: null, bytes: { $sum: { $strLenBytes: { $ifNull: ["$imageData", ""] } } } } },
    ]),
  ]);
  const bytes = stored[0]?.bytes ?? 0;
  return { storageUsedGb: Math.round((bytes / 1_000_000_000) * 10) / 10, softDeleted };
}

function textField(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

/** JSON body fields, with query-string fallbacks for a raw image upload. */
function photoFields(req: Request) {
  const json =
    !Buffer.isBuffer(req.body) && req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  const str = (key: string) => (typeof json[key] === "string" ? (json[key] as string) : textField(req.query[key]));
  return {
    chip: str("chip"),
    roomId: str("roomId"),
    caption: str("caption"),
    captionCode: str("captionCode"),
    damageCategory: str("damageCategory"),
    lkq: str("lkq"),
    kind: str("kind"),
    inspection: str("inspection"),
    voiceNote: json.voiceNote,
    gps: json.gps,
  };
}

/** Image as a data URI, whether the client sent raw bytes or a JSON data URI. */
function photoBytes(req: Request): string {
  if (Buffer.isBuffer(req.body) && req.body.length) {
    const mime = String(req.headers["content-type"] || "image/jpeg").split(";")[0].trim() || "image/jpeg";
    return `data:${mime};base64,${req.body.toString("base64")}`;
  }
  const json = req.body as { imageData?: unknown } | undefined;
  return typeof json?.imageData === "string" ? json.imageData : "";
}

function defaultCaption(chip: string, captionCode?: string) {
  if (/no damage observed/i.test(chip)) return "No damage observed.";
  if (captionCode) return `${chip} — ${captionCode}. Field documentation only; no coverage determination.`;
  return chip;
}

function numberOr(value: unknown, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : fallback;
}

/** Validates LiDAR-measured regions from the client; drops anything malformed. */
function parseRegions(value: unknown): ScanRegion[] {
  if (!Array.isArray(value)) return [];
  const out: ScanRegion[] = [];
  for (const item of value.slice(0, 50)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const widthFt = numberOr(r.widthFt, 0);
    const heightFt = numberOr(r.heightFt, 0);
    if (!widthFt || !heightFt) continue;
    out.push({
      label: typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 80) : `Area ${out.length + 1}`,
      widthFt,
      heightFt,
      areaSqFt: numberOr(r.areaSqFt, Math.round(widthFt * heightFt * 10) / 10),
      depthFt: numberOr(r.depthFt, 0),
    });
  }
  return out;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
