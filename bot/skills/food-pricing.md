---
name: food-pricing
description: Workplace lunch pricing and off-menu rules for P1027 Admin.
---

# Food pricing

- Meal on menu: **$50**
- Soup (湯 / 加湯): **$0**
- Drink (凍檸茶 and similar): **+$5** → total **$55**
- Off-menu / 嘔噏菜單 / 未計價: **amount 0**, keep a remark; exclude from person and week totals

Always go through `normalize_food_order` or `upsert_food_orders` so pricing stays consistent with the web app.
