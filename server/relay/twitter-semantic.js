'use strict';

const { EventEmitter } = require('events');

/**
 * Twitter Semantic Layer
 * Transforms raw DOM nodes and GraphQL responses into semantic TweetObject instances.
 * Handles resilient extraction (Twitter's React virtualization breaks selectors).
 */

const TWEET_SELECTORS = [
  'article[data-testid="tweet"]',
  '[data-testid="tweet"]',
  'div[data-testid="primaryColumn"] article',
];

const RETRY_DELAYS = [100, 300, 600];

class TwitterSemantic extends EventEmitter {
  constructor(cdpRelay) {
    super();
    this.cdp = cdpRelay;
    this.seenTweetIds = new Set();
    this.seenContentHashes = new Set();
  }

  // ── TweetObject Data Model ────────────────────────────────────────────────

  _cleanText(html) {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _parseTimestamp(timeStr) {
    if (!timeStr) return null;
    // Twitter relative time: "2h", "Mar 15", etc.
    const now = Date.now();
    const num = parseInt(timeStr);
    if (timeStr.endsWith('s')) return new Date(now - num * 1000);
    if (timeStr.endsWith('m')) return new Date(now - num * 60000);
    if (timeStr.endsWith('h')) return new Date(now - num * 3600000);
    if (timeStr.endsWith('d')) return new Date(now - num * 86400000);
    // Fallback to Date.parse
    const parsed = Date.parse(timeStr);
    return isNaN(parsed) ? new Date(now) : new Date(parsed);
  }

  _extractHashtags(text) {
    return (text.match(/#\w+/g) || []).map(h => h.toLowerCase());
  }

  _extractMentions(text) {
    return (text.match(/@\w+/g) || []).map(m => m.toLowerCase());
  }

  _extractUrls(text) {
    const urlRegex = /https?:\/\/[^\s]+/g;
    return (text.match(urlRegex) || []);
  }

  _extractMoney(text) {
    const moneyRegex = /KSh\s*[\d,]+|KES\s*[\d,]+|USD\s*[\d,]+|\$[\d,]+/gi;
    return (text.match(moneyRegex) || []);
  }

  _contentHash(tweetId, text) {
    const str = `${tweetId}:${text}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return String(Math.abs(hash));
  }

  // ── Tweet Extraction from DOM ─────────────────────────────────────────────

  /**
   * Extract all visible TweetObjects from current page DOM.
   * Uses Runtime.evaluate to run extraction JS directly in page context.
   */
  async extractTweets() {
    const extractJS = `
    (() => {
      const selectors = [
        'article[data-testid="tweet"]',
        '[data-testid="tweet"]',
        'div[data-testid="primaryColumn"] article',
      ];
      
      const tweets = [];
      for (const sel of selectors) {
        const articles = document.querySelectorAll(sel);
        if (articles.length === 0) continue;
        
        articles.forEach(article => {
          try {
            // Tweet ID
            const link = article.querySelector('a[href*="/status/"]');
            const href = link ? link.getAttribute('href') : '';
            const idMatch = href.match(/\\/status\\/(\\d+)/);
            const tweetId = idMatch ? idMatch[1] : null;
            if (!tweetId) return;
            
            // Author
            const nameEl = article.querySelector('[data-testid="User-Name"] span');
            const name = nameEl ? nameEl.textContent.trim() : '';
            
            const handleEl = article.querySelector('[data-testid="User-Name"] a[href*="/"]');
            const handle = handleEl ? '@' + handleEl.getAttribute('href').replace('/', '') : '';
            
            const verifiedEl = article.querySelector('[data-testid="icon-verified"]');
            const verified = !!verifiedEl;
            
            // Text content
            const textEl = article.querySelector('[data-testid="tweetText"]');
            const text = textEl ? textEl.textContent.trim() : '';
            
            // Time
            const timeEl = article.querySelector('time');
            const datetime = timeEl ? timeEl.getAttribute('datetime') : null;
            const timestamp = datetime ? new Date(datetime).toISOString() : null;
            
            // Engagement
            const likesEl = article.querySelectorAll('[data-testid="like"] span');
            const likes = likesEl.length > 0 ? parseInt(likesEl[likesEl.length-1].textContent.replace(/[^0-9]/g,'')) || 0 : 0;
            
            const retweetEl = article.querySelectorAll('[data-testid="retweet"] span');
            const retweets = retweetEl.length > 0 ? parseInt(retweetEl[retweetEl.length-1].textContent.replace(/[^0-9]/g,'')) || 0 : 0;
            
            const replyEl = article.querySelectorAll('[data-testid="reply"] span');
            const replies = replyEl.length > 0 ? parseInt(replyEl[replyEl.length-1].textContent.replace(/[^0-9]/g,'')) || 0 : 0;
            
            // Is retweet?
            const retweetIndicator = article.querySelector('[data-testid="socialContext"]');
            const isRetweet = !!retweetIndicator;
            
            // Is reply?
            const replyContext = article.querySelector('[data-testid="tweetDetail"]') ||
                                  article.querySelector('[data-testid="inReplyTo"]');
            const isReply = !!replyContext || article.closest('[data-testid="tweetDetail"]');
            
            tweets.push({
              id: tweetId,
              author: { handle, name, verified },
              text,
              timestamp,
              engagement: { likes, retweets, replies, quotes: 0 },
              isRetweet,
              isReply,
              hashtags: [],
              mentions: [],
              urls: [],
            });
          } catch(e) {}
        });
        if (tweets.length > 0) break;
      }
      return tweets;
    })()
    `;

    try {
      const result = await this.cdp.evaluate(extractJS, { returnByValue: true });
      if (!result.success || !result.result) return [];
      
      const rawTweets = Array.isArray(result.result) ? result.result : [];
      
      // Post-process: add derived fields
      const tweets = rawTweets.map(raw => {
        const text = raw.text || '';
        const hashtags = this._extractHashtags(text);
        const mentions = this._extractMentions(text);
        const urls = this._extractUrls(text);
        const money = this._extractMoney(text);
        
        return {
          ...raw,
          hashtags,
          mentions,
          urls,
          money,
          sentiment: null,
          sentimentScore: 0,
          topics: [],
          credibilityScore: 0,
          insightScore: 0,
          analyzedAt: null,
          threadId: raw.isReply ? this._inferReplyTo(raw.id) : null,
        };
      });
      
      // Deduplicate: only emit new tweets
      const newTweets = tweets.filter(t => {
        if (this.seenTweetIds.has(t.id)) return false;
        const hash = this._contentHash(t.id, t.text);
        if (this.seenContentHashes.has(hash)) return false;
        this.seenTweetIds.add(t.id);
        this.seenContentHashes.add(hash);
        return true;
      });
      
      if (newTweets.length > 0) {
        this.emit('tweets', newTweets);
      }
      
      return newTweets;
    } catch (err) {
      this.emit('error', err);
      return [];
    }
  }

  _inferReplyTo(tweetId) {
    // Twitter encodes reply-to as URL in the article's ancestor link
    return null; // Requires DOM traversal per tweet — implement if needed
  }

  // ── GraphQL Response Parser ───────────────────────────────────────────────

  /**
   * Parse a Twitter GraphQL Network.responseReceived event data.
   * Twitter's GraphQL responses contain clean tweet objects.
   */
  parseGraphQLResponse(graphqlData) {
    try {
      // Twitter GraphQL structure: { data: { tweet: {...} } }
      // or: { data: { homeTimeline: { entries: [...] } } }
      const data = graphqlData;
      const tweetResult = data?.data?.tweetResult;
      if (tweetResult) {
        return this._parseGraphQLTweet(tweetResult);
      }
      
      // Home timeline
      const entries = data?.data?.homeTimeline?.instructions?.[0]?.entries;
      if (entries) {
        return entries
          .filter(e => e.content?.item?.tweet)
          .map(e => this._parseGraphQLTweet(e.content.item.tweet))
          .filter(Boolean);
      }
    } catch (err) {
      this.emit('error', { source: 'graphql-parser', err });
    }
    return [];
  }

  _parseGraphQLTweet(tweetResult) {
    try {
      const t = tweetResult.result || tweetResult;
      const legacy = t.legacy;
      if (!legacy) return null;
      
      const user = t.core?.user_results?.result?.legacy || {};
      
      return {
        id: String(legacy.id_str || t.rest_id),
        author: {
          handle: '@' + (user.screen_name || ''),
          name: user.name || '',
          verified: !!(t.core?.user_results?.result?.is_blue_verified),
          followers: user.followers_count || 0,
          following: user.friends_count || 0,
        },
        text: legacy.full_text || legacy.text || '',
        timestamp: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
        engagement: {
          likes: legacy.favorite_count || 0,
          retweets: legacy.retweet_count || 0,
          replies: legacy.reply_count || 0,
          quotes: legacy.quote_count || 0,
        },
        isRetweet: !!legacy.retweeted_status_result,
        isThread: !!(legacy.extended_entities?.media) && (legacy.extended_entities.media.length > 1),
        hashtags: (legacy.entities?.hashtags || []).map(h => h.text.toLowerCase()),
        mentions: (legacy.entities?.user_mentions || []).map(m => '@' + m.screen_name.toLowerCase()),
        urls: (legacy.entities?.urls || []).map(u => u.expanded_url),
        sentiment: null,
        sentimentScore: 0,
        topics: [],
        credibilityScore: 0,
        insightScore: 0,
        analyzedAt: null,
        threadId: null,
        fromGraphQL: true,
      };
    } catch (err) {
      return null;
    }
  }

  // ── Dedup & Reset ─────────────────────────────────────────────────────────

  resetDedup() {
    this.seenTweetIds.clear();
    this.seenContentHashes.clear();
  }

  isKnownTweet(tweetId) {
    return this.seenTweetIds.has(tweetId);
  }
}

module.exports = { TwitterSemantic };