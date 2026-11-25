import { defineAgent } from "@grok/agent-sdk";

export default defineAgent({
  name: "P1027 Admin",
  description:
    "P1027 Admin feed: reads WhatsApp food orders and leave messages, prices them, and upserts into Firestore (project sick-meal).",
  model: {
    id: "grok-4.7",
    params: [
      { id: "reasoning_effort", value: "high" },
      { id: "fast", value: "true" },
    ],
  },
  hosting: {
    // Firestore REST + OAuth (SA path) or Cloud Function ingest URL (no-SA path)
    egressDomains: [
      "firestore.googleapis.com",
      "oauth2.googleapis.com",
      "www.googleapis.com",
      "us-central1-sick-meal.cloudfunctions.net",
      "sick-meal.web.app",
      "sick-meal.firebaseapp.com",
    ],
    secretNames: [
      "FIREBASE_SERVICE_ACCOUNT_JSON",
      "FIREBASE_PROJECT_ID",
      "FIREBASE_INGEST_URL",
      "FIREBASE_INGEST_KEY",
    ],
  },
});
