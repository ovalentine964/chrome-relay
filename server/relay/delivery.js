'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Intelligence Delivery Layer
 * Report generation, alert routing, founder digest, agentic packet formatting.
 */

const INTEL_DIR = '/home/valentinetech/.openclaw/workspace/chrome-relay/intelligence';
const REPORT_DIR = path.join(INTEL_DIR, 'reports');
const ALERTS_FILE = path.join(INTEL_DIR, 'alerts.jsonl');
const DIGEST_FILE = path.join(INTEL_DIR, 'digest.md');

// ── Alert Priority Queue ───────────────────────────────────────────────────

const PRIORITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

class AlertQueue {
  constructor() {
    this.alerts = [];
  }

  push(alert) {
    alert.id = alert.id || `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    alert.createdAt = alert.createdAt || new Date().toISOString();
    this.alerts.push(alert);
    this.alerts.sort((a, b) => (PRIORTY_ORDER[a.priority] || 99) - (PRIORTY_ORDER[b.priority] || 99));
  }

  getAll() { return this.alerts; }
  getByPriority(priority) { return this.alerts.filter(a => a.priority === priority); }
  getCRITICAL() { return this.alerts.filter(a => a.priority === 'CRITICAL'); }
  getHIGH() { return this.alerts.filter(a => a.priority === 'HIGH'); }

  shift() { return this.alerts.shift(); }
  clear() { this.alerts = []; }
  count() { return this.alerts.length; }
}

// ── Report Generator ──────────────────────────────────────────────────────

class ReportGenerator {
  constructor(options = {}) {
    this.reportDir = options.reportDir || REPORT_DIR;
    this.intelDir = options.intelDir || INTEL_DIR;
    fs.mkdirSync(this.reportDir, { recursive: true });
    fs.mkdirSync(this.intelDir, { recursive: true });
  }

  generate(tweets = [], alerts = [], trends = []) {
    const now = new Date();
    const reportId = `r-${now.toISOString().replace(/[:.]/g, '-').slice(0, 16)}`;
    const dateStr = now.toISOString().slice(0, 16).replace('T', '-');
    
    // Filter high-insight tweets
    const topTweets = tweets
      .filter(t => t.insightScore > 0.5)
      .sort((a, b) => b.insightScore - a.insightScore)
      .slice(0, 20);

    const report = {
      reportId,
      generatedAt: now.toISOString(),
      period: options.period || null,
      summary: {
        totalTweetsAnalyzed: tweets.length,
        highPriorityAlerts: alerts.filter(a => a.priority === 'CRITICAL' || a.priority === 'HIGH').length,
        topTopics: this._topTopics(tweets),
        trending: trends.slice(0, 5),
      },
      alerts: alerts.map(a => ({
        id: a.id,
        priority: a.priority,
        topic: a.topic,
        summary: a.summary,
        sources: a.sources || [],
        sentiment: a.sentiment,
        confidence: a.confidence,
        actionFlags: a.actionFlags || [],
      })),
      insights: topTweets.map(t => ({
        topic: t.topics?.[0] || 'general',
        insight: t.text?.substring(0, 200),
        source: t.author?.handle,
        sentiment: t.sentiment,
        confidence: t.sentimentScore,
        engagement: t.engagement,
        insightScore: t.insightScore,
      })),
    };

    // Write JSON
    const jsonPath = path.join(this.reportDir, `${reportId}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

    // Write Markdown
    const md = this._toMarkdown(report);
    const mdPath = path.join(this.reportDir, `${reportId}.md`);
    fs.writeFileSync(mdPath, md);

    return { reportId, jsonPath, mdPath, report };
  }

