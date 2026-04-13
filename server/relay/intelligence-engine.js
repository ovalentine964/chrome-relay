'use strict';

const { EventEmitter } = require('events');

/**
 * Intelligence Analysis Engine
 * Real-time content analysis: sentiment, topics, entities, trends, anomalies, insight scoring.
 */

// ── Topic Classification Keywords ──────────────────────────────────────────

const TOPIC_KEYWORDS = {
  AI: ['AGI', 'LLM', 'GPT', 'Claude', 'artificial general intelligence', 'frontier model', 
       'AI agent', 'agentic AI', 'multi-agent', 'LangChain', 'LlamaIndex', 'OpenAI', 
       'Anthropic', 'DeepMind', 'xAI', 'quantum computing', 'quantum advantage',
       'model scaling', 'reasoning benchmark', 'AI safety', 'alignment', 'NVIDIA Blackwell',
       'AMD MI350', 'custom silicon', 'Mistral', 'Llama', 'Gemma', 'Gemini'],
  governance: ['IEBC', 'election', 'governor', 'senator', 'MP', 'parliament', 'county assembly',
               'referendum', 'constitutional', 'IEA', 'NSC', 'Elections', 'ballot', 'vote'],
  politics: ['Ruto', 'Gachagua', 'Azimio', 'Kenya Kwanza', 'president', 'political succession',
             'opposition', 'coalition', 'party', 'campaign', 'candidate', 'manifesto'],
  finance: ['budget', 'KRA', 'IMF', 'World Bank', 'debt', 'tax', 'expenditure', 'fiscal',
            'recurrent', 'development', 'appropriation', ' Controller of Budget', 'CoB',
            'public debt', 'external borrowing', 'pension', 'salary', 'SWE'],
  corruption: ['EACC', 'bribery', 'embezzlement', 'scandal', 'tender fraud', 'loot',
               'illicit wealth', 'misappropriation', ' DPP', 'Director of Public Prosecutions',
               'arrest', 'corrupt', 'Ethics and Anti-Corruption', 'procurement scandal'],
  business: ['startup', 'funding', 'Series A', 'Series B', 'IPO', 'investment', 'acquisition',
             'merger', 'dividend', 'profit warning', 'RTO', 'SPAC', 'greenfield', 'brownfield',
             'market gap', 'opportunity', 'NSE', 'Nairobi Securities Exchange'],
  election: ['vote', 'ballot', 'candidate', 'IEBC', 'election 2027', 'political succession',
             'Ruto', 'Gachagua', 'Azimio', 'Kenya Kwanza', 'post-election', 'electoral',
             'constituency', 'MP', 'whip'],
  fiscal_policy: ['budget', 'taxation', 'revenue', 'fiscal deficit', 'supplementary budget',
                  'expenditure', 'development budget', 'recurrent', 'appropriation',
                  ' Controller of Budget', 'IFMIS', 'PPIP', 'public private partnership'],
  crime: ['murder', 'theft', 'robbery', 'kidnap', 'arrest', 'police', 'crime', 'gang'],
};

const POSITIVE_SENTIMENT = ['great', 'good', 'excellent', 'amazing', 'wonderful', 'best', 'success', 'win', 'profit', 'growth', 'improve', 'innovative', 'breakthrough'];
const NEGATIVE_SENTIMENT = ['bad', 'poor', 'fail', 'corrupt', 'scandal', 'crisis', 'loss', 'debt', 'problem', 'pain', 'broken', 'crash', 'fraud', 'crime', 'murder', 'violence', 'death'];

// ── Content Analyzer ───────────────────────────────────────────────────────

