import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { completeMenuVisionJob } from "../lib/firestore.js";

export default defineTool({
  description: prompt`
    Write Menu OCR results back to Firestore menuVisionJobs/{jobId}.
    Call with status done + dishes after reading the menu photo with vision,
    or status error if extraction failed. Engine is recorded as grok.
  `,
  effect: "write",
  execution: "server",
  inputSchema: z.object({
    jobId: z.string().min(3),
    status: z.enum(["done", "error", "running"]),
    dishes: z
      .array(
        z.object({
          nameZh: z.string(),
          weekday: z
            .enum(["mon", "tue", "wed", "thu", "fri", "sat"])
            .optional()
            .describe("Grid column; mon=星期一 … sat=星期六"),
          nameEn: z.string().optional(),
          category: z.enum(["meal", "soup", "drink"]).optional(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  async execute(input) {
    if (input.status === "done") {
      const dishes = input.dishes ?? [];
      if (!dishes.length) {
        return {
          ok: false,
          detail: "status=done requires a non-empty dishes array",
        };
      }
      const result = await completeMenuVisionJob(input.jobId, {
        status: "done",
        dishes,
      });
      return { ok: result.ok, mode: result.mode, detail: result.detail, dishCount: dishes.length };
    }
    if (input.status === "running") {
      const result = await completeMenuVisionJob(input.jobId, { status: "running" });
      return { ok: result.ok, mode: result.mode, detail: result.detail };
    }
    const result = await completeMenuVisionJob(input.jobId, {
      status: "error",
      error: input.error || "Grok vision failed",
    });
    return { ok: result.ok, mode: result.mode, detail: result.detail };
  },
});
