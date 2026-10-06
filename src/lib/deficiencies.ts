import { chipLabel, slopeOverviewChip } from "./chip-sets";
import { claimMeta } from "./matrix";
import type { Bundle, DeficiencyReport, Issue, Photo, Room } from "./types";

// Chip labels come from the requirements matrix (Actions Master) so a rename there only touches chip-sets.ts.
const RISK_FRONT = chipLabel("UNIV.002");
const ADDRESS = chipLabel("UNIV.001");
const CORNERS = ["EXT.005", "EXT.006", "EXT.007", "EXT.008"].map(chipLabel);
const ELEVATION_OK = ["EXT.011", "EXT.010", "EXT.009"].map(chipLabel);
const NO_DAMAGE_ELEVATION = chipLabel("EXT.011");
const SERIAL_TAG = chipLabel("COND.EQ.002");
const CABINET_CHIPS = new Set(["COND.CAB.001", "COND.CAB.002", "COND.CAB.003", "COND.CAB.004", "COND.CAB.005", "COND.CAB.006", "COND.CAB.007", "COND.CAB.008"].map(chipLabel));
const FIRE_REQUIRED = ["INT.021", "INT.019", "INT.020"].map(chipLabel);
const TREE_SIDING = chipLabel("EXT.012");
const TEST_SQUARE = chipLabel("ROOF.016");
const COLLATERAL = chipLabel("ROOF.019");
const ATTIC = chipLabel("ROOF.024");

function livePhotos(photos: Photo[]): Photo[] {
  return photos.filter((photo) => !photo.deletedAt);
}

function hasChip(photos: Photo[], chip: string, roomId?: string): boolean {
  return photos.some((photo) => photo.chip === chip && (roomId ? photo.roomId === roomId : true));
}

