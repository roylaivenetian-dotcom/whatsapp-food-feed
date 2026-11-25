import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { normalizeLeaveRecord } from "../lib/pricing.js";
import { credentialsStatus, upsertLeaveRecords } from "../lib/firestore.js";

const leaveSchema = z.object({
  person: z.string(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  type: z.string().optional(),
  dates: z.array(z.string()).optional(),
  note: z.string().nullable().optional(),
  sourceMessageId: z.string().optional(),
  sourceJid: z.string().optional(),
});

export default defineTool({
  description: prompt`
    Upsert leave application records into Firestore leaveRequests.
    Use on the 1st of each month when ingesting leave WhatsApp messages.
  `,
  effect: "idempotent",
  execution: "server",
  inputSchema: z.object({
    records: z.array(leaveSchema).min(1),
    dryRun: z.boolean().optional(),
  }),
  dryRunResult: ({ records }) => ({
    mode: "dry-run" as const,
    credentials: credentialsStatus(),
    count: records.length,
    results: records.map((r) => {
      const n = normalizeLeaveRecord(r);
      return {
        mode: "dry-run" as const,
        collection: "leaveRequests",
        docId: n.id,
        path: `leaveRequests/${n.id}`,
        ok: true,
      };
    }),
  }),
  async execute({ records, dryRun }) {
    const normalized = records.map((r) => normalizeLeaveRecord(r));
    const written = await upsertLeaveRecords(normalized, { dryRun });
    return {
      credentials: credentialsStatus(),
      records: normalized,
      ...written,
    };
  },
});
