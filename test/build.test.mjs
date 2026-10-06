import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, SOURCES } from "../build.mjs";
import { screenName } from "../lib/match.mjs";

const fx = n => readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8");
const many = (xml, n) => xml; // fixtures are tiny; lower the minimums via a big fake below

test("build keeps previous entries for a list whose download fails, and screening works", async () => {
  const dir = mkdtempSync(join(tmpdir(), "listas-"));
  mkdirSync(join(dir, "prev"));
  writeFileSync(join(dir, "prev", "entries.json"), JSON.stringify([{ list: "UE", id: "EU-1", name: "Old EU Entity" }]));
  // inflate fixtures above the sanity minimums
  const rep = (s, open, close, n) => { const i = s.indexOf(open), j = s.indexOf(close, i) + close.length; return s.slice(0, i) + Array.from({ length: n }, (_, k) => s.slice(i, j).replace(/(<value>|wholeName="|<FIRST_NAME>)([^<"]+)/, `$1$2 ${k}`)).join("") + s.slice(j); };
  const pages = {
    [SOURCES.SECO]: rep(fx("seco.xml"), "<target", "</target>", 600),
    [SOURCES.OFAC_SDN]: Array.from({ length: 5001 }, (_, k) => `${k + 1},"ENTITY ${k}","-0-","SDGT","-0-"`).join("\n") + "\n" + fx("sdn.csv"),
    [SOURCES.OFAC_ALT]: fx("alt.csv"),
    [SOURCES.UN]: rep(fx("un.xml"), "<ENTITY>", "</ENTITY>", 301)
    // EU missing → 404
  };
  const fetch = async u => pages[u] ? new Response(pages[u], { status: 200 }) : new Response("no", { status: 404 });
  const r = await build({ fetch, prevDir: join(dir, "prev"), outDir: join(dir, "data") });
  assert.equal(r.lists.SECO.ok, true); assert.equal(r.lists["OFAC SDN"].ok, true); assert.equal(r.lists["ONU"].ok, true);
  assert.equal(r.lists["UE"].ok, false); assert.equal(r.lists["UE"].count, 1);
  const entries = JSON.parse(readFileSync(join(dir, "data", "entries.json"), "utf8"));
  const h = screenName("Acme Metals Trading DMCC", entries);
  assert.equal(h[0].level, "strong"); assert.equal(h[0].list, "OFAC SDN");
  assert.equal(screenName("Minera Prueba SA de CV", entries).length, 0);
});
