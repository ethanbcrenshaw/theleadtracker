// Home-market geography. Knoxville + surrounding towns for metro fan-out.

export const KNOX_METRO = [
  "Knoxville",
  "Farragut",
  "Powell",
  "Karns",
  "Halls",
  "Corryton",
  "Mascot",
  "Seymour",
  "Alcoa",
  "Maryville",
  "Oak Ridge",
  "Clinton",
  "Lenoir City",
  "Loudon",
];

function townOf(city: string): string {
  return city.split(",")[0].trim().toLowerCase();
}

/** Is the requested city in (or near) the Knoxville metro? */
export function isKnoxMetro(city: string): boolean {
  const c = townOf(city);
  return KNOX_METRO.some((t) => t.toLowerCase() === c);
}

/** The other metro towns, as "Town, TN" query strings. */
export function metroTowns(city: string): string[] {
  const c = townOf(city);
  return KNOX_METRO.filter((t) => t.toLowerCase() !== c).map((t) => `${t}, TN`);
}
