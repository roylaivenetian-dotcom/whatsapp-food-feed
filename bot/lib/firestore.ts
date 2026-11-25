import { createSign, createPrivateKey } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
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
  menuVisionJobs: "menuVisionJobs",
} as const;

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id?: string;
};

type WriteMode =
  | "live"
  | "client-sdk"
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

/** Spark path: shared writeToken required by firestore.rules (no Blaze / Functions). */
function writeToken(): string | null {
  const t = (
    process.env.FIREBASE_WRITE_TOKEN ||
    process.env.FIREBASE_INGEST_KEY ||
    process.env.INGEST_API_KEY ||
    ""
  ).trim();
  return t || null;
}

/** Optional Cloud Function ingest (needs Blaze). Prefer client-sdk on Spark. */
function ingestConfig(): { url: string; key: string } | null {
  const url = (process.env.FIREBASE_INGEST_URL || "").trim().replace(/\/$/, "");
  const key = (process.env.FIREBASE_INGEST_KEY || process.env.INGEST_API_KEY || "").trim();
  if (!url || !key) return null;
  return { url, key };
}

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

function fromFirestoreValue(value: Record<string, unknown> | undefined): unknown {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) {
    const values = (value.arrayValue as { values?: Record<string, unknown>[] })?.values ?? [];
    return values.map((v) => fromFirestoreValue(v));
  }
  if ("mapValue" in value) {
    const fields =
      ((value.mapValue as { fields?: Record<string, Record<string, unknown>> })?.fields) ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) out[k] = fromFirestoreValue(v);
    return out;
  }
  return null;
}

function fieldsToObject(fields: Record<string, Record<string, unknown>> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) out[k] = fromFirestoreValue(v);
  return out;
}

export type MenuVisionJob = {
  id: string;
  status: string;
  imageDataUrl: string | null;
  dishes: Array<{
    nameZh: string;
    nameEn?: string;
    category?: string;
    weekday?: string | null;
  }> | null;
  error: string | null;
  engine: string | null;
  notifyJid: string | null;
  updatedAt: string | null;
};

/** Public read (rules allow) — no auth. */
export async function getMenuVisionJob(jobId: string): Promise<MenuVisionJob | null> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}` +
    `/databases/(default)/documents/${COLLECTIONS.menuVisionJobs}/${encodeURIComponent(jobId)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getMenuVisionJob ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    name?: string;
    fields?: Record<string, Record<string, unknown>>;
  };
  const data = fieldsToObject(json.fields);
  return {
    id: jobId,
    status: String(data.status ?? ""),
    imageDataUrl: (data.imageDataUrl as string) ?? null,
    dishes: (data.dishes as MenuVisionJob["dishes"]) ?? null,
    error: (data.error as string) ?? null,
    engine: (data.engine as string) ?? null,
    notifyJid: (data.notifyJid as string) ?? null,
    updatedAt: (data.updatedAt as string) ?? null,
  };
}

/** List pending/running menu vision jobs (public runQuery). */
export async function listPendingMenuVisionJobs(limit = 5): Promise<MenuVisionJob[]> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}` +
    `/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: COLLECTIONS.menuVisionJobs }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "IN",
            value: {
              arrayValue: {
                values: [{ stringValue: "pending" }, { stringValue: "running" }],
              },
            },
          },
        },
        orderBy: [{ field: { fieldPath: "updatedAt" }, direction: "ASCENDING" }],
        limit,
      },
    }),
  });
  if (!res.ok) {
    // Fallback: page the collection and filter client-side (Spark public read)
    const jobs: MenuVisionJob[] = [];
    let pageToken = "";
    do {
      const listUrl =
        `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}` +
        `/databases/(default)/documents/${COLLECTIONS.menuVisionJobs}?pageSize=100` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
      const listRes = await fetch(listUrl);
      if (!listRes.ok) {
        const text = await listRes.text();
        throw new Error(`listPendingMenuVisionJobs ${listRes.status}: ${text.slice(0, 300)}`);
      }
      const listJson = (await listRes.json()) as {
        documents?: { name?: string; fields?: Record<string, Record<string, unknown>> }[];
        nextPageToken?: string;
      };
      for (const doc of listJson.documents ?? []) {
        const id = doc.name?.split("/").pop() ?? "";
        const data = fieldsToObject(doc.fields);
        const status = String(data.status ?? "");
        if (status !== "pending" && status !== "running") continue;
        jobs.push({
          id,
          status,
          imageDataUrl: (data.imageDataUrl as string) ?? null,
          dishes: (data.dishes as MenuVisionJob["dishes"]) ?? null,
          error: (data.error as string) ?? null,
          engine: (data.engine as string) ?? null,
          notifyJid: (data.notifyJid as string) ?? null,
          updatedAt: (data.updatedAt as string) ?? null,
        });
      }
      pageToken = listJson.nextPageToken ?? "";
    } while (pageToken && jobs.length < limit * 3);
    jobs.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
    return jobs.slice(0, limit);
  }
  const rows = (await res.json()) as {
    document?: { name?: string; fields?: Record<string, Record<string, unknown>> };
  }[];
  const jobs: MenuVisionJob[] = [];
  for (const row of rows) {
    if (!row.document) continue;
    const id = row.document.name?.split("/").pop() ?? "";
    const data = fieldsToObject(row.document.fields);
    jobs.push({
      id,
      status: String(data.status ?? ""),
      imageDataUrl: (data.imageDataUrl as string) ?? null,
      dishes: (data.dishes as MenuVisionJob["dishes"]) ?? null,
      error: (data.error as string) ?? null,
      engine: (data.engine as string) ?? null,
      notifyJid: (data.notifyJid as string) ?? null,
      updatedAt: (data.updatedAt as string) ?? null,
    });
  }
  return jobs;
}

