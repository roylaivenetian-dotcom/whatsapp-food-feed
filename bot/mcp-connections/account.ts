import { defineConnection } from "@grok/agent-sdk/connections";

/**
 * Cursor account connectors (WhatsApp via Automata WhatsApp).
 * Connect "Automata WhatsApp" under Deployed Agents / Cursor MCP for hosted runs.
 * Locally: sign in with `npx @grok/agent-sdk login` and keep the connector linked.
 */
export default defineConnection({
  cursorAccount: true,
  advertiseTools: true,
  servers: ["Automata WhatsApp"],
  optional: true,
  tools: ["list-chats", "read-messages", "search-messages"],
  disallowedTools: ["send-text-message"],
});
