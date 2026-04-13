'use strict';

/**
 * Human Behavior Engine
 * Makes all interactions appear human — randomized timing, natural patterns, no bot fingerprints.
 */

const SCROLL_PROFILES = {
  read:    { speed: [20, 60],   pauseAfter: [800, 2000], variance: 0.4 },
  sweep:   { speed: [300, 800], pauseAfter: [200, 600],  variance: 0.3 },
  mixed:   { speed: [30, 700],  pauseAfter: [500, 3000], variance: 0.6 },
};

const CLICK_PROFILE = {
  hoverBeforeClick: [200, 500],   // ms
  betweenClicks:    [800, 3000],  // ms (max capped at 3000 per requirements)
  jitter: 0.3,
};

const DWELL_TIME = {
  short:   [1000, 3000],   // <100 chars
  medium:  [3000, 8000],   // 100-300 chars
  long:    [8000, 20000],  // 300-500 chars
  thread:  [15000, 45000], // >500 chars (thread reader)
};

const PROFILES = Object.keys(SCROLL_PROFILES);

// ── Randomization Helpers ───────────────────────────────────────────────────

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.round(rand(min, max));
}

function jitter(base, factor = 0.3) {
  return base + (Math.random() - 0.5) * 2 * factor * base;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function chance(prob) {
  return Math.random() < prob;
}

// ── Scroll Params ──────────────────────────────────────────────────────────

/**
 * Get randomized scroll params for a target Y.
 * Applies jitter, natural pause points, and scroll-back behavior.
 */
function getScrollParams(targetY, profile = 'mixed') {
  const cfg = SCROLL_PROFILES[profile] || SCROLL_PROFILES.mixed;
  
  // Jitter target Y
  const jitteredY = targetY + (Math.random() - 0.5) * cfg.variance * 100;
  
  // Sometimes scroll back up slightly (re-reading)
  const scrollBack = chance(0.2) ? randInt(100, 400) : 0;
  const actualY = Math.max(0, jitteredY - scrollBack);
  
  // Speed
  const speed = rand(cfg.speed[0], cfg.speed[1]);
  
  // Pause after
  const pauseAfter = rand(cfg.pauseAfter[0], cfg.pauseAfter[1]);
  pauseAfter += (Math.random() - 0.5) * cfg.variance * pauseAfter;
  
  return {
    y: Math.round(actualY),
    speed: Math.round(speed),
    pauseAfterMs: Math.round(pauseAfter),
    scrollBackPx: scrollBack,
    profile,
  };
}

/**
 * Generate a scroll sequence (multiple bursts) for deep browsing.
 */
function getScrollSequence(startY, endY, profile = 'mixed') {
  const cfg = SCROLL_PROFILES[profile] || SCROLL_PROFILES.mixed;
  const sequence = [];
  let currentY = startY;
  
  while (currentY < endY) {
    const burstSize = rand(cfg.speed[0], cfg.speed[1]) * rand(3, 8);
    const targetY = Math.min(currentY + burstSize, endY);
    const pauseAfter = rand(cfg.pauseAfter[0], cfg.pauseAfter[1]);
    
    // Random mid-scroll pause (natural)
    const hasMidPause = chance(0.3);
    const midPauseY = Math.round(currentY + burstSize / 2);
    
    sequence.push({
      y: Math.round(targetY),
      speed: rand(cfg.speed[0], cfg.speed[1]),
      pauseAfterMs: Math.round(pauseAfter),
      hasMidPause,
      midPauseY: hasMidPause ? midPauseY : null,
      midPauseMs: hasMidPause ? rand(300, 800) : 0,
    });
    
    currentY = targetY;
  }
  
  return sequence;
}

// ── Click Params ───────────────────────────────────────────────────────────

/**
 * Get randomized click timing for an element click.
 */
function getClickParams(selector) {
  const hoverDelay = rand(CLICK_PROFILE.hoverBeforeClick[0], CLICK_PROFILE.hoverBeforeClick[1]);
  const betweenDelay = rand(CLICK_PROFILE.betweenClicks[0], CLICK_PROFILE.betweenClicks[1]);
  
  return {
    selector,
    hoverDelayMs: Math.round(jitter(hoverDelay, CLICK_PROFILE.jitter)),
    clickDelayMs: Math.round(jitter(betweenDelay, CLICK_PROFILE.jitter)),
    fakeClick: chance(0.05), // 5% — hover but don't click (human "hesitation")
  };
}

// ── Dwell Time ─────────────────────────────────────────────────────────────

/**
 * Get reading dwell time based on content length.
 */
function getDwellTime(contentLength) {
  let tier;
  if (contentLength < 100) tier = DWELL_TIME.short;
  else if (contentLength < 300) tier = DWELL_TIME.medium;
  else if (contentLength < 500) tier = DWELL_TIME.long;
  else tier = DWELL_TIME.thread;
  
  const base = rand(tier[0], tier[1]);
  return Math.round(jitter(base, 0.2));
}

// ── Session Patterns ───────────────────────────────────────────────────────

/**
 * Get session start delay (random wait before first interaction).
 */
function sessionStartDelay() {
  return randInt(500, 3000);
}

/**
 * Check if session should be in low-activity mode (night pattern).
 */
function isLowActivityMode() {
  const hour = new Date().getHours();
  // 23:00 - 06:00 = low activity
  return hour >= 23 || hour < 6;
}

/**
 * Get activity modifier based on time of day.
 * Returns 0.0 (dead) to 1.0 (full activity)
 */
function activityLevel() {
  const hour = new Date().getHours();
  if (hour >= 23 || hour < 6) return 0.3; // Night — minimal activity
  if (hour >= 6 && hour < 8) return 0.6;  // Early morning — ramping up
  if (hour >= 8 && hour < 18) return 1.0; // Day — full activity
  if (hour >= 18 && hour < 21) return 0.8; // Evening — tapering
  return 0.5; // Late night
}

/**
 * Get maximum continuous session duration (minutes).
 * After this, insert a break.
 */
function sessionBreakInterval() {
  return randInt(30, 50); // 30-50 minutes
}

/**
 * Get break duration (minutes).
 */
function sessionBreakDuration() {
  return randInt(5, 15); // 5-15 minutes
}

// ── All Randomization in One ───────────────────────────────────────────────

/**
 * Get a complete randomized action timing bundle.
 * Use for any interaction that needs human-like timing.
 */
function getActionTiming(actionType = 'scroll') {
  if (actionType === 'scroll') {
    return {
      delayMs: randInt(50, 200),
      jitter: Math.random() * 0.3,
    };
  }
  if (actionType === 'click') {
    return {
      hoverDelayMs: randInt(CLICK_PROFILE.hoverBeforeClick[0], CLICK_PROFILE.hoverBeforeClick[1]),
      betweenMs: randInt(CLICK_PROFILE.betweenClicks[0], CLICK_PROFILE.betweenClicks[1]),
      jitter: Math.random() * 0.3,
    };
  }
  if (actionType === 'type') {
    return {
      perCharMs: rand(50, 150),
      jitter: Math.random() * 0.2,
    };
  }
  return { delayMs: randInt(100, 500), jitter: 0.3 };
}

module.exports = {
  SCROLL_PROFILES,
  CLICK_PROFILE,
  DWELL_TIME,
  getScrollParams,
  getScrollSequence,
  getClickParams,
  getDwellTime,
  sessionStartDelay,
  isLowActivityMode,
  activityLevel,
  sessionBreakInterval,
  sessionBreakDuration,
  getActionTiming,
  rand,
  randInt,
  jitter,
};