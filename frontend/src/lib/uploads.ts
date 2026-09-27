const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp"
};

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp"
};

export const MAX_BANNER_BYTES = 2 * 1024 * 1024;

export function extensionForImageType(type: string): string | null {
  return ALLOWED_TYPES[type.toLowerCase()] ?? null;
}

export function mimeForFilename(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function sanitizeUploadName(name: string): string {
  const withoutExt = name.includes(".") ? name.replace(/\.[^.]+$/, "") : name;
  const slug = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "banner";
}

export async function uploadBanner(file: File): Promise<string> {
  const dataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });

  const response = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, type: file.type, data: dataUri })
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { error?: string };
      detail = payload.error ?? "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(detail || `Banner upload failed (${response.status}).`);
  }

  const payload = (await response.json()) as { url?: string };
  if (!payload.url) throw new Error("Banner upload returned no URL.");
  return payload.url;
}
