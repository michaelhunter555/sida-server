import { createHash } from "crypto";

function creds() {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_SECRET || "",
  };
}

export function cloudinaryReady() {
  const { cloudName, apiKey, apiSecret } = creds();
  return Boolean(cloudName && apiKey && apiSecret);
}

export async function uploadImage(dataUri: string, publicId: string) {
  const { cloudName, apiKey, apiSecret } = creds();
  if (!dataUri.startsWith("data:")) {
    throw new Error("Photo data was not a valid image.");
  }
  if (!cloudinaryReady()) {
    throw new Error("Cloudinary needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_SECRET.");
  }

  const timestamp = Math.round(Date.now() / 1000);
  const signed = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const signature = createHash("sha1").update(signed).digest("hex");
  const body = new FormData();
  body.set("file", dataUri);
  body.set("public_id", publicId);
  body.set("timestamp", String(timestamp));
  body.set("api_key", apiKey);
  body.set("signature", signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: "POST",
    body,
  });
  const payload = (await response.json()) as { secure_url?: string; public_id?: string; error?: { message?: string } };
  if (!response.ok || !payload.secure_url || !payload.public_id) {
    const message = payload.error?.message || "Cloudinary upload failed";
    throw new Error(message.split(apiSecret).join(""));
  }
  return { url: payload.secure_url, publicId: payload.public_id };
}
