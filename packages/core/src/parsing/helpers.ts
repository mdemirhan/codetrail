export type UnknownRecord = Record<string, unknown>;

export type TokenUsage = {
  input: number | null;
  output: number | null;
};

export const EPOCH_ISO = new Date(0).toISOString();

export function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as UnknownRecord;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function lowerString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value.trim().toLowerCase();
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function extractEvents(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  for (const key of ["events", "messages", "conversation", "items"]) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

export function extractTokenUsage(event: UnknownRecord): TokenUsage {
  const usageCandidates = [
    event.usage,
    event.tokens,
    event.token_usage,
    asRecord(event.metadata)?.usage,
  ];

  const directInput = readNumber(
    event.input_tokens,
    event.prompt_tokens,
    event.inputTokens,
    event.promptTokens,
  );

  const directOutput = readNumber(
    event.output_tokens,
    event.completion_tokens,
    event.outputTokens,
    event.completionTokens,
  );

  for (const usage of usageCandidates) {
    const usageRecord = asRecord(usage);
    if (!usageRecord) {
      continue;
    }

    const input =
      directInput ??
      readNumber(
        usageRecord.input,
        usageRecord.input_tokens,
        usageRecord.prompt_tokens,
        usageRecord.prompt,
      );

    const output =
      directOutput ??
      readNumber(
        usageRecord.output,
        usageRecord.output_tokens,
        usageRecord.completion_tokens,
        usageRecord.completion,
      );

    return {
      input: input ?? null,
      output: output ?? null,
    };
  }

  return {
    input: directInput ?? null,
    output: directOutput ?? null,
  };
}

export function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }

  return null;
}

export function extractEventTimestamp(event: UnknownRecord): string {
  const metadata = asRecord(event.metadata);
  const candidates = [
    event.createdAt,
    event.created_at,
    event.timestamp,
    event.time,
    metadata?.createdAt,
    metadata?.created_at,
    metadata?.timestamp,
  ];

  for (const candidate of candidates) {
    const iso = toIsoTimestamp(candidate);
    if (iso) {
      return iso;
    }
  }

  return EPOCH_ISO;
}

export function extractText(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractText(item));
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const typed = lowerString(record.type);
  if (typed === "thinking" || typed === "reasoning") {
    const text = firstTextField(record);
    return text ? [text] : [];
  }

  const text = firstTextField(record);
  if (text) {
    return [text];
  }

  for (const key of ["parts", "content", "messages"]) {
    if (key in record) {
      return extractText(record[key]);
    }
  }

  return [];
}

export function serializeUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function firstTextField(record: UnknownRecord): string | null {
  for (const key of ["text", "content", "message", "body", "value"]) {
    const value = record[key];
    if (typeof value === "string") {
      const normalized = normalizeText(value);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function normalizeText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.trunc(value);
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return Math.trunc(parsed);
      }
    }
  }

  return undefined;
}
