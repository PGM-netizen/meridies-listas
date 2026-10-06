// Descarga las listas oficiales de sanciones (SECO, OFAC, ONU, UE) y escribe data/entries.json + data/meta.json.
// Si una fuente falla, conserva las entradas de esa lista de la ejecución anterior (carpeta prev/, si existe).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { parseSeco, parseOfac, parseUn, parseEu } from "./lib/parsers.mjs";

export const SOURCES = {
  SECO: "https://www.sesam.search.admin.ch/sesam-search-web/pages/downloadXmlGesamtliste.xhtml?lang=en&action=downloadXmlGesamtlisteAction",
  OFAC_SDN: "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV",
  OFAC_ALT: "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV",
  UN: "https://scsanctions.un.org/resources/xml/en/consolidated.xml",
  EU: "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"
};
const MIN = { SECO: 500, "OFAC SDN": 5000, "ONU": 300, "UE": 1000 };   // below this, treat the download as broken

export async function build({ fetch = globalThis.fetch, prevDir = "prev", outDir = "data", now = new Date() } = {}) {
  const get = async u => { const r = await fetch(u, { headers: { "user-agent": "meridies-listas/1.0 (+https://github.com/PGM-netizen/meridies-listas)" } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
  const prev = existsSync(`${prevDir}/entries.json`) ? JSON.parse(readFileSync(`${prevDir}/entries.json`, "utf8")) : [];
  const jobs = [
    ["SECO", async () => parseSeco(await get(SOURCES.SECO))],
    ["OFAC SDN", async () => parseOfac(await get(SOURCES.OFAC_SDN), await get(SOURCES.OFAC_ALT).catch(() => ""))],
    ["ONU", async () => parseUn(await get(SOURCES.UN))],
    ["UE", async () => parseEu(await get(SOURCES.EU))]
  ];
  const all = [], lists = {};
  for (const [list, job] of jobs) {
    try {
      const e = await job();
      if (e.length < MIN[list]) throw new Error(`solo ${e.length} entradas (mínimo esperado ${MIN[list]})`);
      all.push(...e); lists[list] = { ok: true, count: e.length, fetched_at: now.toISOString() };
    } catch (err) {
      const old = prev.filter(x => x.list === list);
      all.push(...old);
      lists[list] = { ok: false, error: String(err.message || err), count: old.length, note: old.length ? "se conservan las entradas de la ejecución anterior" : "sin datos" };
    }
  }
  mkdirSync(outDir, { recursive: true });
  const compact = all.map(e => ({ list: e.list, id: e.id, name: e.name, aliases: e.aliases?.length ? e.aliases : undefined, program: e.program || undefined, type: e.type || undefined }));
  writeFileSync(`${outDir}/entries.json`, JSON.stringify(compact));
  writeFileSync(`${outDir}/meta.json`, JSON.stringify({ built_at: now.toISOString(), total: compact.length, lists, sources: SOURCES }, null, 2));
  return { total: compact.length, lists };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await build();
  console.log(JSON.stringify(r, null, 2));
  if (!Object.values(r.lists).some(l => l.ok)) process.exit(1);   // nothing fresh at all: fail the run, keep old data
}
