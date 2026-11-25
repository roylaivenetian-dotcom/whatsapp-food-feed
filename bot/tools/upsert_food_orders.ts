import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { priceFoodOrder } from "../lib/pricing.js";
import { credentialsStatus, upsertFoodOrders } from "../lib/firestore.js";

const orderSchema = z.object({
  person: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dish: z.string(),
  soup: z.boolean().optional(),
  drink: z.string().nullable().optional(),
  extras: z.array(z.string()).optional(),
  onMenu: z.boolean().optional(),
  remark: z.string().nullable().optional(),
  sourceJid: z.string().optional(),
  sourceMessageId: z.string().optional(),
});

export default defineTool({
  description: prompt`
    Price and upsert food orders into Firestore roy-console (foodOrders).
    Idempotent by person+date+sourceMessageId. Prefer dryRun when unsure.
    Without FIREBASE_SERVICE_ACCOUNT_JSON, writes a local sample payload only.
  `,
  effect: "idempotent",
  execution: "server",
  inputSchema: z.object({
    orders: z.array(orderSchema).min(1),
    dryRun: z.boolean().optional(),
  }),
  dryRunResult: ({ orders }) => ({
    mode: "dry-run" as const,
    credentials: credentialsStatus(),
    count: orders.length,
    results: orders.map((o) => ({
      mode: "dry-run" as const,
      collection: "foodOrders",
      docId: priceFoodOrder(o).id,
      path: `foodOrders/${priceFoodOrder(o).id}`,
      ok: true,
      detail: "Stubbed dry-run.",
    })),
  }),
  async execute({ orders, dryRun }) {
    const priced = orders.map((o) => priceFoodOrder(o));
    const written = await upsertFoodOrders(priced, { dryRun });
    return {
      credentials: credentialsStatus(),
      priced,
      ...written,
    };
  },
});
