'use strict';

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const DATA_DIR = '/home/valentinetech/.openclaw/workspace/chrome-relay/server/data';
const DB_PATH = path.join(DATA_DIR, 'insights.db');

/**
 * Memory & Continuity Layer
 * SQLite knowledge base + bloom filter dedup + session persistence.
 */

// ── Bloom Filter (simple string hash set) ──────────────────────────────────

class BloomFilter {
  constructor(capacity = 1000000) {
    this.size = Math.ceil(capacity * 1.5); // ~1.5M bits = ~187KB
    this.bits = Buffer.alloc(Math.ceil(this.size / 8));
    this.count = 0;
  }

  _hash(str) {
    // Multiple hash functions for bloom filter
    const h1 = crypto.createHash('md5').update(str).digest('bigint') % this.size;
    const h2 = crypto.createHash('sha1').update(str).digest('bigint') % this.size;
    const h3 = crypto.createHash('sha256').update(str).digest('bigint') % this.size;
    return [Number(h1), Number(h2), Number(h3)];
  }

  add(str) {
    if (this.has(str)) return false;
    this._hash(str).forEach(idx => {
      this.bits[Math.floor(idx / 8)] |= (1 << (idx % 8));
    });
    this.count++;
    return true;
  }

  has(str) {
    return this._hash(str).every(idx => 
      (this.bits[Math.floor(idx / 8)] & (1 << (idx % 8))) !== 0
    );
  }

  get count() { return this.count; }
}

// ── Memory (SQLite) ────────────────────────────────────────────────────────