export function buildDeficiencies(bundle: Omit<Bundle, "deficiencies">): DeficiencyReport {
  const photos = livePhotos(bundle.photos);
  const meta = claimMeta(bundle.claim.claimType);
  const limited = new Set(bundle.limitations.map((item) => item.key));
  const issues: Issue[] = [];
  const passing: string[] = [];
  const claimId = bundle.claim.id;

  const add = (issue: Issue) => {
    if (!limited.has(issue.key)) issues.push(issue);
  };

  if (!hasChip(photos, RISK_FRONT)) {
    add({
      key: "risk-front",
      group: "photos",
      text: `${RISK_FRONT} is missing`,
      href: `/claims/${claimId}/capture?chip=${encodeURIComponent(RISK_FRONT)}`,
    });
  } else passing.push(`${RISK_FRONT} captured`);

  if (!hasChip(photos, ADDRESS)) {
    add({
      key: "address",
      group: "photos",
      text: `${ADDRESS} is missing`,
      href: `/claims/${claimId}/capture?chip=${encodeURIComponent(ADDRESS)}`,
    });
  } else passing.push(`${ADDRESS} captured`);

  const elevations = bundle.rooms.filter((room) => room.section === "exterior");
  const elevationGaps = elevations.filter(
    (room) => !photos.some((photo) => photo.roomId === room.id && ELEVATION_OK.includes(photo.chip)),
  );
  for (const room of elevationGaps) {
    add({
      key: `elev-${room.id}`,
      group: "photos",
      text: `${room.name} — No damage observed not captured`,
      href: `/claims/${claimId}/capture?room=${room.id}&chip=${encodeURIComponent(NO_DAMAGE_ELEVATION)}`,
    });
  }
  if (elevations.length >= 4 && elevationGaps.length === 0) {
    passing.push("All four exterior elevations documented");
  }

  const missingCorners = CORNERS.filter((chip) => !hasChip(photos, chip));
  if (missingCorners.length === 0 && elevations.length >= 4) passing.push("Four corners captured");
  for (const chip of missingCorners) {
    add({
      key: `corner-${chip}`,
      group: "photos",
      text: `${chip} not captured`,
      href: `/claims/${claimId}/capture?chip=${encodeURIComponent(chip)}`,
    });
  }

  if (meta.water) {
    const documented = bundle.rooms.filter(
      (room) => room.section === "interior" && (room.lossRole === "Origin" || room.lossRole === "Affected"),
    );
    for (const room of documented) {
      checkWaterRoom(bundle, room, photos, add, passing);
    }
  }

  const equipment =
    bundle.claim.triggers.includes("Equipment Involved") ||
    bundle.rooms.some((room) => room.triggers.includes("Equipment Involved"));
  if (equipment && meta.water) {
    if (!hasChip(photos, SERIAL_TAG)) {
      const origin = bundle.rooms.find((room) => room.lossRole === "Origin");
      add({
        key: "serial-tag",
        group: "hard",
        text: `${origin?.name ?? "Equipment"} — ${SERIAL_TAG} not captured`,
        href: `/claims/${claimId}/capture?room=${origin?.id ?? ""}&chip=${encodeURIComponent(SERIAL_TAG)}`,
      });
    } else passing.push("Equipment serial tag captured");
  }

  const cabinets =
    bundle.claim.triggers.includes("Cabinets Affected") ||
    bundle.rooms.some((room) => room.triggers.includes("Cabinets Affected"));
  if (cabinets) {
    // The matrix lists eight cabinetry captures; four distinct ones is the minimum sequence we accept.
    const captured = new Set(photos.filter((photo) => CABINET_CHIPS.has(photo.chip)).map((photo) => photo.chip));
    if (captured.size < 4) {
      add({
        key: "cabinets",
        group: "photos",
        text: "Cabinet damage sequence is incomplete",
        href: `/claims/${claimId}/capture?chip=${encodeURIComponent(chipLabel("COND.CAB.001"))}`,
      });
    } else passing.push("Cabinet damage sequence complete");
  }

  if (meta.roof) checkRoof(bundle, photos, add, passing);

  if (bundle.claim.claimType === "fire") {
    for (const chip of FIRE_REQUIRED) {
      if (!hasChip(photos, chip)) {
        add({
          key: `fire-${chip}`,
          group: "photos",
          text: `${chip} photo not captured`,
          href: `/claims/${claimId}/capture?chip=${encodeURIComponent(chip)}`,
        });
      }
    }
  }
  if (bundle.claim.claimType === "vandalism" && !bundle.claim.policeReport) {
    add({
      key: "police-report",
      group: "hard",
      text: "Police report number is missing",
      href: `/claims/${claimId}`,
    });
  }
  if (bundle.claim.claimType === "tree" && !hasChip(photos, TREE_SIDING)) {
    add({
      key: "impact",
      group: "photos",
      text: `${TREE_SIDING} (impact point) not captured`,
      href: `/claims/${claimId}/capture?chip=${encodeURIComponent(TREE_SIDING)}`,
    });
  }

  for (const doc of bundle.documents) {
    if (!doc.requested) {
      add({
        key: `doc-${doc.id}`,
        group: "documents",
        text: `${doc.label} — not yet requested`,
        href: `/claims/${claimId}/deficiencies`,
      });
    }
  }
  if (bundle.documents.some((doc) => doc.requested)) passing.push("Document requests sent");

  const thermal = photos.filter((photo) => photo.kind === "thermal").length;
  if (thermal > 0) passing.push(`Thermal images captured (${thermal})`);

  const scanned = bundle.scans
    .map((scan) => bundle.rooms.find((room) => room.id === scan.roomId)?.name)
    .filter(Boolean);
  if (scanned.length) passing.push(`Room estimates — ${scanned.join(", ")}`);

  const origin = bundle.rooms.find((room) => room.lossRole === "Origin");
  if (origin && photos.filter((photo) => photo.roomId === origin.id).length >= 4) {
    passing.push(`${origin.name} interior capture`);
  }

  return { issues, passing };
}