  _topTopics(tweets) {
    const counts = {};
    tweets.forEach(t => (t.topics || []).forEach(topic => {
      counts[topic] = (counts[topic] || 0) + 1;
    }));
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic, count]) => ({ topic, count }));
  }

  _toMarkdown(report) {
    const lines = [
      `# Intelligence Report — ${report.generatedAt}`,
      '',
      `**Report ID:** ${report.reportId}`,
      `**Generated:** ${new Date(report.generatedAt).toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}`,
      '',
      `## Summary`,
      `- Tweets analyzed: ${report.summary.totalTweetsAnalyzed}`,
      `- High-priority alerts: ${report.summary.highPriorityAlerts}`,
      `- Top topics: ${report.summary.topics.map(t => `${t.topic}(${t.count})`).join(', ')}`,
      '',
    ];

    if (report.summary.trending.length > 0) {
      lines.push('## Trending Topics');
      report.summary.trending.forEach(t => {
        lines.push(`- **${t.topic}** — ${t.direction} (${t.velocity?.toFixed(1)} tweets/min)`);
      });
      lines.push('');
    }

    if (report.alerts.length > 0) {
      lines.push('## Alerts');
      report.alerts.forEach(a => {
        lines.push(`**[${a.priority}]** ${a.topic}: ${a.summary}`);
        if (a.sources?.length) lines.push(`  Sources: ${a.sources.map(s => `[\`${s}\`](#)`).join(', ')}`);
      });
      lines.push('');
    }

    if (report.insights.length > 0) {
      lines.push('## Top Insights');
      report.insights.forEach((ins, i) => {
        lines.push(`${i + 1}. **${ins.topic}** @${ins.source} — ${ins.insight}`);
        lines.push(`   Sentiment: ${ins.sentiment} | Engagement: ${ins.engagement?.likes || 0} likes`);
        lines.push('');
      });
    }

    return lines.join('\n');
  }
}

// ── Cohusdex Agent Packet Formatter ───────────────────────────────────────

class CohusdexFormatter {
  format(tweet, alert = null) {
    return {
      type: 'intelligence_packet',
      priority: alert?.priority || tweet.priority || 'LOW',
      topic: tweet.topics?.[0] || 'general',
      summary: tweet.text?.substring(0, 200) || alert?.summary || '',
      keySources: [`https://twitter.com/i/status/${tweet.id}`],
      sentiment: tweet.sentiment || 'neutral',
      sentimentScore: tweet.sentimentScore || 0.5,
      confidence: tweet.credibilityScore || 0.5,
      actionFlags: this._actionFlags(tweet),
      raw: {
        tweetId: tweet.id,
        author: tweet.author,
        text: tweet.text,
        timestamp: tweet.timestamp,
        engagement: tweet.engagement,
        topics: tweet.topics,
        insightScore: tweet.insightScore,
        anomalies: tweet.anomalies || [],
      },
      generatedAt: new Date().toISOString(),
    };
  }

  _actionFlags(tweet) {
    const flags = [];
    if ((tweet.topics || []).includes('corruption')) flags.push('escalate');
    if ((tweet.topics || []).includes('governance')) flags.push('monitor');
    if ((tweet.engagement?.likes || 0) > 1000) flags.push('viral_suspect');
    if (tweet.insightScore > 0.7) flags.push('high_value');
    return flags;
  }
}

// ── Founder Digest (5 bullets max) ────────────────────────────────────────

class FounderDigest {
  constructor(intelDir) {
    this.digestFile = path.join(intelDir || INTEL_DIR, 'digest.md');
  }

  generate(intel = {}) {
    const { wins = [], alerts = [], trends = [], tomorrow = [] } = intel;
    const now = new Date();
    
    const lines = [
      `# Intelligence Digest — ${now.toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', timeZoneName: 'short' })}`,
      '',
    ];

    if (wins.length > 0) {
      lines.push("## TODAY'S HIGHLIGHTS");
      wins.slice(0, 5).forEach(w => lines.push(`- ${w}`));
      lines.push('');
    }

    if (alerts.length > 0) {
      lines.push('## ALERTS');
      alerts.slice(0, 5).forEach(a => lines.push(`- **[${a.priority}]** ${a.summary}`));
      lines.push('');
    }

    if (trends.length > 0) {
      lines.push('## TRENDING');
      trends.slice(0, 5).forEach(t => lines.push(`- ${t.topic}: ${t.direction}`));
      lines.push('');
    }

    if (tomorrow.length > 0) {
      lines.push('## TOMORROW');
      tomorrow.slice(0, 5).forEach(t => lines.push(`- ${t}`));
      lines.push('');
    }

    const md = lines.join('\n');
    fs.mkdirSync(path.dirname(this.digestFile), { recursive: true });
    fs.writeFileSync(this.digestFile, md);
    
    return md;
  }
}

// ── Alert File Writer (JSONL) ─────────────────────────────────────────────

function writeAlertJsonl(alert) {
  fs.mkdirSync(path.dirname(ALERTS_FILE), { recursive: true });
  fs.appendFileSync(ALERTS_FILE, JSON.stringify(alert) + '\n');
}

// ── Delivery Module ───────────────────────────────────────────────────────

class Delivery {
  constructor(options = {}) {
    this.alertQueue = new AlertQueue();
    this.reportGenerator = new ReportGenerator(options);
    this.cohusdexFormatter = new CohusdexFormatter();
    this.founderDigest = new FounderDigest(options.intelDir);
    this.intelDir = options.intelDir || INTEL_DIR;
  }

  /**
   * Route an enriched tweet to appropriate outputs.
   */
  deliverTweet(tweet) {
    const priority = this._assessPriority(tweet);
    
    if (priority === 'CRITICAL' || priority === 'HIGH') {
      const alert = {
        id: `alert-${Date.now()}`,
        priority,
        topic: tweet.topics?.[0] || 'general',
        summary: tweet.text?.substring(0, 200),
        sources: [`https://twitter.com/i/status/${tweet.id}`],
        sentiment: tweet.sentiment,
        confidence: tweet.credibilityScore,
        actionFlags: this.cohusdexFormatter._actionFlags(tweet),
        tweet,
      };
      this.alertQueue.push(alert);
      writeAlertJsonl(alert);
      return { routed: 'alert', alert };
    }
    
    return { routed: 'report', tweet };
  }

  _assessPriority(tweet) {
    if ((tweet.topics || []).includes('governance') && (tweet.engagement?.likes || 0) > 5000) return 'HIGH';
    if ((tweet.topics || []).includes('corruption')) return 'HIGH';
    if ((tweet.topics || []).includes('election') && (tweet.engagement?.likes || 0) > 2000) return 'HIGH';
    if ((tweet.topics || []).includes('fiscal_policy') && tweet.insightScore > 0.7) return 'MEDIUM';
    if (tweet.insightScore > 0.8) return 'MEDIUM';
    return 'LOW';
  }

  generatePeriodicReport(tweets, period) {
    return this.reportGenerator.generate(tweets, this.alertQueue.getAll(), []);
  }

  getAlerts(priority) {
    if (priority) return this.alertQueue.getByPriority(priority);
    return this.alertQueue.getAll();
  }
}

module.exports = { Delivery, AlertQueue, ReportGenerator, CohusdexFormatter, FounderDigest, writeAlertJsonl };