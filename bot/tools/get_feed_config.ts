import { prompt } from "@grok/agent-sdk";
import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import {
  AGENT_SLUG,
  BRAND_NAME,
  FIREBASE_PROJECT_ID_DEFAULT,
  FOOD_CHAT,
} from "../lib/config.js";
import { credentialsStatus } from "../lib/firestore.js";

export default defineTool({
  description: prompt`
    Return locked P1027 Admin feed defaults: brand, food chat jid, Firebase projectId, credential status.
    Call this instead of guessing which WhatsApp chat is the food-order group.
  `,
  effect: "read",
  execution: "server",
  inputSchema: z.object({}),
  async execute() {
    return {
      brand: BRAND_NAME,
      agentSlug: AGENT_SLUG,
      foodChat: FOOD_CHAT,
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID_DEFAULT,
      firestore: credentialsStatus(),
    };
  },
});
