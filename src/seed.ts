import { DOCUMENT_EMAIL } from "./lib/matrix";
import { estimateFromPoints, generateRoomCloud, presetForRoom, roundPoints } from "./lib/estimate";
import { Claim, DocumentRequest, Limitation, Photo, Reading, Room, Scan } from "./models";

function id(prefix: string, n: string) {
  return `${prefix}_${n}`;
}

function swatch(label: string, hue: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue} 42% 32%)"/>
        <stop offset="1" stop-color="hsl(${(hue + 28) % 360} 48% 18%)"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="36" y="36" width="568" height="408" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="3"/>
    <text x="50%" y="46%" fill="white" font-size="28" font-family="sans-serif" text-anchor="middle">${escapeXml(label)}</text>
    <text x="50%" y="56%" fill="rgba(255,255,255,0.75)" font-size="16" font-family="sans-serif" text-anchor="middle">SIDA field photo</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

interface PhotoSeed {
  id: string;
  claimId: string;
  roomId: string | null;
  chip: string;
  caption: string;
  kind?: "standard" | "thermal" | "video";
  captionCode?: "BLEMISHES" | "WIND" | "NWR" | "CONTRACTOR" | "UNKNOWN";
  hue: number;
  inspection?: "initial" | "supplement";
  syncStatus?: "synced" | "pending" | "local";
  voice?: string;
}

const DEMO_CLAIM_IDS = ["clm_davies", "clm_rodriguez", "clm_chen"];

export async function ensureSeed() {
  if ((await Claim.countDocuments()) === 0) {
    await seed();
    return;
  }
  await Claim.updateMany({ _id: { $in: DEMO_CLAIM_IDS } }, { $set: { demo: true } });
}

export async function resetSeed() {
  await Promise.all([
    Claim.deleteMany({}),
    Room.deleteMany({}),
    Photo.deleteMany({}),
    Reading.deleteMany({}),
    DocumentRequest.deleteMany({}),
    Limitation.deleteMany({}),
    Scan.deleteMany({}),
  ]);
  await seed();
}

