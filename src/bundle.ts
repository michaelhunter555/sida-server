import { buildDeficiencies } from "./lib/deficiencies";
import type { Bundle, Claim, DocumentRequest, Limitation, MoistureReading, Photo, Room, ScanSummary } from "./lib/types";
import { Claim as ClaimModel, DocumentRequest as DocumentModel, Limitation as LimitationModel, Photo as PhotoModel, Reading, Room as RoomModel, Scan, publicId } from "./models";

type IdDoc = { _id: string };

export async function loadBundle(claimId: string): Promise<Bundle | null> {
  const claimDoc = await ClaimModel.findById(claimId).lean<IdDoc>();
  if (!claimDoc) return null;
  const [roomDocs, photoDocs, readingDocs, documentDocs, limitationDocs, scanDocs] = await Promise.all([
    RoomModel.find({ claimId }).lean<IdDoc[]>(),
    PhotoModel.find({ claimId }).select("-imageData -voiceNote.audioData").lean<IdDoc[]>(),
    Reading.find({ claimId }).lean<IdDoc[]>(),
    DocumentModel.find({ claimId }).lean<IdDoc[]>(),
    LimitationModel.find({ claimId }).lean<IdDoc[]>(),
    Scan.find({ claimId }).select("-points").lean<IdDoc[]>(),
  ]);

  const claim = publicId(claimDoc) as Claim;
  const rooms = roomDocs.map((doc) => publicId(doc)) as Room[];
  const photos = photoDocs.map((doc) => publicId(doc)) as Photo[];
  const readings = readingDocs.map((doc) => publicId(doc)) as MoistureReading[];
  const documents = documentDocs.map((doc) => publicId(doc)) as DocumentRequest[];
  const limitations = limitationDocs.map((doc) => publicId(doc)) as Limitation[];
  const scans = scanDocs.map((doc) => publicId(doc)) as ScanSummary[];
  const partial = { claim, rooms, photos, readings, documents, limitations, scans };
  return { ...partial, deficiencies: buildDeficiencies(partial) };
}