function checkWaterRoom(
  bundle: Omit<Bundle, "deficiencies">,
  room: Room,
  photos: Photo[],
  add: (issue: Issue) => void,
  passing: string[],
) {
  const claimId = bundle.claim.id;
  const readings = bundle.readings.filter((reading) => reading.roomId === room.id);
  if (!room.iicrcCategory || !room.iicrcClass) {
    const missing = !room.iicrcCategory && !room.iicrcClass ? "Category and Class" : !room.iicrcCategory ? "Category" : "Class";
    add({
      key: `iicrc-${room.id}`,
      group: "water",
      text: `${room.name} — IICRC ${missing} not selected`,
      href: `/claims/${claimId}/rooms/${room.id}`,
    });
  } else if (room.lossRole === "Origin") {
    passing.push(`${room.name} IICRC Cat ${room.iicrcCategory} / Class ${room.iicrcClass}`);
  }
  if (readings.length === 0) {
    add({
      key: `moisture-${room.id}`,
      group: "water",
      text: `${room.name} — moisture readings missing`,
      href: `/claims/${claimId}/rooms/${room.id}`,
    });
  } else if (room.lossRole === "Origin" && !readings.some((reading) => /benchmark|unaffected/i.test(reading.location))) {
    add({
      key: `benchmark-${room.id}`,
      group: "water",
      text: `${room.name} — dry benchmark reading missing`,
      href: `/claims/${claimId}/rooms/${room.id}`,
    });
  }
  if (photos.filter((photo) => photo.roomId === room.id).length === 0) {
    add({
      key: `room-photos-${room.id}`,
      group: "photos",
      text: `${room.name} — no photos`,
      href: `/claims/${claimId}/capture?room=${room.id}`,
    });
  }
}

function checkRoof(
  bundle: Omit<Bundle, "deficiencies">,
  photos: Photo[],
  add: (issue: Issue) => void,
  passing: string[],
) {
  const claimId = bundle.claim.id;
  const slopes = bundle.rooms.filter((room) => room.section === "roof");
  for (const room of slopes) {
    const chip = room.slopeCode ? slopeOverviewChip(room.slopeCode) : "";
    const covered = photos.some((photo) => photo.roomId === room.id || (chip && photo.chip === chip));
    if (!covered) {
      add({
        key: `slope-${room.id}`,
        group: "roof",
        text: `${room.name} slope not captured`,
        href: `/claims/${claimId}/capture?room=${room.id}&chip=${encodeURIComponent(chip)}`,
      });
    }
  }
  if (slopes.length >= 4 && slopes.every((room) => photos.some((photo) => photo.roomId === room.id))) {
    passing.push("Four roof slopes captured");
  }
  // Test square and chalk counts are Wind/Hail-only in the matrix (ROOF.016–018).
  if (bundle.claim.claimType === "wind_hail") {
    if (!hasChip(photos, TEST_SQUARE)) {
      add({
        key: "test-square",
        group: "roof",
        text: "Test square (10×10) not captured",
        href: `/claims/${claimId}/capture?chip=${encodeURIComponent(TEST_SQUARE)}`,
      });
    } else passing.push("Test square captured");
    if (!hasChip(photos, COLLATERAL)) {
      add({
        key: "collateral",
        group: "roof",
        text: "Collateral indicators not captured",
        href: `/claims/${claimId}/capture?chip=${encodeURIComponent(COLLATERAL)}`,
      });
    } else passing.push("Collateral indicators captured");
  }
  if (bundle.claim.claimType === "water_roof" && !hasChip(photos, ATTIC)) {
    add({
      key: "entry",
      group: "roof",
      text: `${ATTIC} not captured (water entry point)`,
      href: `/claims/${claimId}/capture?chip=${encodeURIComponent(ATTIC)}`,
    });
  }
}