class Memory {
  constructor(dbPath = DB_PATH) {
    require('fs').mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._initSchema();
    this.bloom = new BloomFilter();
    this._loadBloomFromDB();
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tweets (
        tweet_id TEXT PRIMARY KEY,
        author_handle TEXT,
        text TEXT,
        timestamp INTEGER,
        sentiment TEXT,
        sentiment_score REAL,
        topics TEXT,
        engagement_likes INTEGER DEFAULT 0,
        engagement_retweets INTEGER DEFAULT 0,
        insight_score REAL DEFAULT 0,
        analyzed_at INTEGER,
        first_seen_at INTEGER,
        last_updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS alerts (
        alert_id TEXT PRIMARY KEY,
        tweet_id TEXT,
        priority TEXT,
        topic TEXT,
        summary TEXT,
        created_at INTEGER,
        acknowledged INTEGER DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS trends (
        topic TEXT PRIMARY KEY,
        velocity REAL,
        direction TEXT,
        first_detected_at INTEGER,
        last_updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS session_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS seen_content (
        content_hash TEXT PRIMARY KEY,
        tweet_id TEXT,
        seen_at INTEGER
      );
      
      CREATE INDEX IF NOT EXISTS idx_tweets_topics ON tweets(topics);
      CREATE INDEX IF NOT EXISTS idx_tweets_timestamp ON tweets(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tweets_sentiment ON tweets(sentiment);
      CREATE INDEX IF NOT EXISTS idx_tweets_author ON tweets(author_handle);
      CREATE INDEX IF NOT EXISTS idx_alerts_priority ON alerts(priority);
    `);
  }

  _loadBloomFromDB() {
    const rows = this.db.prepare('SELECT content_hash FROM seen_content').all();
    rows.forEach(row => this.bloom.add(row.content_hash));
  }

  // ── Tweets ───────────────────────────────────────────────────────────────

  saveTweet(tweet) {
    const hash = this._contentHash(tweet.id, tweet.text || '');
    
    // Bloom filter check
    if (!this.bloom.add(hash)) {
      return false; // Already seen
    }

    const now = Date.now();
    const existing = this.db.prepare('SELECT tweet_id FROM tweets WHERE tweet_id = ?').get(tweet.id);
    
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO tweets 
      (tweet_id, author_handle, text, timestamp, sentiment, sentiment_score, topics,
       engagement_likes, engagement_retweets, insight_score, analyzed_at, first_seen_at, last_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      tweet.id,
      tweet.author?.handle || null,
      tweet.text || '',
      tweet.timestamp ? new Date(tweet.timestamp).getTime() : null,
      tweet.sentiment || null,
      tweet.sentimentScore || 0,
      JSON.stringify(tweet.topics || []),
      tweet.engagement?.likes || 0,
      tweet.engagement?.retweets || 0,
      tweet.insightScore || 0,
      now,
      existing ? null : now,
      now
    );

    // Also record hash
    this.db.prepare('INSERT OR IGNORE INTO seen_content (content_hash, tweet_id, seen_at) VALUES (?, ?, ?)')
      .run(hash, tweet.id, now);

    return true;
  }

  saveTweetBatch(tweets) {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO tweets 
      (tweet_id, author_handle, text, timestamp, sentiment, sentiment_score, topics,
       engagement_likes, engagement_retweets, insight_score, analyzed_at, first_seen_at, last_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = this.db.transaction((tweets) => {
      tweets.forEach(tweet => {
        const hash = this._contentHash(tweet.id, tweet.text || '');
        if (!this.bloom.add(hash)) return;
        insert.run(
          tweet.id, tweet.author?.handle || null, tweet.text || '',
          tweet.timestamp ? new Date(tweet.timestamp).getTime() : null,
          tweet.sentiment || null, tweet.sentimentScore || 0,
          JSON.stringify(tweet.topics || []),
          tweet.engagement?.likes || 0, tweet.engagement?.retweets || 0,
          tweet.insightScore || 0, Date.now(), Date.now(), Date.now()
        );
      });
    });
    insertMany(tweets);
  }

  getTweet(id) {
    const row = this.db.prepare('SELECT * FROM tweets WHERE tweet_id = ?').get(id);
    return row ? this._rowToTweet(row) : null;
  }

  getTweetsByTopic(topic, limit = 50) {
    const rows = this.db.prepare(
      'SELECT * FROM tweets WHERE topics LIKE ? ORDER BY timestamp DESC LIMIT ?'
    ).all(`%${topic}%`, limit);
    return rows.map(r => this._rowToTweet(r));
  }

  getTweetsByHandle(handle, limit = 50) {
    const rows = this.db.prepare(
      'SELECT * FROM tweets WHERE author_handle = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(handle, limit);
    return rows.map(r => this._rowToTweet(r));
  }

  searchTweets(query, limit = 50) {
    const rows = this.db.prepare(
      'SELECT * FROM tweets WHERE text LIKE ? ORDER BY timestamp DESC LIMIT ?'
    ).all(`%${query}%`, limit);
    return rows.map(r => this._rowToTweet(r));
  }

  _rowToTweet(row) {
    return {
      id: row.tweet_id,
      author: { handle: row.author_handle },
      text: row.text,
      timestamp: row.timestamp ? new Date(row.timestamp).toISOString() : null,
      sentiment: row.sentiment,
      sentimentScore: row.sentiment_score,
      topics: JSON.parse(row.topics || '[]'),
      engagement: { likes: row.engagement_likes, retweets: row.engagement_retweets },
      insightScore: row.insight_score,
      analyzedAt: row.analyzed_at ? new Date(row.analyzed_at).toISOString() : null,
    };
  }

  // ── Session State ────────────────────────────────────────────────────────

  set(key, value) {
    this.db.prepare(`
      INSERT OR REPLACE INTO session_state (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(key, JSON.stringify(value), Date.now());
  }

  get(key, defaultValue = null) {
    const row = this.db.prepare('SELECT value FROM session_state WHERE key = ?').get(key);
    if (!row) return defaultValue;
    try { return JSON.parse(row.value); } catch { return row.value; }
  }

  getSessionState() {
    const rows = this.db.prepare('SELECT * FROM session_state').all();
    const state = {};
    rows.forEach(r => {
      try { state[r.key] = JSON.parse(r.value); } catch { state[r.key] = r.value; }
    });
    return state;
  }

  // ── Trends ──────────────────────────────────────────────────────────────

  updateTrend(topic, velocity, direction) {
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO trends (topic, velocity, direction, last_updated_at)
      VALUES (?, ?, ?, ?)
    `).run(topic, velocity, direction, now);
  }

  getTrends() {
    return this.db.prepare('SELECT * FROM trends ORDER BY velocity DESC').all();
  }

  // ── Alerts ───────────────────────────────────────────────────────────────

  saveAlert(alert) {
    this.db.prepare(`
      INSERT OR REPLACE INTO alerts (alert_id, tweet_id, priority, topic, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(alert.id || `alert-${Date.now()}`, alert.tweet_id || null, alert.priority, 
           alert.topic, alert.summary, Date.now());
  }

  getAlerts(priority = null, limit = 50) {
    if (priority) {
      return this.db.prepare(
        'SELECT * FROM alerts WHERE priority = ? ORDER BY created_at DESC LIMIT ?'
      ).all(priority, limit);
    }
    return this.db.prepare(
      'SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?'
    ).all(limit);
  }

  acknowledgeAlert(alertId) {
    this.db.prepare('UPDATE alerts SET acknowledged = 1 WHERE alert_id = ?').run(alertId);
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  _contentHash(tweetId, text) {
    const str = `${tweetId}:${text}`;
    return crypto.createHash('md5').update(str).digest('hex');
  }

  close() {
    this.db.close();
  }

  export() {
    return {
      tweets: this.db.prepare('SELECT * FROM tweets ORDER BY timestamp DESC LIMIT 1000').all(),
      alerts: this.db.prepare('SELECT * FROM alerts ORDER BY created_at DESC').all(),
      trends: this.getTrends(),
      sessionState: this.getSessionState(),
    };
  }
}

module.exports = { Memory, BloomFilter };