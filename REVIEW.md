# Architecture Review — Browser Relay
**Reviewer:** Reviewer Agent SDLC  
**Date:** 2026-04-12  
**Status:** Needs rework — 7 gaps identified

---

## 1. Review Summary

The architecture is well-structured and the core design philosophy (CDP-direct, semantic layer, human-like behavior, intelligence-first) is sound. The "what" and "why" are solid. However, there are 7 gaps that must be addressed before the builder can implement correctly — most are **implementation-specification gaps**, not design gaps. One is a **critical technical flaw**: the MV3 extension background service worker cannot maintain indefinite WebSocket connections and will be killed by Chrome.

---

## 2. Coverage Analysis

### From ADDITIONAL_REQUIREMENTS.md:

| Requirement | Architecture Status | Notes |
|-------------|---------------------|-------|
| Human-like scroll (variable speed, pause, scroll-back) | Covered | §3.3, SCROLL_PROFILES defined |
| Hover-before-click (200-500ms) | Partial | §3.3 CLICK_PROFILE says hoverBeforeClick defined — but value inconsistent with requirements (requirements say 200-500ms, architecture allows up to 4000ms) |
| Reading dwell time by content length | Covered | §3.3 DWELL_TIME defined |
| Session jitter/randomization | Covered | §3.3 + §4 |
| Real-time sentiment, topic, entity extraction | Covered | §3.4 |
| Trend pre-detection (before it trends) | Missing | Mentioned in §3.4 but never defined as a component or algorithm |
| Thread mapping (conversation graphs) | Missing | Referenced in §3.4 "Thread Mapper" but no implementation spec — no data model, no algorithm |
| Engagement velocity (likes/min) | Covered | Mentioned in §3.4 |
| Anomaly detection (bot networks, coordinated posting) | Partial | Described in §3.4 but not specified as a component with rules |
| Insight scoring formula | Partial | Formula in §3.4 omits `editHistory` and `followerRatio` from requirements |
| Credibility scoring | Partial | Missing `editHistory` and `followerRatio` factors |
| Real-time alerts (CRITICAL/HIGH/MEDIUM/LOW) | Covered | §3.4 Alert priority levels defined |
| Periodic reports (markdown + JSON) | Covered | §3.5 output formats defined |
| Cohusdex agent JSON packets | Missing | Referenced in §3.5 but `CohusdexClient` never defined, no packet format spec |
| Founder digest (5 bullets max) | Covered | §3.5 digest.md format defined |
| SQLite knowledge base | Covered | §3.6 schema defined |
| Bloom filter (dedup) | Covered | §3.6 Bloom filter mentioned |
| Session persistence | Covered | §3.6 session state defined |
| Non-functional latency targets | Contradiction | §8 says <10ms per action; ADDITIONAL_REQUIREMENTS says <50ms per action — must reconcile |

### From research-findings.md:

| Research Requirement | Architecture Status | Notes |
|---------------------|---------------------|-------|
| CDP-direct (no Playwright) | Covered | §3.1, explicitly rejects Playwright |
| DOM.push events (MutationObserver) | Covered | §3.1 CDP event subscriptions |
| Semantic Twitter layer | Covered | §3.2 TweetObject model |
| GraphQL response capture | Partial | §3.2 mentions it, but not specified as a component |
| Stateful relay | Covered | §3.1 in-memory Map state |
| Bot detection evasion | Partial | §4 lists concepts but `bot-evasion.js` not defined as component |
| Chrome Extension MV3 | Critical Issue | §3.7 has design — but MV3 service worker limitation not addressed |

---

## 3. Critical Issue: MV3 Service Worker WebSocket Kill

**Problem:** Chrome Manifest V3 service workers are **terminated after ~30 seconds of inactivity**. They cannot maintain persistent WebSocket connections. The background.js architecture in §3.7 assumes a long-running background script — this will be killed by Chrome, breaking the relay bridge between the content script and the relay server.

**Impact:** The entire Chrome Extension approach (Option B in §7) will not work reliably.

**Fix options (must choose one):**
1. **Use `chrome.storage.session`** + periodic wake-ups — complicated, still unreliable
2. **Use `chrome.runtime.connect` with a native host binary** — most reliable but requires installing a native app
3. **Use `chrome.alarms` + `fetch` polling instead of WebSocket** — works but higher latency
4. **Drop extension approach, use CDP-direct only** — simplest, most reliable (user starts Chrome with `--remote-debugging-port=9222`)

