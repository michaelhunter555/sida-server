/** Room-scale point cloud helpers.
 *  Potree's octree is for campus-sized clouds. A single room is an in-memory
 *  cloud with Potree-style elevation coloring, and area is the floor footprint.
 */

export type Vec3 = [number, number, number];

export const FT_TO_M = 0.3048;

export interface RoomEstimate {
  lengthFt: number;
  widthFt: number;
  heightFt: number;
  areaSqFt: number;
  pointCount: number;
  floorCount: number;
  ceilCount: number;
  wallCount: number;
  floorOk: boolean;
  ceilingOk: boolean;
  wallsOk: boolean;
}

export interface RoomPreset {
  lengthFt: number;
  widthFt: number;
  heightFt: number;
}

export const ROOM_PRESETS: Record<string, RoomPreset> = {
  Kitchen: { lengthFt: 14.25, widthFt: 11.68, heightFt: 8.0833 },
  "Dining Room": { lengthFt: 12.5, widthFt: 10.25, heightFt: 8.0833 },
  Basement: { lengthFt: 22, widthFt: 14, heightFt: 7.5 },
  "Living Room": { lengthFt: 16, widthFt: 13, heightFt: 8.0833 },
  Bathroom: { lengthFt: 8, widthFt: 5, heightFt: 8 },
};

export function presetForRoom(name: string): RoomPreset {
  if (ROOM_PRESETS[name]) return ROOM_PRESETS[name];
  let hash = 0;
  for (const ch of name) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  const lengthFt = 10 + (hash % 80) / 10;
  const widthFt = 8 + ((hash >> 3) % 50) / 10;
  const heightFt = 8;
  return {
    lengthFt: Math.round(lengthFt * 100) / 100,
    widthFt: Math.round(widthFt * 100) / 100,
    heightFt,
  };
}

function axis(max: number, step: number): number[] {
  const values: number[] = [];
  for (let v = 0; v < max - 1e-6; v += step) values.push(Math.round(v * 1000) / 1000);
  values.push(Math.round(max * 1000) / 1000);
  return values;
}

/** Surface cloud of a rectangular room, in meters, Z up. Endpoints are exact so the footprint round-trips to feet. */
export function generateRoomCloud(lengthFt: number, widthFt: number, heightFt: number, stepM = 0.16): Vec3[] {
  const lengthM = lengthFt * FT_TO_M;
  const widthM = widthFt * FT_TO_M;
  const heightM = heightFt * FT_TO_M;
  const xs = axis(lengthM, stepM);
  const ys = axis(widthM, stepM);
  const zs = axis(heightM, stepM);
  const pts: Vec3[] = [];
  const doorW = Math.min(0.9, lengthM * 0.35);
  const doorH = Math.min(2.05, heightM * 0.85);
  const doorX0 = lengthM / 2 - doorW / 2;

  for (const x of xs) {
    for (const y of ys) {
      pts.push([x, y, 0]);
      pts.push([x, y, heightM]);
    }
  }
  for (const x of xs) {
    for (const z of zs) {
      const inDoor = x > doorX0 && x < doorX0 + doorW && z < doorH;
      if (!inDoor) pts.push([x, 0, z]);
      pts.push([x, widthM, z]);
    }
  }
  for (const y of ys) {
    for (const z of zs) {
      pts.push([0, y, z]);
      pts.push([lengthM, y, z]);
    }
  }
  return pts;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function estimateFromPoints(points: Vec3[]): RoomEstimate {
  if (points.length < 8) {
    throw new Error("Need at least 8 points to estimate the room.");
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const [x, y, z] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const lengthM = maxX - minX;
  const widthM = maxY - minY;
  const heightM = maxZ - minZ;
  const longM = Math.max(lengthM, widthM);
  const shortM = Math.min(lengthM, widthM);
  const lengthFt = round(longM / FT_TO_M, 2);
  const widthFt = round(shortM / FT_TO_M, 2);
  const heightFt = round(heightM / FT_TO_M, 2);
  const areaSqFt = round(lengthFt * widthFt, 1);
  const zCut = Math.max(heightM * 0.08, 0.05);
  let floorCount = 0;
  let ceilCount = 0;
  for (const [, , z] of points) {
    if (z <= minZ + zCut) floorCount += 1;
    else if (z >= maxZ - zCut) ceilCount += 1;
  }
  const wallCount = points.length - floorCount - ceilCount;
  return {
    lengthFt,
    widthFt,
    heightFt,
    areaSqFt,
    pointCount: points.length,
    floorCount,
    ceilCount,
    wallCount,
    floorOk: floorCount > 20,
    ceilingOk: ceilCount > 20,
    wallsOk: wallCount > 40,
  };
}

export type LengthUnit = "m" | "ft" | "mm";

export function scalePoints(points: Vec3[], unit: LengthUnit): Vec3[] {
  const factor = unit === "mm" ? 0.001 : unit === "ft" ? FT_TO_M : 1;
  if (factor === 1) return points;
  return points.map(([x, y, z]) => [x * factor, y * factor, z * factor]);
}

export function downsample(points: Vec3[], max = 6000): Vec3[] {
  if (points.length <= max) return points;
  const stride = Math.ceil(points.length / max);
  const out: Vec3[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  return out;
}

export function parsePointText(text: string): Vec3[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  if (lines[0].toLowerCase() === "ply") {
    let count = Infinity;
    let start = 0;
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].toLowerCase().startsWith("element vertex")) {
        count = Number(lines[i].split(/\s+/)[2]);
      }
      if (lines[i].toLowerCase() === "end_header") {
        start = i + 1;
        break;
      }
    }
    const pts: Vec3[] = [];
    for (let i = start; i < lines.length && pts.length < count; i += 1) {
      const parts = lines[i].split(/\s+/).map(Number);
      if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
        pts.push([parts[0], parts[1], parts[2]]);
      }
    }
    return pts;
  }

  const pts: Vec3[] = [];
  for (const line of lines) {
    if (line.startsWith("#") || (/^[a-z]/i.test(line) && line.toLowerCase().includes("x"))) continue;
    const parts = line.split(/[\s,;]+/).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      pts.push([parts[0], parts[1], parts[2]]);
    }
  }
  return pts;
}

export function roundPoints(points: Vec3[]): Vec3[] {
  return points.map(([x, y, z]) => [
    Math.round(x * 1000) / 1000,
    Math.round(y * 1000) / 1000,
    Math.round(z * 1000) / 1000,
  ]);
}
