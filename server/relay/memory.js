/**
 * Memory Store — JSON file-based persistence
 * Replaces SQLite for portability (no native compilation required)
 * All methods are synchronous for simplicity.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class MemoryStore {
  constructor(dbPath) {
    this.dbPath = dbPath || '/tmp/cohusdex-relay-memory.json';
    this.data = { tweets: [], seenContent: new Map(), sessionState: new Map(), stats: { total: 0, byTopic: {} } };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
        this.data.tweets = raw.tweets || [];
        this.data.seenContent = new Map(raw.seenContent || []);
        this.data.sessionState = new Map(raw.sessionState || []);
        this.data.stats = raw.stats || { total: 0, byTopic: {} };
      }
    } catch (e) {
      // start fresh on corrupt file
    }
  }

  _save() {
    const payload = {
      tweets: this.data.tweets.slice(-5000), // cap at 5000 tweets
      seenContent: Array.from(this.data.seenContent.entries()),
      sessionState: Array.from(this.data.sessionState.entries()),
      stats: this.data.stats
    };
    fs.writeFileSync(this.dbPath, JSON.stringify(payload, null, 2));
  }

  get count() { return this.data.tweets.length; }

  // ── Tweet operations ──────────────────────────────────────────────
  isTweetSeen(tweet) {
    if (!tweet.id) return false;
    return this.data.seenContent.has(`tweet:${tweet.id}`);
  }

  _hash(content) {
    return crypto.createHash('sha256').update(content || '').digest('hex').slice(0, 16);
  }

  addTweet(tweet) {
    if (!tweet.id) return;
    if (this.data.seenContent.has(`tweet:${tweet.id}`)) return;

    const now = Date.now();
    const hash = this._hash(tweet.content || tweet.text || '');

    this.data.tweets.push({
      tweet_id: tweet.id,
      content: (tweet.content || tweet.text || '').slice(0, 10000),
      author: tweet.author || tweet.handle || 'unknown',
      timestamp: tweet.timestamp ? new Date(tweet.timestamp).getTime() : now,
      topics: tweet.topics || [],
      intent: tweet.intent || null,
      engagement_score: tweet.engagement_score || 0,
      added_at: now
    });

    this.data.seenContent.set(`tweet:${tweet.id}`, now);
    this.data.seenContent.set(`content:${hash}`, now);
    this.data.stats.total++;
  }

  addTweetBatch(tweets) {
    tweets.forEach(t => this.addTweet(t));
    this._save();
  }

  // ── Query ─────────────────────────────────────────────────────────
  getTweet(id) {
    return this.data.tweets.find(t => t.tweet_id === id) || null;
  }

  getTweetsByTopic(topic, limit = 50) {
    return this.data.tweets
      .filter(t => t.topics && t.topics.includes(topic))
      .slice(-limit);
  }

  getTweetsByHandle(handle, limit = 50) {
    return this.data.tweets
      .filter(t => t.author === handle)
      .slice(-limit);
  }

  getTweetsByIntent(intent, limit = 50) {
    return this.data.tweets
      .filter(t => t.intent === intent)
      .slice(-limit);
  }

  recentTweets(limit = 100) {
    return this.data.tweets.slice(-limit);
  }

  // ── Session state ──────────────────────────────────────────────────
  setSessionState(key, value) {
    this.data.sessionState.set(key, { value, updatedAt: Date.now() });
    this._save();
  }

  getSessionState(key, defaultValue = null) {
    const entry = this.data.sessionState.get(key);
    return entry ? entry.value : defaultValue;
  }

  getAllSessionState() {
    return Object.fromEntries(
      Array.from(this.data.sessionState.entries()).map(([k, v]) => [k, v.value])
    );
  }

  // ── Stats ──────────────────────────────────────────────────────────
  incrementTopic(topic) {
    this.data.stats.byTopic[topic] = (this.data.stats.byTopic[topic] || 0) + 1;
    this._save();
  }

  getStats() {
    return { ...this.data.stats };
  }

  // persist on every meaningful write
  save() { this._save(); }
}

module.exports = MemoryStore;