**Recommendation:** Document this explicitly in the architecture and choose Option 4 as primary, with Option 2 as the advanced installation path for users who want seamless extension injection.

---

## 4. Gaps Identified

### Gap 1: Thread Mapping — Not Specified
No data model for conversation graphs. No algorithm for detecting reply chains, quote chains, or quote-tweet chains. No spec for identifying "key actors" in threads.
**Where to add:** New section §3.4.x in Intelligence Analysis Engine

### Gap 2: Trend Pre-Detection Algorithm — Not Defined
"Detect emerging topics before they appear in What's Happening" is described as a goal but no algorithm specified.
**Where to add:** §3.4 Trend Detection subsection

### Gap 3: CohusdexClient — Never Defined
Referenced in §7 but no class definition, no API, no client protocol.
**Where to add:** New section §3.10 or a `client/cohusdex-client.js` spec

### Gap 4: Latency Target Contradiction
§8 says <10ms per action. ADDITIONAL_REQUIREMENTS says <50ms per scroll action. These must be reconciled.
**Fix:** Align to <50ms for scroll/click (realistic for CDP over network), <200ms for intelligence analysis

### Gap 5: Click Timing Limit
Architecture allows 4000ms max between clicks. ADDITIONAL_REQUIREMENTS says 3000ms max.
**Fix:** Cap at 3000ms in §3.3

### Gap 6: Credibility Scoring Incomplete
Formula omits `editHistory` and `followerRatio` specified in requirements.
**Fix:** Update credibilityScore formula in §3.4:
```
credibilityScore = (verified ? 1 : 0) * 0.25
  + log10(followers+1) / 10 * 0.25
  + accountAgeYears / 10 * 0.2
  + followerRatio * 0.15        // NEW: followers/following ratio
  + (hasEditHistory ? 0.15 : 0) // NEW: account has edited tweets
```

### Gap 7: bot-evasion.js in Directory But No Spec
Listed in §6 directory tree but never described as a standalone component.
**Fix:** Add brief component spec in §4 or elevate to §3.9

---

## 5. Feasibility Assessment

| Decision | Feasibility | Notes |
|----------|-------------|-------|
| CDP-direct via chrome-remote-interface | ✅ Feasible | Well-supported, stable |
| WebSocket relay on port 3131 | ✅ Feasible | Standard Node.js ws |
| SQLite via better-sqlite3 | ✅ Feasible | Synchronous, fast, FTS5 supported |
| MutationObserver for real-time DOM | ✅ Feasible | Works in content script |
| GraphQL response parsing from Network events | ✅ Feasible | CDP Network domain exposes this |
| MV3 extension as primary relay | ❌ Not feasible | Service worker kills WebSocket after 30s |
| Human-like scroll with jitter | ✅ Feasible | Well-defined random distributions |
| Thread mapping algorithm | ⚠️ Complex | Requires graph data structure, Twitter doesn't make thread context easy |

---

## 6. Recommendations

### Must Fix Before Builder:
1. **MV3 WebSocket issue** — Explicitly document the limitation and provide a working alternative (CDP-direct as primary, native host binary as advanced)
2. **Thread mapping spec** — Add data model and algorithm (or defer to builder with clear guidance)
3. **CohusdexClient spec** — Define the client API that agents will use
4. **Reconcile contradictions** — Align latency targets and timing limits with ADDITIONAL_REQUIREMENTS
5. **Complete credibility scoring** — Add followerRatio and editHistory to formula

### Should Fix Before Builder:
6. **Trend pre-detection algorithm** — Define how acceleration is measured (hashtag velocity over time)
7. **bot-evasion.js component spec** — Either describe it in §4 or move it to a proper §3.9
8. **Create placeholder docs/** — api-reference.md and deployment.md can be stubs for now

### Nice to Have:
9. GraphQL analyzer as a named sub-component in §3.2

---

## 7. Verdict

**Architecture passes with conditions.** The core design is correct and buildable. The 7 gaps above must be addressed before the builder starts — especially the MV3 WebSocket issue which would make the extension completely non-functional.

**Estimated rework time:** Low — most gaps are additions/clarifications, not redesigns. The MV3 fix is a documentation change (switching to CDP-direct as primary). The thread mapping and CohusdexClient specs are net-new additions of ~200 lines each.

---

*Review complete. Next: Address gaps → Builder Agent.*