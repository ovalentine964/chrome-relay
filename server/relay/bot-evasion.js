'use strict';

/**
 * Bot Evasion & Rate Limiting
 * Token bucket rate limiting + behavioral fingerprint minimization.
 */

class TokenBucket {
  constructor(options = {}) {
    this.capacity = options.capacity || 40;
    this.refillRate = options.refillRate || 0.5;
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  _refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  try(quantity = 1) {
    this._refill();
    if (this.tokens >= quantity) {
      this.tokens -= quantity;
      return true;
    }
    return false;
  }

  async waitFor(quantity = 1) {
    let attempts = 0;
    while (!this.try(quantity)) {
      await new Promise(r => setTimeout(r, 100));
      this._refill();
      if (++attempts > 600) throw new Error('Token bucket timeout (>60s)');
    }
  }

  available() {
    this._refill();
    return this.tokens;
  }
}

// Pre-configured buckets
const SCROLL_BUCKET = new TokenBucket({ capacity: 40, refillRate: 0.67 });
const CLICK_BUCKET  = new TokenBucket({ capacity: 20, refillRate: 0.33 });
const SCAN_BUCKET   = new TokenBucket({ capacity: 30, refillRate: 0.5 });

// ── Fingerprint Minimization ──────────────────────────────────────────────

const FINGERPRINT = {
  lastScrollY: null,
  clickHistory: [],

  randomScrollY(targetY, jitter = 50) {
    const j = (Math.random() - 0.5) * 2 * jitter;
    let y = Math.round(targetY + j);
    
    // Never scroll to exact same Y twice
    if (y === this.lastScrollY) {
      y += (Math.random() > 0.5 ? 1 : -1) * (10 + Math.round(Math.random() * jitter));
    }
    this.lastScrollY = y;
    return y;
  },

  jitterClick(x, y, jitter = 3) {
    return {
      x: x + Math.round((Math.random() - 0.5) * jitter * 2),
      y: y + Math.round((Math.random() - 0.5) * jitter * 2),
    };
  },

  jitterDelay(baseMs, noiseFactor = 0.3) {
    const noise = (Math.random() - 0.5) * 2 * noiseFactor * baseMs;
    return Math.round(baseMs + noise);
  },

  shouldFakeClick() {
    return Math.random() < 0.05; // 5% — hover but don't click
  },

  sessionStartDelay() {
    return 500 + Math.round(Math.random() * 2500); // 500ms-3000ms
  },

  // Random scroll speed within range
  scrollSpeed(base, variance = 0.3) {
    const factor = 1 + (Math.random() - 0.5) * 2 * variance;
    return Math.round(base * factor);
  },

  // Check if we should add a "thinking" pause before scrolling
  shouldPauseMidScroll() {
    return Math.random() < 0.2; // 20% chance
  },

  // Pause duration when mid-scroll
  midScrollPauseMs() {
    return 300 + Math.round(Math.random() * 500); // 300-800ms
  },

  // Should we scroll back up slightly (re-reading behavior)?
  shouldScrollBack() {
    return Math.random() < 0.15; // 15% chance
  },

  scrollBackAmount() {
    return 100 + Math.round(Math.random() * 300); // 100-400px
  },

  // Vary click delay with correlation to previous click
  clickDelay(baseDelay) {
    // Add slight correlation with last delay (human tends to settle into rhythms)
    const rhythm = this.clickHistory.slice(-3);
    if (rhythm.length >= 2) {
      const avg = rhythm.reduce((s, d) => s + d, 0) / rhythm.length;
      baseDelay = baseDelay * 0.7 + avg * 0.3;
    }
    const jittered = this.jitterDelay(baseDelay);
    this.clickHistory.push(jittered);
    if (this.clickHistory.length > 5) this.clickHistory.shift();
    return jittered;
  },

  // Check if click coordinates form a suspicious geometric pattern
  hasGeometricPattern(clicks) {
    if (clicks.length < 4) return false;
    const recent = clicks.slice(-4);
    const xDiffs = [], yDiffs = [];
    for (let i = 1; i < recent.length; i++) {
      xDiffs.push(Math.abs(recent[i].x - recent[i-1].x));
      yDiffs.push(Math.abs(recent[i].y - recent[i-1].y));
    }
    // Very regular spacing = suspicious
    const xVar = Math.max(...xDiffs) - Math.min(...xDiffs);
    const yVar = Math.max(...yDiffs) - Math.min(...yDiffs);
    return xVar < 5 && yVar < 5;
  },
};

async function checkScroll() {
  if (!SCROLL_BUCKET.try()) {
    await SCROLL_BUCKET.waitFor();
  }
}

async function checkClick() {
  if (!CLICK_BUCKET.try()) {
    await CLICK_BUCKET.waitFor();
  }
}

async function checkScan() {
  if (!SCAN_BUCKET.try()) {
    await SCAN_BUCKET.waitFor();
  }
}

module.exports = {
  TokenBucket,
  SCROLL_BUCKET,
  CLICK_BUCKET,
  SCAN_BUCKET,
  FINGERPRINT,
  checkScroll,
  checkClick,
  checkScan,
};