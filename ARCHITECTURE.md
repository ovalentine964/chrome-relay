---

## 10. CohusdexClient — Agent SDK (`relay/cohusdex-client.js`)

Full client library for Cohusdex agents to connect to the relay server.

```javascript
class CohusdexClient {
  /**
   * @param {string} baseUrl - Relay server URL (default: http://localhost:3131)
   */
  constructor(baseUrl = 'http://localhost:3131') {
    this.baseUrl = baseUrl;
    this.ws = null;
    this.handlers = {};
    this._connectPromise = null;
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  /** Establish WebSocket connection. Auto-reconnects on drop. */
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://${this.baseUrl}/ws`);
      this.ws.onopen = () => resolve(this);
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (evt) => this._dispatch(JSON.parse(evt.data));
      this.ws.onclose = () => {
        // Auto-reconnect after 3s
        setTimeout(() => this.connect().catch(() => {}), 3000);
      };
    });
  }

  /** Close connection cleanly. */
  disconnect() {
    if (this.ws) { this.ws.close(1000, 'normal'); this.ws = null; }
  }

  /** @returns {boolean} */
  isConnected() { return this.ws && this.ws.readyState === WebSocket.OPEN; }

  // ── Event subscription ─────────────────────────────────────────────────────

  /**
   * Subscribe to real-time events.
   * @param {'tweet'|'alert'|'trend'|'report'|'insight'} event
   * @param {function} handler
   */
  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
    // Also tell server to send this event type
    this._send({ type: 'subscribe', events: [event] });
  }

  off(event, handler) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter(h => h !== handler);
    }
  }

  _dispatch(msg) {
    const handlers = this.handlers[msg.type] || [];
    handlers.forEach(h => {
      try { h(msg.data); } catch (e) { console.error('Handler error:', e); }
    });
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // ── Browser commands ───────────────────────────────────────────────────────

  /** Scroll the active tab by delta pixels. Returns { success, newY } */
  async scroll(deltaY) {
    const res = await fetch(`${this.baseUrl}/scroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deltaY })
    });
    return res.json();
  }

  /** Click an element by CSS selector. Returns { success, element } */
  async click(selector) {
    const res = await fetch(`${this.baseUrl}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selector })
    });
    return res.json();
  }

  /** Extract all visible tweets from current page. Returns TweetObject[] */
  async extract() {
    const res = await fetch(`${this.baseUrl}/extract`, { method: 'POST' });
    return res.json();
  }

  /** Navigate to a URL. Returns { success } */
  async navigate(url) {
    const res = await fetch(`${this.baseUrl}/navigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    return res.json();
  }

  /** Search Twitter (triggers search UI interaction). Returns { success } */
  async search(query) {
    const res = await fetch(`${this.baseUrl}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    return res.json();
  }

  // ── Intelligence queries ───────────────────────────────────────────────────

  /** Get alerts filtered by priority. @param {'CRITICAL'|'HIGH'|'MEDIUM'|'LOW'|null} */
  async getAlerts(priority = null) {
    const url = priority
      ? `${this.baseUrl}/alerts?priority=${priority}`
      : `${this.baseUrl}/alerts`;
    const res = await fetch(url);
    return res.json();
  }

  /** Get the latest intelligence report. */
  async getReport() {
    const res = await fetch(`${this.baseUrl}/report`);
    return res.json();
  }

  /** Search previously analyzed tweets. @param {string} query */
  async searchTweets(query) {
    const res = await fetch(`${this.baseUrl}/search?q=${encodeURIComponent(query)}`);
    return res.json();
  }

  /** Get current relay status and stats. */
  async status() {
    const res = await fetch(`${this.baseUrl}/status`);
    return res.json();
  }
}

