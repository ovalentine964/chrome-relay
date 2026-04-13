'use strict';

const http = require('http');
const express = require('express');
const { CDPRelay } = require('./relay/cdp-relay');
const { TwitterSemantic } = require('./relay/twitter-semantic');
const { IntelligenceEngine } = require('./relay/intelligence-engine');
const { Delivery } = require('./relay/delivery');
const { Memory } = require('./relay/memory');
const { TabManager } = require('./relay/tab-manager');
const { setupWebSocket } = require('./api/websocket');
const { createRouter } = require('./api/routes');
const { FINGERPRINT, checkScroll, checkClick, checkScan } = require('./relay/bot-evasion');
const { getScrollParams, getClickParams, sessionStartDelay, sessionBreakInterval, sessionBreakDuration } = require('./relay/human-behavior');

const PORT = process.env.PORT || 3131;
const CHROME_HOST = process.env.CHROME_HOST || '127.0.0.1';
const CHROME_PORT = parseInt(process.env.CHROME_PORT || '9222');

/**
 * Chrome Relay Server
 * Main entry point — wires all modules together into a complete system.
 */
class ChromeRelayServer {
  constructor(options = {}) {
    this.host = options.host || CHROME_HOST;
    this.port = options.port || CHROME_PORT;
    this.tweetsAnalyzed = 0;
    this.lastReport = null;
    this.lastReportTime = null;
    this.running = false;
    this._reportInterval = null;
    this._sessionBreakTimer = null;
  }

  async start() {
    console.error('[ChromeRelay] Starting...');
    
    // Initialize modules
    this.cdp = new CDPRelay({ host: this.host, port: this.port });
    this.semantic = new TwitterSemantic(this.cdp);
    this.intel = new IntelligenceEngine();
    this.memory = new Memory();
    this.delivery = new Delivery({ intelDir: '/home/valentinetech/.openclaw/workspace/chrome-relay/intelligence' });
    this.tabs = new TabManager(this.cdp);

    // Wire event chain: CDP → Semantic → Intel → Delivery → Memory
    this._wirePipeline();

    // Connect to Chrome
    console.error(`[ChromeRelay] Connecting to Chrome at ${this.host}:${this.port}...`);
    try {
      await this.cdp.connect();
      console.error('[ChromeRelay] Connected to Chrome');
    } catch (err) {
      console.error('[ChromeRelay] Failed to connect to Chrome:', err.message);
      console.error('[ChromeRelay] Make sure Chrome is running with --remote-debugging-port=9222');
      console.error('[ChromeRelay] Example: google-chrome --remote-debugging-port=9222');
      process.exit(1);
    }

    // Setup HTTP + WebSocket
    this.app = express();
    this.app.use(express.json());
    
    this.httpServer = http.createServer(this.app);
    setupWebSocket(this);
    this.app.use('/api', createRouter(this));
    
    this.app.get('/', (req, res) => {
      res.json({
        name: 'CoHusdex Chrome Relay',
        version: '1.0.0',
        status: 'running',
        cdp: this.cdp.isConnected,
        tabId: this.cdp._tabId,
        tweetsAnalyzed: this.tweetsAnalyzed,
      });
    });

    // Start HTTP server
    this.httpServer.listen(PORT, () => {
      console.error(`[ChromeRelay] HTTP server listening on port ${PORT}`);
      console.error(`[ChromeRelay] WebSocket available at ws://localhost:${PORT}/ws`);
      console.error(`[ChromeRelay] REST API at http://localhost:${PORT}/api`);
    });

    // Start periodic report generator
    const reportIntervalMs = (parseInt(process.env.REPORT_INTERVAL_MINUTES) || 60) * 60 * 1000;
    this._reportInterval = setInterval(() => this._generateReport(), reportIntervalMs);

    // Session break management
    this._scheduleSessionBreak();

    this.running = true;
    console.error('[ChromeRelay] Ready');
  }

