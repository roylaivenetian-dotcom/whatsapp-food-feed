import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { priceFoodOrder } from "../lib/pricing.js";

export default defineTool({
  description: prompt`
    Normalize and price one workplace food order line.
    Meal $50, soup free, drink +$5. Off-menu → amount 0 and remark.
    Call once per person/date dish after reading WhatsApp.
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({
    person: z.string().describe("Orderer name, e.g. Yin, Roy, Tim"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .describe("Order calendar date Asia/Hong_Kong YYYY-MM-DD"),
    dish: z.string().describe("Dish text as ordered, may include 湯/drink words"),
    soup: z.boolean().optional(),
    drink: z.string().nullable().optional(),
    extras: z.array(z.string()).optional(),
    onMenu: z
      .boolean()
      .optional()
      .describe("false when off-menu / 嘔噏菜單; omit to auto-detect"),
    remark: z.string().nullable().optional(),
    sourceJid: z.string().optional(),
    sourceMessageId: z.string().optional(),
  }),
  async execute(input) {
    const priced = priceFoodOrder(input);
    return { order: priced };
  },
});
