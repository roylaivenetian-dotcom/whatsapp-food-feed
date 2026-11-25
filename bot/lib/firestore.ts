import { createSign, createPrivateKey } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type { LeaveRecord, PricedFoodOrder } from "./pricing.js";
import { FIREBASE_PROJECT_ID_DEFAULT } from "./config.js";

export const FIRESTORE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID_DEFAULT;

/** Shared with the food-leave web app (see docs/food-leave-app.md). */
export const COLLECTIONS = {
  orders: "orders",
  weeklyReports: "weeklyReports",
  leaveRequests: "leaveRequests",
} as const;

/** Default Cloud Function URL (asia-east2). Override with FIREBASE_INGEST_URL. */
export const DEFAULT_INGEST_URL =
  "https://asia-east2-sick-meal.cloudfunctions.net/api";

const INGEST_KEY_FILE_CANDIDATES = [
  process.env.FIREBASE_INGEST_KEY_FILE,
  "/cursor/stores/self/internal/ingest-key.txt",
].filter(Boolean) as string[];

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

type WriteMode =
  | "live"
  | "http-ingest"
  | "dry-run"
  | "missing-credentials";

export type WriteResult = {
  mode: WriteMode;
  collection: string;
  docId: string;
  path: string;
  ok: boolean;
  detail?: string;
};

function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Prefer env; else read sibling store file (never commit that file into this repo). */
export function loadIngestKey(): string | null {
  const fromEnv =
    process.env.FIREBASE_INGEST_KEY?.trim() ||
    process.env.INGEST_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  for (const file of INGEST_KEY_FILE_CANDIDATES) {
    try {
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8").trim();
      if (text) return text;
    } catch {
      // ignore unreadable paths
    }
  }
  return null;
}

