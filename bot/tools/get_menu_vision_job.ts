import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { getMenuVisionJob } from "../lib/firestore.js";

export default defineTool({
  description: prompt`
    Load one menuVisionJobs/{jobId} document (includes imageDataUrl for vision).
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({
    jobId: z.string().min(3),
  }),
  async execute(input) {
    const job = await getMenuVisionJob(input.jobId);
    if (!job) return { found: false, jobId: input.jobId };
    return { found: true, job };
  },
});