  _wirePipeline() {
    // CDP lifecycle → extract tweets
    this.cdp.on('lifecycle', async (ev) => {
      if (ev.name === 'paint') {
        // Small delay to let DOM settle
        await new Promise(r => setTimeout(r, 300));
        await this._extractAndProcess();
      }
    });

    // CDP network → GraphQL parser
    this.cdp.on('network:response', (ev) => {
      if (ev.response?.url?.includes('graphql.twitter.com')) {
        try {
          // CDP gives us the raw — we'd need to fetch the body separately
          // For now, skip GraphQL parsing from network (requires more CDP depth)
        } catch {}
      }
    });

    // Intelligence → delivery
    this.intel.on('tweet', (tweet) => {
      this.tweetsAnalyzed++;
      const { routed, alert } = this.delivery.deliverTweet(tweet);
      this.memory.saveTweet(tweet);
      this.tweetsAnalyzed++;
    });

    this.intel.on('trend', (trend) => {
      this.memory.updateTrend(trend.topic, trend.velocity, trend.direction);
    });

    this.intel.on('highInsight', (tweet) => {
      this._broadcast({ type: 'insight', data: tweet });
    });

    this.intel.on('anomaly', ({ tweet, anomaly }) => {
      this._broadcast({ type: 'anomaly', data: { tweet, anomaly } });
    });

    // Delivery alerts
    const origDeliver = this.delivery.deliverTweet.bind(this.delivery);
    this.delivery.deliverTweet = (tweet) => {
      const result = origDeliver(tweet);
      if (result.routed === 'alert') {
        this._broadcast({ type: 'alert', data: result.alert });
      }
      return result;
    };
  }

  async _extractAndProcess() {
    try {
      await checkScan();
      const tweets = await this.semantic.extractTweets();
      if (tweets.length > 0) {
        tweets.forEach(t => this.intel.analyzeTweet(t));
      }
    } catch (err) {
      console.error('[ChromeRelay] Extract error:', err.message);
    }
  }

  async _generateReport() {
    try {
      const tweets = this.memory.db ?
        this.memory.db.prepare('SELECT * FROM tweets ORDER BY timestamp DESC LIMIT 1000').all() : [];
      const alertResults = this.delivery.getAlerts();
      const trending = this.intel.getTrending();
      const result = this.delivery.generatePeriodicReport(tweets, { start: Date.now() - 3600000 });
      this.lastReport = result.report;
      this.lastReportTime = new Date().toISOString();
      console.error(`[ChromeRelay] Report generated: ${result.reportId}`);
      this._broadcast({ type: 'report', data: result.report });
    } catch (err) {
      console.error('[ChromeRelay] Report generation error:', err.message);
    }
  }

  _broadcast(msg) {
    // Will be picked up by websocket module if it has access to this
    if (this._broadcastFn) this._broadcastFn(msg);
  }

  setBroadcastFn(fn) {
    this._broadcastFn = fn;
  }

  _scheduleSessionBreak() {
    const intervalMs = sessionBreakInterval() * 60 * 1000;
    this._sessionBreakTimer = setTimeout(async () => {
      console.error('[ChromeRelay] Session break...');
      await new Promise(r => setTimeout(r, sessionBreakDuration() * 60 * 1000));
      console.error('[ChromeRelay] Resuming...');
      this._scheduleSessionBreak();
    }, intervalMs);
  }

  async stop() {
    console.error('[ChromeRelay] Shutting down...');
    this.running = false;
    if (this._reportInterval) clearInterval(this._reportInterval);
    if (this._sessionBreakTimer) clearTimeout(this._sessionBreakTimer);
    await this.cdp.close();
    this.memory.close();
    this.httpServer.close();
    console.error('[ChromeRelay] Stopped');
  }
}

// ── CLI Entry Point ────────────────────────────────────────────────────────

if (require.main === module) {
  const server = new ChromeRelayServer();
  
  process.on('SIGINT', async () => {
    await server.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await server.stop();
    process.exit(0);
  });

  server.start().catch(err => {
    console.error('[ChromeRelay] Fatal:', err);
    process.exit(1);
  });
}

module.exports = { ChromeRelayServer };