export async function completeMenuVisionJob(
  jobId: string,
  result:
    | {
        status: "done";
        dishes: Array<{
          nameZh: string;
          nameEn?: string;
          category?: string;
          weekday?: string | null;
        }>;
      }
    | { status: "error"; error: string }
    | { status: "running" },
  opts?: { dryRun?: boolean },
): Promise<WriteResult> {
  const now = new Date().toISOString();
  const data: Record<string, unknown> = {
    status: result.status,
    updatedAt: now,
    engine: result.status === "done" ? "grok" : null,
  };
  if (result.status === "done") {
    data.dishes = result.dishes;
    data.error = null;
  } else if (result.status === "error") {
    data.error = result.error;
    data.dishes = null;
  }
  return upsertDocument(COLLECTIONS.menuVisionJobs, jobId, data, opts);
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

/** Unauthenticated Firestore REST write (Spark). Rules require writeToken field. */
async function upsertViaClientSdk(
  collection: string,
  docId: string,
  data: Record<string, unknown>,
): Promise<WriteResult> {
  const path = `${collection}/${docId}`;
  const token = writeToken();
  if (!token) {
    return {
      mode: "missing-credentials",
      collection,
      docId,
      path,
      ok: false,
      detail: "FIREBASE_WRITE_TOKEN unset",
    };
  }
  const payload = { ...data, writeToken: token };
  const projectId = FIRESTORE_PROJECT_ID;
  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/${collection}/${encodeURIComponent(docId)}`;
  const fieldPaths = Object.keys(payload);
  const qs = fieldPaths.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
  const res = await fetch(`${url}?${qs}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: documentFields(payload) }),
  });
  if (!res.ok) {
    const text = await res.text();
    return {
      mode: "client-sdk",
      collection,
      docId,
      path,
      ok: false,
      detail: `Client Firestore PATCH ${res.status}: ${text.slice(0, 500)}`,
    };
  }
  return {
    mode: "client-sdk",
    collection,
    docId,
    path,
    ok: true,
    detail: "Wrote via unauthenticated client REST + writeToken (Spark).",
  };
}

async function upsertViaHttpIngest(
  collection: string,
  docId: string,
  data: Record<string, unknown>,
): Promise<WriteResult> {
  const path = `${collection}/${docId}`;
  const cfg = ingestConfig();
  if (!cfg) {
    return {
      mode: "missing-credentials",
      collection,
      docId,
      path,
      ok: false,
      detail: "FIREBASE_INGEST_URL / FIREBASE_INGEST_KEY unset",
    };
  }

  let action: string;
  let body: Record<string, unknown>;
  if (collection === COLLECTIONS.orders) {
    action = "upsertOrder";
    body = { action, ...data };
  } else if (collection === COLLECTIONS.leaveRequests) {
    action = "createLeave";
    body = { action, ...data };
  } else if (collection === COLLECTIONS.weeklyReports) {
    action = "upsertWeeklyReport";
    body = { action, ...data };
  } else {
    return {
      mode: "http-ingest",
      collection,
      docId,
      path,
      ok: false,
      detail: `Unsupported collection for HTTP ingest: ${collection}`,
    };
  }

  const res = await fetch(cfg.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ingest-key": cfg.key,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return {
      mode: "http-ingest",
      collection,
      docId,
      path,
      ok: false,
      detail: `Ingest HTTP ${res.status}: ${text.slice(0, 500)}`,
    };
  }
  return {
    mode: "http-ingest",
    collection,
    docId,
    path,
    ok: true,
    detail: text.slice(0, 200),
  };
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
  const ingest = ingestConfig();

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

  // Spark preferred: client Firestore write + writeToken (no Blaze / no SA key).
  if (!sa && writeToken()) {
    return upsertViaClientSdk(collection, docId, data);
  }

  // Optional: Cloud Function HTTP ingest (requires Blaze-deployed Function).
  if (!sa && ingest) {
    return upsertViaHttpIngest(collection, docId, data);
  }

  if (!sa) {
    appendSamplePayload({ collection, docId, data });
    return {
      mode: "missing-credentials",
      collection,
      docId,
      path,
      ok: true,
      detail:
        "No FIREBASE_WRITE_TOKEN / SA / ingest URL; wrote sample payload only.",
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
  hasWriteToken: boolean;
  hasHttpIngest: boolean;
  projectId: string;
  dryRunEnv: boolean;
  writePath: "admin-sdk" | "client-sdk" | "http-ingest" | "dry-run-only";
} {
  const hasServiceAccount = Boolean(loadServiceAccount());
  const hasWriteToken = Boolean(writeToken());
  const hasHttpIngest = Boolean(ingestConfig());
  return {
    hasServiceAccount,
    hasWriteToken,
    hasHttpIngest,
    projectId: FIRESTORE_PROJECT_ID,
    dryRunEnv: process.env.FIRESTORE_DRY_RUN === "1",
    writePath: hasServiceAccount
      ? "admin-sdk"
      : hasWriteToken
        ? "client-sdk"
        : hasHttpIngest
          ? "http-ingest"
          : "dry-run-only",
  };
}
