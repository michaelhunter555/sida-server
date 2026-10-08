import mongoose, { Schema } from "mongoose";

const opts = { versionKey: false as const };

const preferenceSchema = new Schema(
  {
    license: { type: String, default: "" },
    defaultCarrier: { type: String, default: "" },
    iptc: { type: Boolean, default: true },
    wifiSync: { type: Boolean, default: true },
    cellSync: { type: Boolean, default: false },
    voiceNotesInExport: { type: Boolean, default: false },
  },
  { _id: false, versionKey: false },
);

const userSchema = new Schema(
  {
    _id: { type: String, required: true },
    name: String,
    email: { type: String, unique: true, index: true },
    passwordHash: { type: String, select: false },
    appleId: String,
    googleId: String,
    imagePath: String,
    isGuest: Boolean,
    loginMethod: String,
    claims: [mongoose.Schema.Types.ObjectId],
    emailVerified: Boolean,
    pushToken: String,
    timeZone: String,
    membershipPlan: String,
    trialStartDate: String,
    trialEndDate: String,
    lastChargeDate: String,
    nextChargeDate: String,
    preferences: {
      type: preferenceSchema,
      default: () => ({
        license: "",
        defaultCarrier: "",
        iptc: true,
        wifiSync: true,
        cellSync: false,
        voiceNotesInExport: false,
      }),
    },
    currentRefreshJti: { type: String, select: false },
    currentRefreshExpiresAt: { type: String, select: false },
    updatedAt: String,
  },
  opts,
);

const claimSchema = new Schema(
  {
    _id: { type: String, required: true },
    claimNumber: String,
    insuredName: String,
    dateOfLoss: String,
    riskAddress: String,
    carrier: String,
    claimType: String,
    syncStatus: String,
    triggers: [String],
    policeReport: String,
    inspectionCount: Number,
    demo: Boolean,
    ownerId: { type: String, index: true },
    createdAt: String,
    updatedAt: String,
  },
  opts,
);

const roomSchema = new Schema(
  {
    _id: { type: String, required: true },
    claimId: { type: String, index: true },
    name: String,
    section: String,
    lossRole: String,
    triggers: [String],
    iicrcCategory: Number,
    iicrcClass: Number,
    scopeNote: String,
    slopeCode: String,
    hitCount: Number,
    windCount: Number,
    pitch: String,
    measurements: {
      lengthFt: Number,
      widthFt: Number,
      heightFt: Number,
      areaSqFt: Number,
      source: String,
    },
  },
  opts,
);

const photoSchema = new Schema(
  {
    _id: { type: String, required: true },
    claimId: { type: String, index: true },
    roomId: String,
    chip: String,
    captionCode: String,
    caption: String,
    damageCategory: String,
    lkq: String,
    kind: String,
    hasImage: Boolean,
    imageUrl: String,
    cloudinaryPublicId: String,
    imageData: String,
    voiceNote: {
      duration: String,
      transcript: String,
      audioData: String,
    },
    iptcHeadline: String,
    iptcWritten: Boolean,
    gps: { lat: Number, lng: Number },
    capturedAt: String,
    syncStatus: String,
    inspection: String,
    deletedAt: String,
  },
  opts,
);

const readingSchema = new Schema(
  {
    _id: { type: String, required: true },
    roomId: { type: String, index: true },
    claimId: { type: String, index: true },
    location: String,
    value: Number,
    unit: String,
    instrument: String,
    createdAt: String,
  },
  opts,
);

const documentSchema = new Schema(
  {
    _id: { type: String, required: true },
    claimId: { type: String, index: true },
    label: String,
    requested: Boolean,
    email: String,
  },
  opts,
);

const limitationSchema = new Schema(
  {
    _id: { type: String, required: true },
    claimId: { type: String, index: true },
    key: String,
    label: String,
    reason: String,
    createdAt: String,
  },
  opts,
);

const scanSchema = new Schema(
  {
    _id: { type: String, required: true },
    roomId: { type: String, index: true },
    claimId: { type: String, index: true },
    points: [[Number]],
    pointCount: Number,
    lengthFt: Number,
    widthFt: Number,
    heightFt: Number,
    areaSqFt: Number,
    floorOk: Boolean,
    ceilingOk: Boolean,
    wallsOk: Boolean,
    source: String,
    regions: {
      type: [
        new Schema(
          { label: String, widthFt: Number, heightFt: Number, areaSqFt: Number, depthFt: Number },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    unitNote: String,
    createdAt: String,
  },
  opts,
);

export const Claim = mongoose.model("Claim", claimSchema, "claims");
export const Room = mongoose.model("Room", roomSchema, "rooms");
export const Photo = mongoose.model("Photo", photoSchema, "photos");
export const Reading = mongoose.model("Reading", readingSchema, "readings");
export const DocumentRequest = mongoose.model("DocumentRequest", documentSchema, "documents");
export const Limitation = mongoose.model("Limitation", limitationSchema, "limitations");
export const Scan = mongoose.model("Scan", scanSchema, "scans");
export const User = mongoose.model("User", userSchema, "users");

export function publicId<T extends { _id: string }>(doc: T) {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}