class ContentAnalyzer {
  analyze(text) {
    if (!text || typeof text !== 'string') {
      return { sentiment: 'neutral', sentimentScore: 0.5, topics: [], entities: {} };
    }
    const lower = text.toLowerCase();
    
    // Sentiment
    let positiveCount = 0, negativeCount = 0;
    POSITIVE_SENTIMENT.forEach(w => { if (lower.includes(w)) positiveCount++; });
    NEGATIVE_SENTIMENT.forEach(w => { if (lower.includes(w)) negativeCount++; });
    
    const total = positiveCount + negativeCount;
    let sentiment = 'neutral';
    let sentimentScore = 0.5;
    if (total > 0) {
      sentimentScore = total > 0 ? positiveCount / total : 0.5;
      sentiment = sentimentScore > 0.6 ? 'positive' : sentimentScore < 0.4 ? 'negative' : 'neutral';
    }
    
    // Topic classification (multi-label)
    const topics = [];
    Object.entries(TOPIC_KEYWORDS).forEach(([topic, keywords]) => {
      const matchCount = keywords.filter(k => lower.includes(k.toLowerCase())).length;
      if (matchCount > 0) topics.push(topic);
    });
    
    // If no topics matched, tag as 'other'
    if (topics.length === 0) topics.push('other');
    
    // Entities
    const entities = {
      hashtags: (text.match(/#\w+/g) || []),
      mentions: (text.match(/@\w+/g) || []),
      urls: (text.match(/https?:\/\/[^\s]+/g) || []),
      money: (text.match(/KSh\s*[\d,]+|KES\s*[\d,]+|\$[\d,]+/gi) || []),
      people: this._extractPeople(text),
    };
    
    return { sentiment, sentimentScore, topics, entities };
  }
  
  _extractPeople(text) {
    // Capitalized word pairs that aren't at sentence start (simple heuristic)
    const words = text.split(/\s+/);
    const people = [];
    for (let i = 1; i < words.length; i++) {
      if (/^[A-Z][a-z]+$/.test(words[i]) && /^[A-Z][a-z]+$/.test(words[i-1])) {
        people.push(words[i-1] + ' ' + words[i]);
      }
    }
    return [...new Set(people)].slice(0, 10);
  }
}

// ── Trend Detector ─────────────────────────────────────────────────────────

class TrendDetector {
  constructor() {
    this.topicWindows = new Map(); // topic → array of { time, count }
    this.WINDOW_MS = 5 * 60 * 1000; // 5-minute window
    this.TREND_THRESHOLD = 1.5; // tweets per minute
    this.ACCELERATION_WINDOW = 30 * 60 * 1000; // 30 min for velocity comparison
  }

  record(topic, tweetCount = 1) {
    const now = Date.now();
    if (!this.topicWindows.has(topic)) {
      this.topicWindows.set(topic, []);
    }
    this.topicWindows.get(topic).push({ time: now, count: tweetCount });
    this._prune(topic, now);
  }

  _prune(topic, now) {
    const cutoff = now - this.ACCELERATION_WINDOW * 2;
    const arr = this.topicWindows.get(topic);
    this.topicWindows.set(topic, arr.filter(w => w.time > cutoff));
  }

  getVelocity(topic) {
    this._prune(topic, Date.now());
    const windows = this.topicWindows.get(topic) || [];
    if (windows.length === 0) return 0;
    
    const now = Date.now();
    const recent = windows.filter(w => now - w.time < this.WINDOW_MS * 2);
    if (recent.length === 0) return 0;
    
    const totalCount = recent.reduce((sum, w) => sum + w.count, 0);
    return totalCount / (this.WINDOW_MS * 2 / 60000); // tweets per minute
  }

  isTrending(topic) {
    return this.getVelocity(topic) >= this.TREND_THRESHOLD;
  }

  getDirection(topic) {
    const now = Date.now();
    const recent = (this.topicWindows.get(topic) || [])
      .filter(w => now - w.time < this.WINDOW_MS * 2);
    const older = (this.topicWindows.get(topic) || [])
      .filter(w => now - w.time >= this.WINDOW_MS * 2 && now - w.time < this.ACCELERATION_WINDOW);
    
    const recentVel = recent.reduce((s, w) => s + w.count, 0) / 10; // per min
    const olderVel = older.reduce((s, w) => s + w.count, 0) / 30; // per min
    
    if (recentVel > olderVel * 1.5) return 'rising';
    if (recentVel < olderVel * 0.5) return 'falling';
    return 'stable';
  }

  getTrendingTopics(limit = 10) {
    const trending = [];
    this.topicWindows.forEach((_, topic) => {
      if (this.isTrending(topic)) {
        trending.push({
          topic,
          velocity: this.getVelocity(topic),
          direction: this.getDirection(topic),
        });
      }
    });
    trending.sort((a, b) => b.velocity - a.velocity);
    return trending.slice(0, limit);
  }

  recordTweet(tweet) {
    if (tweet.topics) {
      tweet.topics.forEach(t => this.record(t, 1));
    }
    if (tweet.hashtags) {
      tweet.hashtags.forEach(h => this.record(h, 0.5));
    }
  }
}

// ── Thread Mapper ──────────────────────────────────────────────────────────

class ThreadMapper {
  constructor() {
    this.threads = new Map(); // rootTweetId → ThreadGraph
    this.tweetToThread = new Map(); // tweetId → rootTweetId
  }

  addTweet(tweet) {
    if (!tweet.id) return;
    
    if (tweet.isReply && tweet.threadId) {
      // Attach to existing thread
      const rootId = this.tweetToThread.get(tweet.threadId) || tweet.threadId;
      if (!this.threads.has(rootId)) {
        this.threads.set(rootId, { rootTweetId: rootId, nodes: new Map(), edges: [], keyActors: [], depth: 0 });
      }
      const thread = this.threads.get(rootId);
      thread.nodes.set(tweet.id, { tweet, role: 'responder', timestamp: tweet.timestamp });
      this.tweetToThread.set(tweet.id, rootId);
      // Update depth
      const depth = this._calcDepth(rootId);
      thread.depth = depth;
      // Update key actors
      thread.keyActors = this._getKeyActors(thread);
    } else if (!tweet.isReply) {
      // New root tweet / thread
      this.threads.set(tweet.id, {
        rootTweetId: tweet.id,
        nodes: new Map([[tweet.id, { tweet, role: 'OP', timestamp: tweet.timestamp }]]),
        edges: [],
        keyActors: [{ handle: tweet.author?.handle, score: 0 }],
        depth: 0,
      });
      this.tweetToThread.set(tweet.id, tweet.id);
    }
  }

  _calcDepth(rootId) {
    const thread = this.threads.get(rootId);
    if (!thread) return 0;
    let maxDepth = 0;
    thread.nodes.forEach(node => {
      // Simple depth heuristic based on edge count
    });
    return maxDepth;
  }

  _getKeyActors(thread) {
    const actorScores = new Map();
    thread.nodes.forEach(node => {
      const handle = node.tweet.author?.handle;
      if (!handle) return;
      const score = (node.tweet.engagement?.likes || 0) + (node.tweet.engagement?.retweets || 0);
      actorScores.set(handle, (actorScores.get(handle) || 0) + score);
    });
    return Array.from(actorScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([handle, score]) => ({ handle, score }));
  }

  getThread(rootTweetId) {
    return this.threads.get(rootTweetId);
  }

  addGraphQLThread(entries) {
    entries.forEach(entry => {
      if (entry.content?.item?.tweet) {
        const tweet = entry.content.item.tweet;
        // Parse and add
      }
    });
  }
}

// ── Anomaly Detector ───────────────────────────────────────────────────────

class AnomalyDetector {
  constructor() {
    this.authorHistory = new Map(); // handle → { likes: [], timestamps: [] }
    this.hashtagWindows = new Map(); // hashtag → [{ time, handle }]
    this.accountCreationTimes = new Map(); // handle → timestamp
  }

  recordTweet(tweet) {
    const handle = tweet.author?.handle;
    if (!handle) return;

    // Record engagement
    if (!this.authorHistory.has(handle)) {
      this.authorHistory.set(handle, { likes: [], timestamps: [] });
    }
    const history = this.authorHistory.get(handle);
    history.likes.push({ count: tweet.engagement?.likes || 0, time: Date.now() });
    history.timestamps.push(Date.now());
    
    // Prune old
    const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
    history.likes = history.likes.filter(l => l.time > cutoff);
    history.timestamps = history.timestamps.filter(t => t > cutoff);

    // Record hashtag coordination
    if (tweet.hashtags) {
      tweet.hashtags.forEach(tag => {
        if (!this.hashtagWindows.has(tag)) {
          this.hashtagWindows.set(tag, []);
        }
        this.hashtagWindows.get(tag).push({ time: Date.now(), handle });
      });
      // Prune old hashtag entries
      this.hashtagWindows.forEach((entries, tag) => {
        this.hashtagWindows.set(tag, entries.filter(e => Date.now() - e.time < 10 * 60 * 1000));
      });
    }
  }

  isEngagementSpike(handle, currentLikes) {
    const history = this.authorHistory.get(handle);
    if (!history || history.likes.length < 3) return false;
    
    const avg = history.likes.reduce((s, l) => s + l.count, 0) / history.likes.length;
    const stddev = Math.sqrt(
      history.likes.reduce((s, l) => s + Math.pow(l.count - avg, 2), 0) / history.likes.length
    );
    if (stddev === 0) return false;
    return currentLikes > avg + 3 * stddev;
  }

  isCoordinatedPosting(hashtag, windowMin = 10, threshold = 5) {
    const entries = this.hashtagWindows.get(hashtag) || [];
    const recent = entries.filter(e => Date.now() - e.time < windowMin * 60 * 1000);
    const uniqueHandles = new Set(recent.map(e => e.handle));
    return uniqueHandles.size >= threshold;
  }

  isBotSignal(tweet) {
    const handle = tweet.author?.handle;
    if (!handle) return false;
    
    const history = this.authorHistory.get(handle);
    if (!history || history.likes.length < 10) return false; // Not enough data
    
    // High engagement ratio
    const recent = history.likes.slice(-10);
    const avgLikes = recent.reduce((s, l) => s + l.count, 0) / recent.length;
    
    // New account (< 30 days) + very high engagement
    const age = Date.now() - (this.accountCreationTimes.get(handle) || Date.now());
    const isNew = age < 30 * 24 * 60 * 60 * 1000;
    const hasHighEngagement = avgLikes > 100;
    
    return isNew && hasHighEngagement;
  }

  setAccountAge(handle, createdAt) {
    this.accountCreationTimes.set(handle, new Date(createdAt).getTime());
  }

  getAnomalies(tweet) {
    const anomalies = [];
    const handle = tweet.author?.handle;
    
    if (handle && this.isEngagementSpike(handle, tweet.engagement?.likes || 0)) {
      anomalies.push({ type: 'engagement_spike', severity: 'HIGH', handle });
    }
    
    if (tweet.hashtags) {
      tweet.hashtags.forEach(tag => {
        if (this.isCoordinatedPosting(tag)) {
          anomalies.push({ type: 'coordinated_posting', severity: 'MEDIUM', hashtag: tag });
        }
      });
    }
    
    if (this.isBotSignal(tweet)) {
      anomalies.push({ type: 'bot_signal', severity: 'HIGH', handle });
    }
    
    return anomalies;
  }
}

// ── Insight Scorer ─────────────────────────────────────────────────────────

class InsightScorer {
  constructor() {
    this.authorCredibility = new Map();
  }

  score(tweet) {
    if (!tweet) return 0;
    
    // Topic relevance score
    const relevantTopics = (tweet.topics || []).filter(t => 
      ['AI', 'governance', 'finance', 'corruption', 'election', 'fiscal_policy', 'business'].includes(t)
    );
    const relevanceScore = relevantTopics.length > 0 ? Math.min(relevantTopics.length * 0.25, 0.8) : 0.1;
    
    // Engagement velocity (normalized)
    const likes = tweet.engagement?.likes || 0;
    const engagementVelocity = Math.min(likes / 1000, 1);
    
    // Credibility score
    const credibilityScore = tweet.credibilityScore || this._calcCredibility(tweet);
    
    return Math.min((relevanceScore * 0.4) + (engagementVelocity * 0.3) + (credibilityScore * 0.3), 1);
  }

  _calcCredibility(tweet) {
    const author = tweet.author || {};
    let score = 0;
    
    if (author.verified) score += 0.25;
    if (author.followers > 10000) score += 0.25;
    else if (author.followers > 1000) score += 0.15;
    else if (author.followers > 100) score += 0.05;
    
    const followerRatio = author.followers && author.following 
      ? author.followers / (author.following + 1) 
      : 0.5;
    score += Math.min(followerRatio * 0.15, 0.15);
    
    if (tweet.fromGraphQL) score += 0.15; // GraphQL-sourced tweets are more reliable
    
    return Math.min(score, 1);
  }
}

// ── Intelligence Engine ────────────────────────────────────────────────────

class IntelligenceEngine extends EventEmitter {
  constructor() {
    super();
    this.analyzer = new ContentAnalyzer();
    this.trendDetector = new TrendDetector();
    this.threadMapper = new ThreadMapper();
    this.anomalyDetector = new AnomalyDetector();
    this.insightScorer = new InsightScorer();
    this._pendingTweets = [];
  }

  /**
   * Process a tweet through the full analysis pipeline.
   */
  analyzeTweet(tweet) {
    // 1. Content analysis
    const analysis = this.analyzer.analyze(tweet.text || '');
    
    // 2. Merge with existing data
    const enriched = {
      ...tweet,
      sentiment: analysis.sentiment,
      sentimentScore: analysis.sentimentScore,
      topics: analysis.topics,
      entities: analysis.entities,
    };
    
    // 3. Trend detection
    this.trendDetector.recordTweet(enriched);
    const trendAlerts = this._checkTrends(analysis.topics);
    
    // 4. Thread mapping
    enriched.threadId = tweet.isReply ? (tweet.threadId || this._inferParent(enriched)) : null;
    this.threadMapper.addTweet(enriched);
    
    // 5. Anomaly detection
    this.anomalyDetector.recordTweet(enriched);
    const anomalies = this.anomalyDetector.getAnomalies(enriched);
    
    // 6. Insight scoring
    enriched.credibilityScore = this.insightScorer._calcCredibility(enriched);
    enriched.insightScore = this.insightScorer.score(enriched);
    enriched.analyzedAt = new Date().toISOString();
    
    // Emit events
    if (enriched.insightScore > 0.5) {
      this.emit('highInsight', enriched);
    }
    anomalies.forEach(a => this.emit('anomaly', { tweet: enriched, anomaly: a }));
    trendAlerts.forEach(t => this.emit('trend', t));
    this.emit('tweet', enriched);
    
    return enriched;
  }

  _checkTrends(topics) {
    const alerts = [];
    topics.forEach(topic => {
      if (this.trendDetector.isTrending(topic)) {
        alerts.push({
          topic,
          velocity: this.trendDetector.getVelocity(topic),
          direction: this.trendDetector.getDirection(topic),
        });
      }
    });
    return alerts;
  }

  _inferParent(tweet) {
    // Twitter reply chain inference — would need DOM traversal or GraphQL
    return null;
  }

  /**
   * Process a batch of tweets.
   */
  analyzeBatch(tweets) {
    return tweets.map(t => this.analyzeTweet(t));
  }

  getTrending() {
    return this.trendDetector.getTrendingTopics();
  }

  getAnomalies() {
    // Return recent anomalies
    return [];
  }
}

module.exports = { IntelligenceEngine, ContentAnalyzer, TrendDetector, ThreadMapper, AnomalyDetector, InsightScorer };