async function seed() {
  const davies = id("clm", "davies");
  const rodriguez = id("clm", "rodriguez");
  const chen = id("clm", "chen");

  const rooms = [
    room(davies, "front", "Front Elevation", "exterior"),
    room(davies, "right", "Right Elevation", "exterior"),
    room(davies, "rear", "Rear Elevation", "exterior"),
    room(davies, "left", "Left Elevation", "exterior"),
    room(davies, "kitchen", "Kitchen", "interior", {
      lossRole: "Origin",
      triggers: ["Cabinets Affected", "Flooring Affected", "Equipment Involved"],
      iicrcCategory: 1,
      iicrcClass: 2,
      scopeNote:
        "Kitchen — IICRC Category 1, Class 2. Supply line leak in the ceiling from the upper level. Affected materials: ceiling drywall opened at the plumbing, upper cabinets, base cabinet toe kick. Dry benchmark 12% WME; affected readings 31–38% WME. Thermal images show moisture beyond the visible damage. LKQ: match the existing maple cabinet finish.",
    }),
    room(davies, "dining", "Dining Room", "interior", {
      lossRole: "Affected",
      triggers: ["Flooring Affected"],
      iicrcCategory: 1,
      scopeNote: "Dining room flooring is wet along the kitchen threshold. Class is not selected yet, and there are no moisture readings.",
    }),
    room(davies, "basement", "Basement", "interior", {
      lossRole: "Path",
      triggers: [],
      scopeNote: "Path of loss continues to the basement ceiling under the kitchen.",
    }),
    room(rodriguez, "front", "Front Elevation", "exterior"),
    room(rodriguez, "right", "Right Elevation", "exterior"),
    room(rodriguez, "rear", "Rear Elevation", "exterior"),
    room(rodriguez, "left", "Left Elevation", "exterior"),
    room(rodriguez, "sf", "Front Slope", "roof", { slopeCode: "F", hitCount: 10, windCount: 6 }),
    room(rodriguez, "sr", "Right Slope", "roof", { slopeCode: "R", hitCount: 4, windCount: 2 }),
    room(rodriguez, "sb", "Back Slope", "roof", { slopeCode: "B" }),
    room(rodriguez, "sl", "Left Slope", "roof", { slopeCode: "L" }),
    room(chen, "front", "Front Elevation", "exterior"),
    room(chen, "living", "Living Room", "interior", { lossRole: "Origin" }),
  ];

  const photos: PhotoSeed[] = [
    photo(davies, "front", "p1", "Risk Front Photo", "Risk front photo. Full front elevation of the risk.", 210),
    photo(davies, "front", "p2", "Address Verification", "Address numerals visible at the risk.", 220),
    photo(davies, "front", "p3", "No Damage Observed — Elevation", "Front elevation. No damage observed.", 200),
    photo(davies, "front", "p4", "Front-Right Corner", "Front-right corner of the risk.", 215),
    photo(davies, "right", "p1", "Right Elevation Overview", "Right elevation overview.", 230),
    photo(davies, "right", "p2", "No Damage Observed — Elevation", "Right elevation. No damage observed.", 225),
    photo(davies, "right", "p3", "Rear-Right Corner", "Rear-right corner of the risk.", 228),
    photo(davies, "rear", "p1", "Rear Elevation Overview", "Rear elevation overview.", 240),
    photo(davies, "rear", "p2", "Damage Overview — Elevation", "Rear elevation damage overview at the hose bib.", 12),
    photo(davies, "rear", "p3", "Rear-Left Corner", "Rear-left corner of the risk.", 235),
    photo(davies, "left", "p1", "Left Elevation Overview", "Left elevation overview.", 250),
    photo(davies, "left", "p2", "Front-Left Corner", "Front-left corner of the risk.", 248),
    photo(davies, "kitchen", "c1", "Cabinet Overview", "Cabinet run overview, doors closed.", 28),
    photo(davies, "kitchen", "c2", "Cabinet End Panel — Left", "End panel and toe kick.", 32),
    photo(davies, "kitchen", "c3", "Cabinet Interior (Doors / Drawers Open)", "Interior of the sink base.", 36),
    photo(davies, "kitchen", "c4", "Countertop / Backsplash", "LKQ finish sample on the upper door.", 40),
    photo(davies, "kitchen", "d1", "Damage Close-Up", "Ceiling penetration at the supply lines.", 18, {
      captionCode: "CONTRACTOR",
      voice: "Ceiling is open at the kitchen. Source is the upstairs bathroom supply. Slow leak, soft joists, cabinet damage below.",
    }),
    photo(davies, "kitchen", "d2", "Source Relationship Photo", "Supply and drain visible through the ceiling opening.", 16),
    photo(davies, "kitchen", "t1", "Ceiling Overview", "Thermal pattern across the kitchen ceiling.", 16, { kind: "thermal" }),
    photo(davies, "kitchen", "t2", "Ceiling Overview", "Thermal pattern at the sink wall.", 20, { kind: "thermal" }),
    photo(davies, "dining", "d1", "Room Overview — 4 Corners", "Dining room from the kitchen doorway.", 200),
    photo(davies, "dining", "d2", "Damage Overview — Mid-Range", "Wet flooring at the threshold.", 190),
    photo(davies, "dining", "d3", "Like Kind and Quality (LKQ) Reference", "Flooring material for LKQ.", 180, { inspection: "supplement" }),
    photo(davies, "basement", "b1", "Ceiling Overview", "Basement ceiling under the kitchen.", 260),
    photo(davies, "basement", "b2", "Damage Overview — Mid-Range", "Staining on the basement ceiling.", 8, { syncStatus: "pending" }),
    photo(davies, null, "u1", "Damage Overview — Mid-Range", "Untagged — boarded side door.", 0, { syncStatus: "pending" }),
    photo(rodriguez, "front", "p1", "Risk Front Photo", "Risk front photo.", 220, { syncStatus: "synced" }),
    photo(rodriguez, "front", "p2", "Address Verification", "Address verification.", 222, { syncStatus: "synced" }),
    photo(rodriguez, "front", "p3", "No Damage Observed — Elevation", "Front elevation. No damage observed.", 224, { syncStatus: "synced" }),
    photo(rodriguez, "front", "p4", "Front-Right Corner", "Front-right corner.", 226, { syncStatus: "synced" }),
    photo(rodriguez, "right", "p1", "No Damage Observed — Elevation", "Right elevation. No damage observed.", 230, { syncStatus: "synced" }),
    photo(rodriguez, "right", "p2", "Rear-Right Corner", "Rear-right corner.", 232, { syncStatus: "synced" }),
    photo(rodriguez, "rear", "p1", "No Damage Observed — Elevation", "Rear elevation. No damage observed.", 240, { syncStatus: "synced" }),
    photo(rodriguez, "rear", "p2", "Rear-Left Corner", "Rear-left corner.", 242, { syncStatus: "synced" }),
    photo(rodriguez, "left", "p1", "No Damage Observed — Elevation", "Left elevation. No damage observed.", 250, { syncStatus: "synced" }),
    photo(rodriguez, "left", "p2", "Front-Left Corner", "Front-left corner.", 252, { syncStatus: "synced" }),
    photo(rodriguez, "sf", "p1", "Front Slope (F) Overview", "Front slope. Blemishes circled. F=10 and F=6W.", 270, {
      captionCode: "BLEMISHES",
      syncStatus: "synced",
    }),
    photo(rodriguez, "sr", "p1", "Right Slope (R) Overview", "Right slope.", 280, { captionCode: "WIND", syncStatus: "synced" }),
    photo(chen, "front", "p1", "Front Elevation Overview", "Front elevation, smoke at the eaves.", 8, { syncStatus: "local" }),
    photo(chen, "living", "p1", "Fire Origin Area", "Living room origin at the receptacle.", 12, { syncStatus: "local" }),
  ];

  await Claim.insertMany([
    {
      _id: davies,
      claimNumber: "BH01750148",
      insuredName: "Davies, NCC",
      dateOfLoss: "2025-06-10",
      riskAddress: "4242 Woodcock Drive #230, San Antonio TX",
      carrier: "Shellpoint Mortgage",
      claimType: "water_plumbing",
      syncStatus: "pending",
      triggers: ["Cabinets Affected", "Flooring Affected", "Equipment Involved"],
      inspectionCount: 2,
      demo: true,
      createdAt: hoursAgo(30),
      updatedAt: hoursAgo(2),
    },
    {
      _id: rodriguez,
      claimNumber: "CLM-2024-002",
      insuredName: "Rodriguez, Maria",
      dateOfLoss: "2025-05-02",
      riskAddress: "447 Ocean Pkwy, Queens NY",
      carrier: "Shellpoint Mortgage",
      claimType: "wind_hail",
      syncStatus: "synced",
      triggers: [],
      inspectionCount: 1,
      demo: true,
      createdAt: hoursAgo(50),
      updatedAt: hoursAgo(26),
    },
    {
      _id: chen,
      claimNumber: "CLM-2024-003",
      insuredName: "Chen, Wei",
      dateOfLoss: "2025-04-18",
      riskAddress: "892 Bedford Ave, Brooklyn NY",
      carrier: "Shellpoint Mortgage",
      claimType: "fire",
      syncStatus: "local",
      triggers: [],
      inspectionCount: 1,
      demo: true,
      createdAt: hoursAgo(80),
      updatedAt: hoursAgo(72),
    },
  ]);

  await Room.insertMany(rooms);

  await Photo.insertMany(
    photos.map((item, index) => ({
      _id: item.id,
      claimId: item.claimId,
      roomId: item.roomId,
      chip: item.chip,
      captionCode: item.captionCode,
      caption: item.caption,
      kind: item.kind ?? "standard",
      hasImage: true,
      imageData: swatch(item.chip, item.hue),
      voiceNote: item.voice ? { duration: "0:14", transcript: item.voice } : undefined,
      iptcHeadline: item.chip,
      iptcWritten: true,
      gps: { lat: 29.508, lng: -98.497 },
      capturedAt: hoursAgo(3 - index * 0.02),
      syncStatus: item.syncStatus ?? (item.claimId === davies ? "synced" : "pending"),
      inspection: item.inspection ?? "initial",
      deletedAt: null,
    })),
  );

  await Reading.insertMany([
    reading(davies, "kitchen", "m1", "Dry benchmark (unaffected wall)", 12, "WME"),
    reading(davies, "kitchen", "m2", "Under sink cabinet", 38, "WME"),
    reading(davies, "kitchen", "m3", "Baseboard near dishwasher", 31, "WME"),
  ]);

  await DocumentRequest.insertMany([
    {
      _id: id("doc", "davies_invoice"),
      claimId: davies,
      label: "Plumbing invoice",
      requested: false,
      email: DOCUMENT_EMAIL,
    },
  ]);

  const kitchenPreset = presetForRoom("Kitchen");
  const diningPreset = presetForRoom("Dining Room");
  const kitchenPoints = roundPoints(generateRoomCloud(kitchenPreset.lengthFt, kitchenPreset.widthFt, kitchenPreset.heightFt));
  const diningPoints = roundPoints(generateRoomCloud(diningPreset.lengthFt, diningPreset.widthFt, diningPreset.heightFt));
  const kitchenEstimate = estimateFromPoints(kitchenPoints);
  const diningEstimate = estimateFromPoints(diningPoints);

  await Scan.insertMany([
    scanDoc(davies, "kitchen", kitchenPoints, kitchenEstimate),
    scanDoc(davies, "dining", diningPoints, diningEstimate),
  ]);

  await Room.updateOne(
    { _id: id("room", "davies_kitchen") },
    { $set: { measurements: measurementsFrom(kitchenEstimate) } },
  );
  await Room.updateOne(
    { _id: id("room", "davies_dining") },
    { $set: { measurements: measurementsFrom(diningEstimate) } },
  );

}

