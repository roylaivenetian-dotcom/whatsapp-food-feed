import { defineEval } from "@grok/agent-sdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "Prices a soup lunch via normalize_food_order.",
  async test(t) {
    await t.send(
      'Normalize this food order with normalize_food_order only (do not call WhatsApp): person Yin, date 2026-11-25, dish "枝竹火腩飯加湯".',
    );
    t.succeeded();
    t.calledTool("normalize_food_order");
  },
});
