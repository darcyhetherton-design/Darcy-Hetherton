/* ============================================================
   GRAINDESK backend
   Solves the two things the browser can't: CORS + hidden keys.
   Free feeds (weather, COT, news) are proxied server-side.
   Prices use YOUR key from .env (never shipped to the browser).
   ============================================================ */
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const PRICE_API_KEY = process.env.PRICE_API_KEY || "";

/* ---------- fetch with timeout (so a dead feed can't hang us) ---------- */
async function fetchT(url, opts = {}, ms = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

/* ---------- tiny cache ---------- */
const cache = {};
async function cached(key, ttlMs, fn) {
  const hit = cache[key];
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache[key] = { t: Date.now(), v };
  return v;
}

/* ---------- grain belt ---------- */
const BELT = [
  { city: "Des Moines", lat: 41.59, lon: -93.62 },
  { city: "Champaign",  lat: 40.12, lon: -88.24 },
  { city: "Omaha",      lat: 41.26, lon: -95.93 },
  { city: "Wichita",    lat: 37.69, lon: -97.34 },
  { city: "Fargo",      lat: 46.88, lon: -96.79 },
];
const WMO = {0:"Clear",1:"Mostly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Rime fog",
  51:"Lt drizzle",53:"Drizzle",55:"Hvy drizzle",61:"Lt rain",63:"Rain",65:"Hvy rain",
  66:"Frz rain",67:"Frz rain",71:"Lt snow",73:"Snow",75:"Hvy snow",80:"Showers",
  81:"Showers",82:"Hvy showers",95:"Thunderstorm",96:"Storm+hail",99:"Storm+hail"};

/* ---------- WEATHER (Open-Meteo, free, no key) ---------- */
app.get("/api/weather", async (req, res) => {
  try {
    const rows = await cached("wx", 10 * 60 * 1000, async () => {
      return Promise.all(BELT.map(async (b) => {
        try {
          const u = `https://api.open-meteo.com/v1/forecast?latitude=${b.lat}&longitude=${b.lon}` +
            `&current=temperature_2m,precipitation,weather_code` +
            `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
            `&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FChicago&forecast_days=1`;
          const r = await fetchT(u);
          if (!r.ok) throw 0;
          const j = await r.json();
          return {
            city: b.city, ok: true,
            temp: j.current.temperature_2m,
            cond: WMO[j.current.weather_code] ?? "\u2014",
            hi: j.daily.temperature_2m_max[0],
            lo: j.daily.temperature_2m_min[0],
            precip: j.daily.precipitation_sum[0],
          };
        } catch { return { city: b.city, ok: false }; }
      }));
    });
    res.json(rows);
  } catch { res.status(502).json([]); }
});

/* ---------- COT (CFTC Socrata, free) ---------- */
app.get("/api/cot", async (req, res) => {
  try {
    const out = await cached("cot", 60 * 60 * 1000, async () => {
      // Disaggregated Futures-Only Reports (managed money positions)
      const base = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json";
      const q = "?$select=contract_market_name,report_date_as_yyyy_mm_dd," +
        "m_money_positions_long_all,m_money_positions_short_all" +
        "&$order=report_date_as_yyyy_mm_dd DESC&$limit=600";
      const r = await fetchT(base + encodeURI(q), {}, 8000);
      if (!r.ok) throw 0;
      const j = await r.json();
      const want = {
        CORN: (n) => /^CORN/i.test(n),
        WHEAT: (n) => /^WHEAT-SRW/i.test(n) || /^WHEAT$/i.test(n),
        SOYBEANS: (n) => /^SOYBEANS$/i.test(n),
      };
      const rows = [];
      for (const key of ["CORN", "WHEAT", "SOYBEANS"]) {
        const hit = j.find((x) => want[key]((x.contract_market_name || "").trim()));
        if (hit) rows.push({
          nm: key,
          long: +hit.m_money_positions_long_all || 0,
          short: +hit.m_money_positions_short_all || 0,
        });
      }
      if (rows.length !== 3) throw 0;
      return rows;
    });
    res.json(out);
  } catch { res.status(502).json([]); }
});

/* ---------- PRICES (your key from .env; sample fallback) ---------- */
const SAMPLE_PRICES = [
  { s: "ZW", last: 548.25, chg: -3.50 }, { s: "ZC", last: 421.00, chg: 2.25 },
  { s: "ZS", last: 1048.75, chg: 6.50 }, { s: "KE", last: 561.50, chg: -2.75 },
  { s: "ZM", last: 312.40, chg: 1.80 },  { s: "ZL", last: 47.62, chg: -0.31 },
];
app.get("/api/prices", async (req, res) => {
  if (!PRICE_API_KEY) {
    return res.json({ source: "sample", rows: SAMPLE_PRICES });
  }
  try {
    // ---- WIRE YOUR PROVIDER HERE ----
    // Example shape only. Map your provider's grain-futures response to:
    //   [{ s:"ZC", last:Number, chg:Number }, ...]
    // e.g. Databento, Barchart, Twelve Data, or your broker's API.
    // const r = await fetch(`https://your-provider/...&apikey=${PRICE_API_KEY}`);
    // const data = await r.json();
    // const rows = data.map(d => ({ s:d.symbol, last:d.close, chg:d.change }));
    // return res.json({ source:"live", rows });
    throw new Error("provider not wired yet");
  } catch (e) {
    res.json({ source: "sample", rows: SAMPLE_PRICES, note: String(e.message || e) });
  }
});

/* ---------- NEWS (RSS proxied + parsed server-side) ---------- */
const FEEDS = [
  { src: "USDA", url: "https://www.usda.gov/rss/latest-releases.xml" },
  { src: "USDA-ERS", url: "https://www.ers.usda.gov/rss/charts-of-note.xml" },
];
function parseRss(xml, src) {
  const items = [];
  const blocks = xml.split(/<item[ >]/i).slice(1);
  for (const b of blocks.slice(0, 10)) {
    const pick = (tag) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      if (!m) return "";
      return m[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
    };
    const title = pick("title"), link = pick("link");
    if (!title) continue;
    let date = pick("pubDate");
    if (date) { const d = new Date(date); if (!isNaN(d)) date = d.toISOString().slice(5, 10); }
    items.push({ src, title: title.slice(0, 120), link, date });
  }
  return items;
}
app.get("/api/news", async (req, res) => {
  try {
    const items = await cached("news", 30 * 60 * 1000, async () => {
      const lists = await Promise.all(FEEDS.map(async (f) => {
        try {
          const r = await fetchT(f.url, { headers: { "User-Agent": "GrainDesk/1.0" } }, 7000);
          if (!r.ok) return [];
          return parseRss(await r.text(), f.src);
        } catch { return []; }
      }));
      return lists.flat();
    });
    res.json(items);
  } catch { res.status(502).json([]); }
});

/* ---------- KV (persist notes/prefs to a JSON file) ---------- */
const KV_FILE = path.join(__dirname, "data", "kv.json");
function readKv() { try { return JSON.parse(fs.readFileSync(KV_FILE, "utf8")); } catch { return {}; } }
function writeKv(o) {
  fs.mkdirSync(path.dirname(KV_FILE), { recursive: true });
  fs.writeFileSync(KV_FILE, JSON.stringify(o, null, 2));
}
app.get("/api/kv", (req, res) => {
  const kv = readKv();
  res.json({ key: req.query.key, value: kv[req.query.key] ?? null });
});
app.post("/api/kv", (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: "key required" });
  const kv = readKv(); kv[key] = value; writeKv(kv);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n  GRAINDESK running  ->  http://localhost:${PORT}`);
  console.log(`  price feed: ${PRICE_API_KEY ? "key loaded (live attempt)" : "sample (no PRICE_API_KEY set)"}\n`);
});
