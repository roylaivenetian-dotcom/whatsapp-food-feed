import { canonicalizePerson } from "./names.js";

export const MEAL_PRICE = 50;
export const DRINK_SURCHARGE = 5;
export const SOUP_PRICE = 0;

const OFF_MENU_MARKERS = [
  "嘔噏菜單",
  "未計價",
  "off-menu",
  "offmenu",
  "不在菜單",
  "唔喺菜單",
];

const DRINK_PATTERNS = [
  /凍檸茶/,
  /熱檸茶/,
  /檸檬茶/,
  /凍奶茶/,
  /熱奶茶/,
  /奶茶/,
  /凍咖啡/,
  /熱咖啡/,
  /咖啡/,
  /可樂/,
  /汽水/,
  /\bdrink\b/i,
];

export type FoodOrderInput = {
  person: string;
  /** Calendar date of the order in Asia/Hong_Kong, YYYY-MM-DD */
  date: string;
  dish: string;
  soup?: boolean;
  drink?: string | null;
  extras?: string[];
  onMenu?: boolean;
  remark?: string | null;
  sourceJid?: string;
  sourceMessageId?: string;
};

export type PricedFoodOrder = {
  id: string;
  person: string;
  date: string;
  dish: string;
  soup: boolean;
  drink: string | null;
  extras: string[];
  onMenu: boolean;
  amount: number;
  remark: string | null;
  sourceJid: string | null;
  sourceMessageId: string | null;
};

function detectSoup(dish: string, soup?: boolean): boolean {
  if (typeof soup === "boolean") return soup;
  return /加湯|\+?\s*湯|湯\b/.test(dish);
}

function detectDrink(
  dish: string,
  drink?: string | null,
): string | null {
  if (drink === null) return null;
  if (typeof drink === "string" && drink.trim()) return drink.trim();
  for (const re of DRINK_PATTERNS) {
    const m = dish.match(re);
    if (m) return m[0];
  }
  return null;
}

function detectOnMenu(
  dish: string,
  remark: string | null,
  onMenu?: boolean,
): boolean {
  if (typeof onMenu === "boolean") return onMenu;
  const blob = `${dish} ${remark ?? ""}`;
  return !OFF_MENU_MARKERS.some((m) => blob.includes(m));
}

function cleanDish(dish: string): string {
  return dish
    .replace(/加湯|\+?\s*湯/g, " ")
    .replace(/凍檸茶|熱檸茶|檸檬茶|凍奶茶|熱奶茶|奶茶|凍咖啡|熱咖啡|咖啡|可樂|汽水/g, " ")
    .replace(/加?辣椒油|\+?\s*辣椒油/g, " ")
    .replace(/少少飯|走蔥/g, " ")
    .replace(/\s*加\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectExtras(dish: string, extras?: string[]): string[] {
  if (extras && extras.length) return extras;
  const found: string[] = [];
  if (/辣椒油/.test(dish)) found.push("辣椒油");
  if (/少少飯/.test(dish)) found.push("少少飯");
  if (/走蔥/.test(dish)) found.push("走蔥");
  return found;
}

/** Stable doc id: person + date + hash of dish/source. */
export function orderDocId(order: {
  person: string;
  date: string;
  sourceMessageId?: string | null;
  dish: string;
}): string {
  const person = canonicalizePerson(order.person);
  const base = order.sourceMessageId
    ? `${person}_${order.date}_${order.sourceMessageId}`
    : `${person}_${order.date}_${order.dish}`;
  return base
    .replace(/[^\w\u4e00-\u9fff.-]+/g, "_")
    .slice(0, 700);
}

export function priceFoodOrder(input: FoodOrderInput): PricedFoodOrder {
  const person = canonicalizePerson(input.person);
  const remark = input.remark?.trim() || null;
  const soup = detectSoup(input.dish, input.soup);
  const drink = detectDrink(input.dish, input.drink);
  const extras = detectExtras(input.dish, input.extras);
  const onMenu = detectOnMenu(input.dish, remark, input.onMenu);
  const dish = cleanDish(input.dish) || input.dish.trim();

  let amount = 0;
  let finalRemark = remark;
  if (!onMenu) {
    amount = 0;
    finalRemark = finalRemark
      ? `${finalRemark}；嘔噏菜單，未計價`
      : "嘔噏菜單，未計價";
  } else {
    amount = MEAL_PRICE + (drink ? DRINK_SURCHARGE : 0) + (soup ? SOUP_PRICE : 0);
  }

  return {
    id: orderDocId({
      person,
      date: input.date,
      sourceMessageId: input.sourceMessageId,
      dish,
    }),
    person,
    date: input.date,
    dish,
    soup,
    drink,
    extras,
    onMenu,
    amount,
    remark: finalRemark,
    sourceJid: input.sourceJid ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
  };
}

export type LeaveRecordInput = {
  person: string;
  /** YYYY-MM */
  month: string;
  type?: string;
  dates?: string[];
  note?: string | null;
  sourceMessageId?: string;
  sourceJid?: string;
};

export type LeaveRecord = {
  id: string;
  person: string;
  month: string;
  type: string;
  dates: string[];
  note: string | null;
  sourceJid: string | null;
  sourceMessageId: string | null;
};

export function normalizeLeaveRecord(input: LeaveRecordInput): LeaveRecord {
  const person = canonicalizePerson(input.person);
  const month = input.month;
  const id = `${person}_${month}_${input.sourceMessageId ?? input.dates?.join("-") ?? "leave"}`
    .replace(/[^\w\u4e00-\u9fff.-]+/g, "_")
    .slice(0, 700);
  return {
    id,
    person,
    month,
    type: input.type?.trim() || "leave",
    dates: input.dates ?? [],
    note: input.note?.trim() || null,
    sourceJid: input.sourceJid ?? null,
    sourceMessageId: input.sourceMessageId ?? null,
  };
}
