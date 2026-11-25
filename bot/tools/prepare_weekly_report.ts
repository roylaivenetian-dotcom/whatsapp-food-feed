import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { priceFoodOrder } from "../lib/pricing.js";
import {
  credentialsStatus,
  upsertWeeklyReport,
  type WeeklyReportPayload,
} from "../lib/firestore.js";
import { workWeekRange } from "../lib/week.js";

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
    Build the Friday weekly food summary payload and upsert weeklyReports.
    Pass all priced/raw orders for the Mon–Fri work week. Off-menu amounts stay 0.
  `,
  effect: "idempotent",
  execution: "server",
  inputSchema: z.object({
    /** Any date in the target week (HKT). Defaults to today. */
    weekOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    orders: z.array(orderSchema).min(1),
    note: z.string().optional(),
    dryRun: z.boolean().optional(),
  }),
  async execute({ weekOf, orders, note, dryRun }) {
    const priced = orders.map((o) => priceFoodOrder(o));
    const anchor = weekOf ?? priced[0]!.date;
    const { weekStart, weekEnd, weekId } = workWeekRange(anchor);
    const inWeek = priced.filter((o) => o.date >= weekStart && o.date <= weekEnd);

    const byPerson = new Map<
      string,
      { person: string; total: number; orderCount: number; pricedCount: number }
    >();
    for (const o of inWeek) {
      const row = byPerson.get(o.person) ?? {
        person: o.person,
        total: 0,
        orderCount: 0,
        pricedCount: 0,
      };
      row.orderCount += 1;
      if (o.onMenu && o.amount > 0) {
        row.total += o.amount;
        row.pricedCount += 1;
      }
      byPerson.set(o.person, row);
    }

    const personTotals = [...byPerson.values()].sort((a, b) =>
      a.person.localeCompare(b.person),
    );
    const grandTotal = personTotals.reduce((s, p) => s + p.total, 0);

    const report: WeeklyReportPayload = {
      weekId,
      weekStart,
      weekEnd,
      timezone: "Asia/Hong_Kong",
      personTotals,
      grandTotal,
      orders: inWeek,
      note,
    };

    const write = await upsertWeeklyReport(report, { dryRun });
    return {
      credentials: credentialsStatus(),
      report,
      write,
    };
  },
});
