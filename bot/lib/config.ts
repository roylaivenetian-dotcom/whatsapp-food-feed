/** Locked operator defaults for P1027 Admin feed. */

export const BRAND_NAME = "P1027 Admin";

/** Deploy / package slug (unchanged). */
export const AGENT_SLUG = "whatsapp-food-feed";

/** Firebase project id (technical — not the brand). */
export const FIREBASE_PROJECT_ID_DEFAULT = "sick-meal";

/**
 * Confirmed food-order WhatsApp group (user-confirmed 2026-11-25).
 * Do not guess another chat unless the operator changes this constant.
 */
export const FOOD_CHAT = {
  name: "P1027 Admin Group",
  jid: "85297868213-1620171799@g.us",
} as const;

export const FOOD_CHAT_JID = FOOD_CHAT.jid;
