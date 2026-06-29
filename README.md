# GRAINDESK

A personal grain-futures terminal. Built for one trader, scoped to corn (ZC), wheat (ZW),
and soybeans (ZS) — not a generic Bloomberg clone.

Keyboard-driven like a real terminal: type a function code (`WTHR`, `COT`, `CALC`, `WASDE`,
`NEWS`, `NOTE`) and hit enter, or tap the buttons.

## What runs live (free, no key)
- **WTHR** — grain-belt weather (Des Moines, Champaign, Omaha, Wichita, Fargo) via Open-Meteo
- **COT** — managed-money positioning for corn/wheat/beans, pulled server-side from the CFTC
- **NEWS** — USDA headlines parsed from RSS server-side (browsers can't fetch these directly)
- **CALC** — position sizer + risk:reward with correct CME specs (5,000 bu, ¼¢ = $12.50, 1¢ = $50)
- **WASDE / SEAS / NOTE** — report calendar, seasonal tendencies, and a journal saved to disk

## What needs a key
Live **prices** only. Everything else works without one.

## Run it

```bash
npm install
npm start
# open http://localhost:3000
```

That's it. No key needed for weather, COT, news, sizing, or the journal.

## Add live prices (optional)
1. `cp .env.example .env`
2. Put your feed's key in `PRICE_API_KEY`
3. Open `server.js`, find the `/api/prices` handler (marked `WIRE YOUR PROVIDER HERE`),
   and map your provider's response to `[{ s:"ZC", last:Number, chg:Number }, ...]`
4. Restart. The WATCH board flips from SAMPLE to LIVE automatically.

Good free-ish options: your futures **broker's API** (often free with an account, delayed or RT),
**Databento** (pay-as-you-go CME), or an EOD provider for swing trading.

## What it costs to run
- Weather, COT, USDA, news: **$0**
- Delayed prices via broker API: **$0**
- Real-time CME grain data: ~**US$1–15/mo** exchange fee via a vendor
- Hosting: **$0** local, or ~**US$5/mo** on a small VPS if you want it always-on

Compare: a Bloomberg seat is about **US$2,665/month**.

## Layout
```
graindesk/
  server.js         backend: proxies free feeds, hides your price key, persists notes
  public/index.html the terminal UI (all front-end)
  .env.example      copy to .env if you add a price key
  data/kv.json      auto-created; your saved notes live here
```

## Extending it in Claude Code
This is a clean base to hand to Claude Code. Things worth adding next:
- Wire your actual price provider in `/api/prices`
- A macro panel from FRED (DXY, rates, crude) — free key
- USDA crop-progress + drought-monitor parsing into the WTHR panel
- Alerts (e.g. ping when COT net flips, or a WASDE date is tomorrow)
- A real chart panel (price history) once a price feed is connected

Open this folder in Claude Code and describe the change; the structure is small on purpose.
```
> "wire the /api/prices handler to <my provider> and add a 30-day price chart to the WATCH view"
```
