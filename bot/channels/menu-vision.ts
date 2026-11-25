import { defineChannel, POST } from "@grok/agent-sdk/channels";
import { z } from "zod";
import {
  completeMenuVisionJob,
  getMenuVisionJob,
} from "../lib/firestore.js";

type State = { jobId: string };

/**
 * Menu admin (sick-meal.web.app) POSTs { jobId } after writing menuVisionJobs/{id}.
 * Hosted responses are always 202 — results go back to Firestore for the UI to poll.
 */
export default defineChannel<State>({
  state: { jobId: "" },
  routes: [
    POST("/extract", {
      description: "Extract dishes from a queued menuVisionJobs image via Grok vision",
      bodySchema: z.object({
        jobId: z.string().min(3),
      }),
      handler: async (_request, { send, waitUntil, body }) => {
        const job = await getMenuVisionJob(body.jobId);
        if (!job?.imageDataUrl) {
          await completeMenuVisionJob(body.jobId, {
            status: "error",
            error: "menuVisionJobs image missing",
          });
          return new Response(null, { status: 202 });
        }

        await completeMenuVisionJob(body.jobId, { status: "running" });

        const m = job.imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
        const b64 = m?.[2] ?? job.imageDataUrl.replace(/^data:[^,]*,/, "");
        const ext = (m?.[1] ?? "image/jpeg").includes("png") ? "png" : "jpg";

        waitUntil(
          send(
            [
              `Menu vision job ${body.jobId}.`,
              `Open workspace file menu.${ext} (weekly 繁體中文 lunch grid, Mon–Sat columns 星期一–六).`,
              `Transcribe every dish in every day column with weekday. JSON dishes:`,
              `[{nameZh, weekday:"mon"|"tue"|"wed"|"thu"|"fri"|"sat", nameEn:"", category:"meal"}].`,
              `Do NOT collapse Mon–Sat into one list — same name on another day is a separate row.`,
              `Dedupe only identical nameZh+weekday. Expect ~40–55 rows (~43 unique names).`,
              `No Tesseract. No Gemini. On failure call complete_menu_vision_job with status error.`,
            ].join(" "),
            {
              continuationToken: `menu-vision:${body.jobId}`,
              state: { jobId: body.jobId },
              title: `Menu vision ${body.jobId}`,
              workspaceFiles: {
                [`menu.${ext}`]: { encoding: "base64" as const, data: b64 },
              },
            },
          ),
        );

        return new Response(null, { status: 202 });
      },
    }),
  ],
});