function room(
  claimKey: string,
  key: string,
  name: string,
  section: "exterior" | "roof" | "interior",
  extra: Record<string, unknown> = {},
) {
  return {
    _id: id("room", `${claimKey.split("_")[1]}_${key}`),
    claimId: claimKey,
    name,
    section,
    triggers: [] as string[],
    ...extra,
  };
}

function photo(
  claimId: string,
  roomKey: string | null,
  key: string,
  chip: string,
  caption: string,
  hue: number,
  extra: Partial<PhotoSeed> = {},
): PhotoSeed {
  const claimShort = claimId.split("_")[1];
  return {
    id: id("photo", `${claimShort}_${roomKey || "untagged"}_${key}`),
    claimId,
    roomId: roomKey ? id("room", `${claimShort}_${roomKey}`) : null,
    chip,
    caption,
    hue,
    ...extra,
  };
}

function reading(claimId: string, roomKey: string, key: string, location: string, value: number, unit: string) {
  const claimShort = claimId.split("_")[1];
  return {
    _id: id("rd", `${claimShort}_${key}`),
    claimId,
    roomId: id("room", `${claimShort}_${roomKey}`),
    location,
    value,
    unit,
    instrument: "Delmhorst BD-2100",
    createdAt: hoursAgo(2),
  };
}

function measurementsFrom(estimate: { lengthFt: number; widthFt: number; heightFt: number; areaSqFt: number }) {
  return {
    lengthFt: estimate.lengthFt,
    widthFt: estimate.widthFt,
    heightFt: estimate.heightFt,
    areaSqFt: estimate.areaSqFt,
    source: "scan" as const,
  };
}

function scanDoc(
  claimId: string,
  roomKey: string,
  points: number[][],
  estimate: ReturnType<typeof estimateFromPoints>,
) {
  const claimShort = claimId.split("_")[1];
  return {
    _id: id("scan", `${claimShort}_${roomKey}`),
    claimId,
    roomId: id("room", `${claimShort}_${roomKey}`),
    points,
    pointCount: estimate.pointCount,
    lengthFt: estimate.lengthFt,
    widthFt: estimate.widthFt,
    heightFt: estimate.heightFt,
    areaSqFt: estimate.areaSqFt,
    floorOk: estimate.floorOk,
    ceilingOk: estimate.ceilingOk,
    wallsOk: estimate.wallsOk,
    source: "generated",
    createdAt: hoursAgo(2),
  };
}