export function ingestUrl(): string {
  return (
    process.env.FIREBASE_INGEST_URL?.trim() ||
    process.env.INGEST_URL?.trim() ||
    DEFAULT_INGEST_URL
  );
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const key = createPrivateKey(sa.private_key);
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const sig = b64url(signer.sign(key));
  const assertion = `${unsigned}.${sig}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Token response missing access_token");
  return json.access_token;
}

function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((v) => toFirestoreValue(v)),
      },
    };
  }
  if (typeof value === "object") {
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function documentFields(data: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

function samplePayloadPath(): string | null {
  return (
    process.env.FIRESTORE_DRY_RUN_PATH ||
    "/cursor/stores/self/internal/sample-firestore-payload.json"
  );
}

function appendSamplePayload(entry: {
  collection: string;
  docId: string;
  data: Record<string, unknown>;
}): void {
  const path = samplePayloadPath();
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    let existing: { writtenAt?: string; documents?: unknown[] } = {};
    try {
      existing = JSON.parse(readFileSync(path, "utf8")) as typeof existing;
    } catch {
      existing = { documents: [] };
    }
    const documents = Array.isArray(existing.documents) ? existing.documents : [];
    documents.push({
      at: new Date().toISOString(),
      collection: entry.collection,
      docId: entry.docId,
      data: entry.data,
    });
    writeFileSync(
      path,
      JSON.stringify(
        {
          projectId: FIRESTORE_PROJECT_ID,
          writtenAt: new Date().toISOString(),
          note: "Sample payloads. Prefer FIREBASE_INGEST_KEY HTTP ingest or FIREBASE_SERVICE_ACCOUNT_JSON.",
          documents: documents.slice(-200),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // Sample file is best-effort in restricted environments.
  }
}

type IngestAction = "upsertOrder" | "createLeave";

function ingestActionFor(
  collection: string,
): IngestAction | null {
  if (collection === COLLECTIONS.orders) return "upsertOrder";
  if (collection === COLLECTIONS.leaveRequests) return "createLeave";
  return null;
}

async function postIngest(
  action: IngestAction,
  data: Record<string, unknown>,
  key: string,
): Promise<{ ok: boolean; detail: string; id?: string }> {
  const url = ingestUrl();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ingest-key": key,
    },
    body: JSON.stringify({ action, ...data }),
  });
  const text = await res.text();
  let parsed: { ok?: boolean; id?: string; error?: string } = {};
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    return {
      ok: false,
      detail: `HTTP ingest ${res.status}: ${(parsed.error || text).slice(0, 400)}`,
    };
  }
  return {
    ok: true,
    id: parsed.id,
    detail: `Posted ${action} to ingest URL.`,
  };
}

async function upsertViaAdmin(
  collection: string,
  docId: string,
  data: Record<string, unknown>,
  sa: ServiceAccount,
): Promise<WriteResult> {
  const path = `${collection}/${docId}`;
  const projectId = sa.project_id || FIRESTORE_PROJECT_ID;
  const token = await getAccessToken(sa);
  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}`;
  const fieldPaths = Object.keys(data);
  const qs = fieldPaths.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
  const res = await fetch(`${url}?${qs}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fields: documentFields(data) }),
  });
  if (!res.ok) {
    const text = await res.text();
    return {
      mode: "live",
      collection,
      docId,
      path,
      ok: false,
      detail: `Firestore PATCH ${res.status}: ${text.slice(0, 500)}`,
    };
  }
  return { mode: "live", collection, docId, path, ok: true };
}

async function upsertDocument(
  collection: string,
  docId: string,
  data: Record<string, unknown>,
  opts?: { dryRun?: boolean },
): Promise<WriteResult> {
  const path = `${collection}/${docId}`;
  const forceDry = opts?.dryRun === true || process.env.FIRESTORE_DRY_RUN === "1";
  if (forceDry) {
    appendSamplePayload({ collection, docId, data });
    return {
      mode: "dry-run",
      collection,
      docId,
      path,
      ok: true,
      detail: "Dry-run: wrote sample payload locally.",
    };
  }

  const sa = loadServiceAccount();
  if (sa) {
    return upsertViaAdmin(collection, docId, data, sa);
  }

  // Org may block SA keys — POST to Cloud Function ingest when key is available.
  const key = loadIngestKey();
  const action = ingestActionFor(collection);
  if (key && action) {
    const posted = await postIngest(action, data, key);
    return {
      mode: "http-ingest",
      collection,
      docId: posted.id || docId,
      path,
      ok: posted.ok,
      detail: posted.detail,
    };
  }

  if (key && !action) {
    appendSamplePayload({ collection, docId, data });
    return {
      mode: "http-ingest",
      collection,
      docId,
      path,
      ok: true,
      detail:
        "HTTP ingest has no weeklyReports action; sample saved. Rely on fridayFoodReport CF or Admin SDK.",
    };
  }

  appendSamplePayload({ collection, docId, data });
  return {
    mode: "missing-credentials",
    collection,
    docId,
    path,
    ok: true,
    detail:
      "No FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_INGEST_KEY; wrote sample payload only.",
  };
}

export async function upsertFoodOrders(
  orders: PricedFoodOrder[],
  opts?: { dryRun?: boolean },
): Promise<{ results: WriteResult[]; count: number }> {
  const results: WriteResult[] = [];
  const now = new Date().toISOString();
  for (const order of orders) {
    const data = {
      ...order,
      updatedAt: now,
    };
    results.push(
      await upsertDocument(COLLECTIONS.orders, order.id, data, opts),
    );
  }
  return { results, count: results.length };
}

export async function upsertLeaveRecords(
  records: LeaveRecord[],
  opts?: { dryRun?: boolean },
): Promise<{ results: WriteResult[]; count: number }> {
  const results: WriteResult[] = [];
  const now = new Date().toISOString();
  for (const record of records) {
    const data = { ...record, updatedAt: now };
    results.push(
      await upsertDocument(COLLECTIONS.leaveRequests, record.id, data, opts),
    );
  }
  return { results, count: results.length };
}

export type WeeklyReportPayload = {
  weekId: string;
  weekStart: string;
  weekEnd: string;
  timezone: string;
  personTotals: Array<{
    person: string;
    total: number;
    orderCount: number;
    pricedCount: number;
  }>;
  grandTotal: number;
  orders: PricedFoodOrder[];
  note?: string;
};

export async function upsertWeeklyReport(
  report: WeeklyReportPayload,
  opts?: { dryRun?: boolean },
): Promise<WriteResult> {
  const now = new Date().toISOString();
  return upsertDocument(
    COLLECTIONS.weeklyReports,
    report.weekId,
    { ...report, generatedAt: now, updatedAt: now },
    opts,
  );
}

export function credentialsStatus(): {
  hasServiceAccount: boolean;
  hasIngestKey: boolean;
  ingestUrl: string;
  projectId: string;
  dryRunEnv: boolean;
} {
  return {
    hasServiceAccount: Boolean(loadServiceAccount()),
    hasIngestKey: Boolean(loadIngestKey()),
    ingestUrl: ingestUrl(),
    projectId: FIRESTORE_PROJECT_ID,
    dryRunEnv: process.env.FIRESTORE_DRY_RUN === "1",
  };
}