module.exports = { CohusdexClient };
```

---

## 11. Bot Evasion & Rate Limiting (`relay/bot-evasion.js`)

Referenced in the directory tree but never fully specified — this is the complete spec.

### Token Bucket Rate Limiter

```javascript
class TokenBucket {
  constructor(options = {}) {
    this.capacity = options.capacity || 40;        // max tokens
    this.refillRate = options.refillRate || 0.5;   // tokens per second
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  /** Try to consume N tokens. Returns true if allowed. */
  try(quantity = 1) {
    this._refill();
    if (this.tokens >= quantity) {
      this.tokens -= quantity;
      return true;
    }
    return false;
  }

  /** Wait until N tokens are available. */
  async waitFor(quantity = 1) {
    while (!this.try(quantity)) {
      await new Promise(r => setTimeout(r, 100));
      this._refill();
    }
  }
}

// Pre-configured limiters
const SCROLL_BUCKET = new TokenBucket({ capacity: 40, refillRate: 0.67 }); // ~40/min
const CLICK_BUCKET  = new TokenBucket({ capacity: 20, refillRate: 0.33 }); // ~20/min
const SCAN_BUCKET   = new TokenBucket({ capacity: 30, refillRate: 0.5 });  // ~30/min
```

### Behavioral Fingerprint Minimization

```javascript
const FINGERPRINT = {
  // Never scroll to exact same Y twice
  lastScrollY: null,
  
  // Randomize every action
  randomScrollY(targetY, jitter = 50) {
    if (targetY === this.lastScrollY) {
      targetY += (Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * jitter);
    }
    this.lastScrollY = targetY;
    return Math.round(targetY);
  },

  // Add pixel jitter to click coordinates
  jitterClick(x, y, jitter = 3) {
    return {
      x: x + Math.round((Math.random() - 0.5) * jitter * 2),
      y: y + Math.round((Math.random() - 0.5) * jitter * 2),
    };
  },

  // Vary timing with noise
  jitterDelay(baseMs, noiseFactor = 0.3) {
    const noise = (Math.random() - 0.5) * 2 * noiseFactor * baseMs;
    return Math.round(baseMs + noise);
  },

  // Occasional "mistake" — hover but don't click (5% chance)
  shouldFakeClick() {
    return Math.random() < 0.05;
  },

  // Random session start delay (500ms–3000ms)
  sessionStartDelay() {
    return 500 + Math.random() * 2500;
  },
};
```

---

## 12. Privacy & Data Retention Policy

> ⚠️ **Privacy gap flagged in review.** This section documents the required policy.

### What is captured
The relay captures GraphQL responses from `graphql.twitter.com` via `Network.responseReceived` events. This may include personal content (DMs, timeline data, followed accounts).

### Required filtering rules
```javascript
const PRIVACY_FILTER = {
  // Never store or analyze these GraphQL operations
  blockOperations: [
    'DirectMessageEvents',
    'DMConversationMessages',
    'UserProfileStripped',
    'Following',
    'Followers',
  ],
  
  // Anonymize before storage
  anonymizeFields: ['sessionToken', 'accountId', 'email', 'phone'],
  
  // Retention limits
  retention: {
    rawGraphQLResponses: '24h',   // delete after 24h
    analyzedTweetObjects: '90d',  // keep for 90 days
    alerts: '180d',               // keep for 180 days
    reports: 'permanent',         // keep reports indefinitely
  },
  
  // Never export raw GraphQL to external systems
  allowExport: ['tweetObjects', 'alerts', 'reports'],  // not raw network data
};
```

---

## 13. Reconciled Non-Functional Requirements

> ⚠️ **Reviewer flagged contradiction:** §8 said <10ms per action; ADDITIONAL_REQUIREMENTS said <50ms.  
> **Resolution:** Values below are the authoritative targets.

| Metric | Target | Notes |
|--------|--------|-------|
| CDP command latency (relay → Chrome) | <10ms | Local CDP WebSocket is fast |
| Scroll/click action latency (user-perceived) | <50ms | Network hop + CDP round-trip |
| Intelligence analysis per tweet | <200ms | Content analyzer speed |
| Report generation (1000 tweets) | <5s | Batched processing |
| Memory footprint (24h session) | <500MB | SQLite DB + in-memory state |
| Bot detection evasion | Pass Twitter heuristics | Human-like behavior active |
| Session continuity | 100% state recoverable | SQLite persist + bloom filter |

---

## 14. Placeholder Documentation (`docs/`)

These files are listed in the directory but not yet created — builder should create them:

### `docs/api-reference.md` — STUB
```
# API Reference (TBD)

[To be generated from actual server implementation]
```

### `docs/deployment.md` — STUB
```
# Deployment Guide (TBD)

## Local Development
1. Clone repository
2. `cd server && npm install`
3. Start Chrome: `google-chrome --remote-debugging-port=9222`
4. `node index.js`
5. Verify: `curl http://localhost:3131/status`

## Production
[TBD by builder]
```

---

*Addendum v1.1 — Gap fixes applied. Architecture now complete. Next: Builder Agent.*