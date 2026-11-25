/** Canonical workplace names for food / leave records. */

const ALIASES: Record<string, string> = {
  ken: "Ken",
  yin: "Yin",
  ric: "Ric",
  rick: "Ric",
  roy: "Roy",
  tim: "Tim",
  "philip hui": "Philip Hui",
  philiphui: "Philip Hui",
  "philip wong": "Philip Wong",
  philipwong: "Philip Wong",
  jacky: "Jacky",
  "jacky zeng": "Jacky",
  martin: "Martin",
  "jason wu": "Jason Wu",
  jasonwu: "Jason Wu",
  kevin: "Kevin",
  jasper: "Jasper",
};

/** Map a free-text person token (often trailing an order line) to a canonical name. */
export function canonicalizePerson(raw: string): string {
  const cleaned = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[@#]+/, "");
  if (!cleaned) return "Unknown";
  const key = cleaned.toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  // Strip common WhatsApp title prefixes then retry
  const stripped = key
    .replace(/^ssw\s+/i, "")
    .replace(/\s+(ae|qs|admin|ssw).*$/i, "")
    .trim();
  if (ALIASES[stripped]) return ALIASES[stripped];
  // Title-case unknown names for stable display
  return cleaned
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export const KNOWN_PEOPLE = [
  "Ken",
  "Yin",
  "Ric",
  "Roy",
  "Tim",
  "Philip Hui",
  "Jacky",
  "Martin",
  "Jason Wu",
  "Philip Wong",
  "Kevin",
  "Jasper",
] as const;
