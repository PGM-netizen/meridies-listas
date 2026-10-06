/* Meridies market helpers: units, spot lookup, price check, deal value, plausibility, name matching.
   Pure functions, no I/O. Used by the deal room (inlined) and by the daily pipeline. */

export const OZ_PER_KG = 32.1507466;
export const LB_PER_T = 2204.62262;

/* market.items keys: XAG, XAU (USD/oz), CU, ZN, PB (USD/t), COCOA (USD/t); fx: EURUSD, EURCHF, EURMXN */
export const COMMODITY_REF = {
  silver_bullion: { key: "XAG", unit: "oz", label: "Plata spot (USD/oz)" },
  silver_dore:    { key: "XAG", unit: "oz", label: "Plata spot (USD/oz)", payableNote: "El doré se paga por contenido fino: compara solo el precio por onza fina." },
  cu_cathode:     { key: "CU",  unit: "t",  label: "Cobre LME cash (USD/t)" },
  cu_conc:        { key: "CU",  unit: "t",  label: "Cobre LME cash (USD/t)", payableNote: "Concentrado: el precio depende de ley, pagables y maquila; no se compara con el spot." },
  zn_pb_conc:     { key: "ZN",  unit: "t",  label: "Zinc LME cash (USD/t)", payableNote: "Concentrado: el precio depende de ley, pagables y maquila; no se compara con el spot." },
  cocoa_beans:    { key: "COCOA", unit: "t", label: "Cacao ICE, media de futuros (USD/t)", premiumNote: "El cacao fino de aroma cotiza con prima sobre el futuro; un precio muy inferior es sospechoso." },
  cocoa_products: { key: "COCOA", unit: "t", label: "Cacao ICE (USD/t), solo referencia" }
};
export const COMPARABLE = new Set(["silver_bullion", "silver_dore", "cu_cathode", "cocoa_beans"]);

/* convert a quantity in `unit` (t, kg, oz, dmt, lb) to the reference unit (oz or t) */
export function qtyTo(refUnit, qty, unit) {
  const q = Number(qty);
  if (!isFinite(q)) return NaN;
  const kg = unit === "t" || unit === "dmt" ? q * 1000 : unit === "kg" ? q : unit === "oz" ? q / OZ_PER_KG : unit === "lb" ? q / 2.20462262 : NaN;
  if (refUnit === "oz") return kg * OZ_PER_KG;
  if (refUnit === "t") return kg / 1000;
  if (refUnit === "kg") return kg;
  if (refUnit === "lb") return kg * 2.20462262;
  return NaN;
}
/* a price quoted per `unit` → price per refUnit */
export function priceTo(refUnit, price, unit) {
  const p = Number(price);
  const perRefInUnit = qtyTo(unit === "dmt" ? "t" : unit, 1, refUnit); // how many `unit` make one refUnit
  return isFinite(p) && isFinite(perRefInUnit) ? p * perRefInUnit : NaN;
}

export function spotFor(commodity, market) {
  const ref = COMMODITY_REF[commodity];
  if (!ref || !market || !market.items) return null;
  const it = market.items[ref.key];
  if (!it || !isFinite(Number(it.price))) return null;
  return { ...ref, price: Number(it.price), at: it.at || market.asOf, src: it.src || "" };
}

export function ageDays(iso, now = Date.now()) {
  const t = Date.parse(iso);
  return isFinite(t) ? (now - t) / 864e5 : Infinity;
}

/* offered price vs spot, in % (negative = discount) */
export function priceCheck(o, market) {
  const s = spotFor(o.commodity, market);
  if (!s || !COMPARABLE.has(o.commodity)) return null;
  const p = Number(o.price);
  if (!isFinite(p) || p <= 0 || !o.priceUnit) return null;
  const offered = priceTo(s.unit, p, o.priceUnit);
  if (!isFinite(offered)) return null;
  return { offered, spot: s.price, unit: s.unit, pct: (offered / s.price - 1) * 100, at: s.at, src: s.src, label: s.label };
}

/* market value of one shipment and of the annual programme, USD */
export function dealValue(o, market) {
  const s = spotFor(o.commodity, market);
  if (!s) return null;
  const q = qtyTo(s.unit, o.volume, o.unit);
  if (!isFinite(q) || q <= 0) return null;
  const per = q * s.price;
  const ship = Number(o.shipments) || 1;
  return { perShipment: per, annual: per * ship, spot: s.price, unit: s.unit, at: s.at };
}

/* accept a new price only if it moved less than maxPct vs the previous one (or a 2nd source confirms) */
export function plausible(prev, next, maxPct = 10) {
  if (!isFinite(next) || next <= 0) return false;
  if (!isFinite(prev) || prev <= 0) return true;
  return Math.abs(next / prev - 1) * 100 <= maxPct;
}

/* ---------- names (sanctions screening) ---------- */
const LEGAL_PHRASES = ["sa de cv","sab de cv","sapi de cv","s de rl de cv","s de rl","sa de rl","s a b de c v","s a p i de c v","s a de c v","s de r l de c v","s de r l","s en c","s a b","s a p i","s a","s l","s c","s p a","s r l","b v","n v","l l c","p l c"];
const LEGAL_WORDS = new Set(["sa","sab","sapi","cv","srl","sl","sas","sarl","gmbh","ag","kg","ltd","limited","llc","inc","corp","corporation","co","company","plc","bv","nv","spa","oy","ab","pjsc","ojsc","jsc","zao","ooo","oao","fze","fzco","dmcc","sagl","open","joint","stock","public","closed"]);
export function normName(s) {
  let t = " " + String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim() + " ";
  for (const ph of LEGAL_PHRASES) t = t.split(" " + ph + " ").join(" ");
  return t.split(" ").filter(w => w && !LEGAL_WORDS.has(w)).join(" ");
}
function bigrams(s) {
  const t = " " + s + " ", out = new Map();
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); out.set(g, (out.get(g) || 0) + 1); }
  return out;
}
/* Dice coefficient on character bigrams, plus token containment */
export function nameSimilarity(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const A = bigrams(x), B = bigrams(y);
  let inter = 0, na = 0, nb = 0;
  A.forEach((v, k) => { na += v; if (B.has(k)) inter += Math.min(v, B.get(k)); });
  B.forEach(v => { nb += v; });
  const dice = (2 * inter) / (na + nb);
  const tx = new Set(x.split(" ")), ty = new Set(y.split(" "));
  const small = tx.size <= ty.size ? tx : ty, big = small === tx ? ty : tx;
  let hit = 0; small.forEach(t => { if (big.has(t)) hit++; });
  const contain = small.size >= 2 ? hit / small.size : 0;
  return Math.max(dice, contain * 0.95);
}
/* entries: [{name, aliases?:[], list, program?, id?}] → hits sorted by score */
export function screenName(name, entries, { strong = 0.9, possible = 0.78 } = {}) {
  const hits = [];
  for (const e of entries) {
    const names = [e.name, ...(e.aliases || [])];
    let best = 0, via = e.name;
    for (const n of names) { const s = nameSimilarity(name, n); if (s > best) { best = s; via = n; } }
    if (best >= possible) hits.push({ name: e.name, matched: via, list: e.list, program: e.program || "", id: e.id || "", score: Math.round(best * 100) / 100, level: best >= strong ? "strong" : "possible" });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 10);
}
