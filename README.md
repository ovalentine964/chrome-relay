# CoHusdex Chrome Relay — Browser Intelligence Platform

**What it does:** Gives the CoHusdex agentic team real-time, human-like control of Twitter through Chrome — observing, analyzing, and acting without being detected as a bot.

**Why we built it instead of using Playwright/Selenium:** Existing tools are designed for test automation (stateless, polling, no semantic understanding). This is built for AI-driven continuous intelligence gathering — real-time DOM observation, semantic tweet objects, human-like behavior, and intelligence-first design.

---

## Quick Start

### 1. Start Chrome with DevTools enabled
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-profile-cohusdex
```

### 2. Install dependencies and start relay
```bash
cd server
npm install
node index.js
```

### 3. Verify it's running
```bash
curl http://localhost:3131/status
# {"status":"ok","cdp":true,"tweetsAnalyzed":0}
```

### 4. Open Twitter in the Chrome tab you just started
Navigate to `https://twitter.com` and log in normally.

The relay will now begin observing and analyzing. Intelligence reports appear in `intelligence/` and alerts are pushed via WebSocket.

---

## Architecture Overview

```
Cohusdex Agent
    ↓ (HTTP/WebSocket)
Relay Server (port 3131)
    ↓ (CDP WebSocket)
Chrome DevTools Protocol
    ↓
Twitter.com (user's logged-in session)
```

**Key modules:**
- `relay/cdp-relay.js` — Direct CDP connection (no Playwright abstraction)
- `relay/twitter-semantic.js` — TweetObjects from raw DOM
- `relay/intelligence-engine.js` — Analysis, trends, anomaly detection
- `relay/human-behavior.js` — Randomized human-like interaction
- `relay/delivery.js` — Reports, alerts, Telegram formatting
- `relay/memory.js` — SQLite knowledge base + bloom filter dedup

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Server status + stats |
| `/navigate` | POST | Navigate to URL |
| `/scroll` | POST | Scroll by deltaY pixels |
| `/click` | POST | Click element by CSS selector |
| `/extract` | POST | Extract visible tweets |
| `/search` | POST | Search Twitter |
| `/alerts` | GET | Get recent alerts |
| `/report` | GET | Latest intelligence report |
| `/intelligence` | GET | Full intelligence state |
| `/ws` | WS | WebSocket for real-time events |

**WebSocket events:** `tweet`, `alert`, `trend`, `insight`, `report`

---

## Intelligence Output

```
intelligence/
  reports/YYYY-MM-DD-HHMM.md    — Human-readable report
  reports/YYYY-MM-DD-HHMM.json  — Machine-readable payload
  alerts.jsonl                   — Real-time alert stream
  digest.md                      — Executive summary (founder-facing)
```

Alert priorities: `CRITICAL` → `HIGH` → `MEDIUM` → `LOW`

---

## Chrome Extension (Optional Fallback)

If you can't start Chrome with `--remote-debugging-port`, install the extension:

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Pack `extension/` folder
4. Install the `.crx`

⚠️ Note: Chrome Manifest V3 restricts background script persistence. For reliable long-running operation, use the CDP-direct approach above.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3131 | HTTP server port |
| `CHROME_HOST` | 127.0.0.1 | Chrome host |
| `CHROME_PORT` | 9222 | Chrome debug port |
| `REPORT_INTERVAL_MINUTES` | 60 | Minutes between reports |

---

## Development

```bash
npm run dev    # Run with --watch for auto-reload
npm run search # Test the DuckDuckGo search tool
```

---

## What makes this different from Playwright

| Feature | Playwright | CoHusdex Relay |
|---------|-----------|----------------|
| DOM observation | Polling | True push events (CDP mutation observer) |
| Latency per action | 20-100ms | <10ms local relay |
| Page state memory | Lost after navigation | Persistent across session |
| Tweet understanding | Raw HTML | Semantic TweetObject model |
| Human-like behavior | None | Randomized scroll/click/dwell |
| Intelligence layer | None | Sentiment, topics, trends, anomaly detection |
| Bot detection | Easy to detect | Mimics organic browsing |

---

*Built for the CoHusdex agentic team — autonomous Twitter intelligence, 24/7.*