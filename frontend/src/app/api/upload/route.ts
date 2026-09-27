import { put } from "@vercel/blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  MAX_BANNER_BYTES,
  extensionForImageType,
  mimeForFilename,
  sanitizeUploadName
} from "@/lib/uploads";

const DATA_URI_PATTERN = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i;

function devUploadDir(): string {
  return path.join(process.cwd(), ".uploads");
}

type UploadRequestBody = { name?: unknown; type?: unknown; data?: unknown };

export async function POST(request: Request): Promise<Response> {
  let body: UploadRequestBody | null = null;
  try {
    body = (await request.json()) as UploadRequestBody;
  } catch {
    body = null;
  }

  if (!body || typeof body.data !== "string") {
    return Response.json({ error: "Expected { name, type, data } with a base64 data URI." }, { status: 400 });
  }

  const match = DATA_URI_PATTERN.exec(body.data);
  if (!match) {
    return Response.json({ error: "Banner must be a base64 image data URI." }, { status: 400 });
  }

  const declaredType = typeof body.type === "string" ? body.type.toLowerCase() : match[1].toLowerCase();
  const extension = extensionForImageType(declaredType) ?? extensionForImageType(match[1]);
  if (!extension) {
    return Response.json({ error: "Only JPG, PNG, GIF or WEBP images are supported." }, { status: 415 });
  }

  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (buffer.length === 0) {
    return Response.json({ error: "The image is empty." }, { status: 400 });
  }
  if (buffer.length > MAX_BANNER_BYTES) {
    return Response.json({ error: "Image must be 2MB or smaller." }, { status: 413 });
  }

  const safeName = sanitizeUploadName(typeof body.name === "string" ? body.name : "banner");
  const filename = `${Date.now()}-${safeName}.${extension}`;
  const contentType = `image/${extension === "jpg" ? "jpeg" : extension}`;

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) {
    try {
      const blob = await put(`banners/${filename}`, buffer, {
        access: "public",
        contentType,
        token,
        allowOverwrite: false
      });
      return Response.json({ url: blob.url });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Blob upload failed.";
      return Response.json({ error: `Banner upload failed: ${message}` }, { status: 502 });
    }
  }

  if (process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "Banner storage is not configured (missing BLOB_READ_WRITE_TOKEN)." },
      { status: 503 }
    );
  }

  try {
    await mkdir(devUploadDir(), { recursive: true });
    await writeFile(path.join(devUploadDir(), filename), buffer);
    return Response.json({ url: `/api/upload?name=${encodeURIComponent(filename)}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Local write failed.";
    return Response.json({ error: `Banner upload failed: ${message}` }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name") ?? "";
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) {
    return new Response("Not found", { status: 400 });
  }

  try {
    const buffer = await readFile(path.join(devUploadDir(), name));
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeForFilename(name),
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
