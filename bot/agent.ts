import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  name: "whatsapp-food-feed",
  description:
    "Reads WhatsApp food orders and leave messages, prices them, and upserts into Firestore roy-console.",
  model: {
    id: "grok-4.7",
    params: [
      { id: "reasoning_effort", value: "high" },
      { id: "fast", value: "true" },
    ],
  },
  hosting: {
    // Firestore REST + Google OAuth token endpoint
    egressDomains: [
      "firestore.googleapis.com",
      "oauth2.googleapis.com",
      "www.googleapis.com",
    ],
    secretNames: ["FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_PROJECT_ID"],
  },
});
