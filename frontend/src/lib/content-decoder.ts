export interface DecodedInteraction {
  type: "critique" | "builds_on" | "alternative" | "unknown";
  summary: string;
  content: string;
  evidence?: string;
  agentNote?: string;
  rawURI: string;
}

function responseTypeLabel(responseType: number): DecodedInteraction["type"] {
  if (responseType === 0) return "builds_on";
  if (responseType === 1) return "critique";
  if (responseType === 2) return "alternative";
  return "unknown";
}

function decodeBase64(input: string): string {
  if (typeof atob !== "undefined") return atob(input);
  const maybeGlobal = globalThis as typeof globalThis & {
    Buffer?: { from(value: string, encoding: "base64"): { toString(encoding: "utf-8"): string } };
  };
  return maybeGlobal.Buffer?.from(input, "base64").toString("utf-8") ?? "";
}

function asString(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function decodeInteractionContent(contentURI: string, responseType: number): DecodedInteraction {
  const type = responseTypeLabel(responseType);

  if (!contentURI) {
    return { type, summary: "", content: "No content provided", rawURI: "" };
  }

  if (contentURI.startsWith("data:application/json;base64,")) {
    try {
      const b64 = contentURI.replace("data:application/json;base64,", "");
      const decoded = JSON.parse(decodeBase64(b64)) as Record<string, unknown>;
      const summary = asString(decoded.summary ?? decoded.title ?? decoded.type).slice(0, 240);
      const content = asString(decoded.content ?? decoded.summary ?? decoded.reason ?? decoded.explanation ?? decoded);
      return {
        type,
        summary,
        content: content || "No content provided",
        evidence: asString(decoded.evidence ?? decoded.extension ?? decoded.extensionURL ?? decoded.url) || undefined,
        agentNote: asString(decoded.processingNotes ?? decoded.agentNote ?? decoded.note) || undefined,
        rawURI: contentURI
      };
    } catch {
      // Fall through to generic handling.
    }
  }

  if (contentURI.startsWith("data:text/plain")) {
    try {
      const text = contentURI.includes(",") ? contentURI.split(",").slice(1).join(",") : contentURI;
      const decoded = decodeURIComponent(text);
      return {
        type,
        summary: decoded.slice(0, 100),
        content: decoded,
        rawURI: contentURI
      };
    } catch {
      // Fall through to generic handling.
    }
  }

  if (contentURI.startsWith("ipfs://") || contentURI.startsWith("https://ipfs")) {
    return {
      type,
      summary: "IPFS content - open to read",
      content: contentURI,
      evidence: contentURI,
      rawURI: contentURI
    };
  }

  return {
    type,
    summary: contentURI.slice(0, 100),
    content: contentURI,
    rawURI: contentURI
  };
}
