import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { listPendingMenuVisionJobs } from "../lib/firestore.js";

export default defineTool({
  description: prompt`
    List pending/running Menu admin OCR jobs in Firestore menuVisionJobs.
    Use before extracting dishes from a weekly Chinese lunch menu photo.
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(20).optional(),
  }),
  async execute(input) {
    const jobs = await listPendingMenuVisionJobs(input.limit ?? 5);
    return {
      count: jobs.length,
      jobs: jobs.map((j) => ({
        id: j.id,
        status: j.status,
        hasImage: Boolean(j.imageDataUrl),
        imageBytesHint: j.imageDataUrl ? Math.round((j.imageDataUrl.length * 3) / 4) : 0,
        notifyJid: j.notifyJid,
        updatedAt: j.updatedAt,
        // Include data URL so channel handlers / model workspace can load the photo
        imageDataUrl: j.imageDataUrl,
      })),
    };
  },
});
