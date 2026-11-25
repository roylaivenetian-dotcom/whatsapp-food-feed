import { createSign, createPrivateKey } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LeaveRecord, PricedFoodOrder } from "./pricing.js";

export const FIRESTORE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || "roy-console";

export const COLLECTIONS = {
  foodOrders: "foodOrders",
  weeklyReports: "weeklyReports",
  leaveRecords: "leaveRecords",
} as const;

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

type WriteMode = "live" | "dry-run" | "missing-credentials";

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
          note: "Dry-run sample payloads. Set FIREBASE_SERVICE_ACCOUNT_JSON for live writes.",
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

async function upsertDocument(
  collection: string,
  docId: string,
  data: Record<string, unknown>,
  opts?: { dryRun?: boolean },
): Promise<WriteResult> {
  const path = `${collection}/${docId}`;
  const forceDry = opts?.dryRun === true || process.env.FIRESTORE_DRY_RUN === "1";
  const sa = loadServiceAccount();

  if (forceDry || !sa) {
    appendSamplePayload({ collection, docId, data });
    return {
      mode: forceDry ? "dry-run" : "missing-credentials",
      collection,
      docId,
      path,
      ok: true,
      detail: forceDry
        ? "Dry-run: wrote sample payload locally."
        : "FIREBASE_SERVICE_ACCOUNT_JSON unset; wrote sample payload only.",
    };
  }

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
      await upsertDocument(COLLECTIONS.foodOrders, order.id, data, opts),
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
      await upsertDocument(COLLECTIONS.leaveRecords, record.id, data, opts),
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
  projectId: string;
  dryRunEnv: boolean;
} {
  return {
    hasServiceAccount: Boolean(loadServiceAccount()),
    projectId: FIRESTORE_PROJECT_ID,
    dryRunEnv: process.env.FIRESTORE_DRY_RUN === "1",
  };
}
