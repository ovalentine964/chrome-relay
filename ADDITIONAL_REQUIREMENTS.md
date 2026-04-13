# Additional Requirements for Browser Relay Architecture
**Append to ARCHITECTURE.md requirements**

These are CRITICAL additions — design them in from the start, not as bolt-ons.

---

## 1. Human-Like Behavior Layer

The system must NOT behave like a bot. Every interaction pattern must be randomized to mimic human browsing:

### Scroll Behavior
- Variable scroll speed (slow reads → fast sweeps, randomize per session)
- Natural pause points (pause mid-scroll, sometimes scroll back up slightly)
- Scroll depth varies — not always to the very bottom
- Micro-pauses before engaging with content (hover, then decide)

### Click Behavior
- Realistic timing between clicks (500ms–3000ms random range per click)
- Hover states before clicking (move to element, wait 200-500ms, THEN click)
- Cursor movement simulation (click coordinates have slight jitter)
- Occasional "hesitation" — hover away and come back before clicking

### Reading Dwell Time
- Simulate reading: pause on tweets proportional to content length (short tweet = 1-3s, long thread = 10-30s)
- Vary by content type (technical content = longer dwell, casual = shorter)
- Randomize — never the same timing twice

### Session Randomization
- All timing parameters have jitter (never fixed values)
- Session start time randomized within plausible window
- No two browsing sessions look identical
- Day/night patterns (fewer interactions late at night)

---

## 2. Intelligence Extraction & Analysis (Real-Time)

As tweets load in the DOM, analyze them immediately:

### Content Analysis
- **Sentiment scoring** (positive/negative/neutral with confidence)
- **Topic classification** (AI, governance, finance, politics, corruption, etc.)
- **Entity extraction** (people, organizations, hashtags, URLs mentioned)
- **Engagement velocity** (likes/retweets per minute — flag sudden spikes)
- **Credibility signals** (account age, follower ratio, verification, edit history)

### Trend Detection
- Flag topics/hashtags that are accelerating before they appear in "What's Happening"
- Detect coordinated posting (same hashtag from many accounts in short window)
- Track thread propagation (who is amplifying whom)

### Thread Mapping
- Build conversation graphs automatically (reply chains, quote chains, quote-tweet chains)
- Identify key actors in threads (original poster, most engaged responders, amplifiers)
- Detect thread depth and engagement decay

### Insight Scoring
- Rank tweets by: relevance score × engagement × credibility
- Flag high-value intelligence: governance failures, fiscal policy changes, corruption allegations, election manipulation
- Score each tweet for "actionable intelligence" potential (0-100)

### Anomaly Detection
- Sudden engagement spikes on specific accounts or content
- Coordinated behavior patterns (bot networks, engagement pods)
- Unusual posting times suggesting coordinated campaigns
- Rapid follower gain suggesting bought followers

---

## 3. Intelligence Delivery Layer

The system must push intelligence OUT, not just store it:

### Structured Intelligence Reports
- Auto-generated periodic reports (configurable: every 30min, hourly, daily)
- Format: Markdown for humans, JSON for agents
- Include: top findings, sources, engagement metrics, trend alerts

### Alert System
- Real-time push for high-value content (governance, corruption, election manipulation)
- Priority levels: LOW / MEDIUM / HIGH / CRITICAL
- Delivery: write to a file, WebSocket event, or webhook

### Cohusdex Agentic Team Integration
- Pre-digested intelligence packets formatted for agentic consumption
- Structured JSON payloads: { topic, summary, sources, sentiment, confidence, action_flags }
- Priority queue: most urgent intelligence delivered first

### Founder Dashboard Output
- Executive summary (5 bullet points max, updated every hour)
- Key source tweets/threads with direct links
- Trend line charts (formatted as ASCII or JSON plottable data)
- "What to watch" section for next 24h

### Output Formats
- `intelligence/reports/YYYY-MM-DD-HHMM.md` — human-readable report
- `intelligence/reports/YYYY-MM-DD-HHMM.json` — machine-readable payload
- `intelligence/alerts.jsonl` — real-time alert stream (one JSON object per line)
- `intelligence/insights.db` — SQLite database of all analyzed content
- `intelligence/digest.md` — executive summary (founder-facing)

---

## 4. Memory and Continuity

The system must remember across sessions:

### Seen-Content Tracking
- Maintain a content fingerprint index (hash of tweet ID + content)
- Never re-analyze content already in the database
- Bloom filter for fast "have I seen this?" checks

### Session Context
- On startup, check last session's state (last position scrolled to, last tweet seen)
- Resume from where it left off, then do a fresh scan of new content
- Cross-session topic tracking (if it was looking at "budget 2026" yesterday, keep monitoring)

### Local Knowledge Base
- SQLite database of: tweets analyzed, entities found, topics tracked, alerts fired
- Full-text search on all tweet content seen
- Exportable as JSON for backup/integration

---

## 5. Summary: Non-Functional Requirements

| Requirement | Target |
|------------|--------|
| Scroll action latency | < 50ms per action |
| Content analysis latency | < 200ms per tweet |
| Intelligence report generation | < 5s for 1000 tweets |
| Memory footprint | < 500MB for 24h session |
| Bot detection evasion | Pass Twitter's active detection heuristics |
| Session continuity | 100% state recoverable after restart |
| Intelligence delivery | Real-time (push) + batch (periodic) |