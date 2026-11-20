// Cotejo de nombres contra las listas descargadas.
// Uso: node screen.mjs "Minera Ejemplo SA de CV" "Juan Pérez"   → JSON con level (clear|possible|strong) y coincidencias
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { screenName } from "./lib/match.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const entries = JSON.parse(readFileSync(join(here, "data", "entries.json"), "utf8"));
const meta = JSON.parse(readFileSync(join(here, "data", "meta.json"), "utf8"));
const out = process.argv.slice(2).map(name => {
  const hits = screenName(name, entries);
  return { name, level: hits.some(h => h.level === "strong") ? "strong" : hits.length ? "possible" : "clear", hits: hits.slice(0, 5) };
});
console.log(JSON.stringify({ built_at: meta.built_at, lists: Object.fromEntries(Object.entries(meta.lists).map(([k, v]) => [k, v.ok ? v.count : `ERROR: ${v.error}`])), results: out }, null, 2));
