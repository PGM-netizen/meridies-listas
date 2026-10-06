/* Pure parsers for the official sources used by the daily pipeline. Tolerant regex parsing:
   no XML dependency, so the pipeline runs on plain Node 20+ in GitHub Actions. */

const unesc = s => String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/\s+/g, " ").trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`)); return m ? unesc(m[1]) : ""; };
const inner = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`)); return m ? unesc(m[1]) : ""; };
const blocks = (xml, tag) => xml.match(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "g")) || [];

/* ECB daily reference rates → {date, EURUSD, EURCHF, EURMXN, ...} */
export function parseEcb(xml) {
  const date = (xml.match(/<Cube\s+time=['"]([\d-]+)['"]/) || [])[1];
  const out = { date };
  for (const m of xml.matchAll(/<Cube\s+currency=['"](\w{3})['"]\s+rate=['"]([\d.]+)['"]/g)) out["EUR" + m[1]] = Number(m[2]);
  if (!date || !out.EURUSD) throw new Error("ECB: formato inesperado");
  return out;
}

/* metals.dev /v1/latest response (unit=toz or unit=mt) → {XAG, XAU} or {CU, ZN, PB} */
export function parseMetalsDev(json, unit) {
  const m = json && json.metals;
  if (!m) throw new Error("metals.dev: sin campo metals");
  if (unit === "toz") return { XAG: Number(m.silver), XAU: Number(m.gold), at: json.timestamps?.metal || json.timestamp };
  return { CU: Number(m.lme_copper ?? m.copper), ZN: Number(m.lme_zinc ?? m.zinc), PB: Number(m.lme_lead ?? m.lead), at: json.timestamps?.metal || json.timestamp };
}

/* ICCO home page "Cocoa Daily Prices" table → {date, price} of the first row with a USD figure */
export function parseIcco(html) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const m = text.match(/(\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})\s+([\d,]{4,}\.\d{2})/);
  if (!m) throw new Error("ICCO: no se encontró el precio diario");
  return { date: m[1], price: Number(m[2].replace(/,/g, "")) };
}

/* minimal CSV (quoted fields, commas) */
export function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0]);
}
const nil = s => (!s || s.trim() === "-0-" ? "" : s.trim());

/* OFAC SDN.CSV (ent_num, name, type, program, ...) + ALT.CSV (ent_num, alt_num, alt_type, alt_name, remarks) */
export function parseOfac(sdnCsv, altCsv = "") {
  const map = new Map();
  for (const r of parseCsv(sdnCsv)) { if (!/^\d+$/.test(r[0]?.trim())) continue; map.set(r[0].trim(), { id: "OFAC-" + r[0].trim(), list: "OFAC SDN", name: nil(r[1]), type: nil(r[2]) || "entity", program: nil(r[3]), aliases: [] }); }
  for (const r of parseCsv(altCsv)) { const e = map.get(r[0]?.trim()); if (e && nil(r[3])) e.aliases.push(nil(r[3])); }
  return [...map.values()].filter(e => e.name);
}

/* UN consolidated list XML */
export function parseUn(xml) {
  const out = [];
  for (const b of blocks(xml, "INDIVIDUAL")) {
    const name = ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"].map(t => inner(b, t)).filter(Boolean).join(" ");
    const aliases = blocks(b, "INDIVIDUAL_ALIAS").map(a => inner(a, "ALIAS_NAME")).filter(Boolean);
    out.push({ id: "UN-" + inner(b, "REFERENCE_NUMBER"), list: "ONU", name, type: "individual", program: inner(b, "UN_LIST_TYPE"), aliases });
  }
  for (const b of blocks(xml, "ENTITY")) {
    const aliases = blocks(b, "ENTITY_ALIAS").map(a => inner(a, "ALIAS_NAME")).filter(Boolean);
    out.push({ id: "UN-" + inner(b, "REFERENCE_NUMBER"), list: "ONU", name: inner(b, "FIRST_NAME"), type: "entity", program: inner(b, "UN_LIST_TYPE"), aliases });
  }
  return out.filter(e => e.name);
}

/* EU Financial Sanctions Files (FSF) XML 1.1 */
export function parseEu(xml) {
  const out = [];
  for (const b of blocks(xml, "sanctionEntity")) {
    const head = b.slice(0, b.indexOf(">") + 1);
    const names = [...b.matchAll(/<nameAlias\b[^>]*>/g)].map(m => attr(m[0], "wholeName")).filter(Boolean);
    const reg = (b.match(/<regulation\b[^>]*>/) || [""])[0];
    const subj = (b.match(/<subjectType\b[^>]*>/) || [""])[0];
    if (!names.length) continue;
    out.push({ id: "EU-" + (attr(head, "logicalId") || attr(head, "euReferenceNumber")), list: "UE", name: names[0], type: attr(subj, "code") || "", program: attr(reg, "programme"), aliases: [...new Set(names.slice(1))] });
  }
  return out;
}

/* SECO consolidated list XML (Swiss sanctions) */
export function parseSeco(xml) {
  const progs = new Map();
  for (const p of blocks(xml, "sanctions-program")) {
    const nm = (p.match(/<program-name\b[^>]*lang="eng"[^>]*>([\s\S]*?)<\/program-name>/) || [])[1];
    for (const s of p.matchAll(/<sanctions-set\b[^>]*ssid="(\d+)"/g)) progs.set(s[1], unesc(nm || ""));
  }
  const out = [];
  for (const t of blocks(xml, "target")) {
    const ssid = attr(t.slice(0, t.indexOf(">") + 1), "ssid");
    const setId = inner(t, "sanctions-set-id");
    const type = /<individual\b/.test(t) ? "individual" : /<entity\b/.test(t) ? "entity" : /<object\b/.test(t) ? "object" : "";
    const names = blocks(t, "name").map(n => ({ kind: attr(n.slice(0, n.indexOf(">") + 1), "name-type"), full: blocks(n, "name-part").map(p => inner(p, "value")).filter(Boolean).join(" ") })).filter(n => n.full);
    if (!names.length) continue;
    const primary = names.find(n => n.kind === "primary-name") || names[0];
    out.push({ id: "SECO-" + ssid, list: "SECO", name: primary.full, type, program: progs.get(setId) || "", aliases: [...new Set(names.filter(n => n !== primary).map(n => n.full))] });
  }
  return out;
}

/* page text fingerprint for the regulation watch (ignores markup, scripts and whitespace) */
export function pageText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(header|footer|nav)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
}
