'use strict';

const express = require('express');

/**
 * REST API Routes
 * All HTTP endpoints for the relay server.
 */

function createRouter(server) {
  const app = express();
  app.use(express.json());

  // ── Status ──────────────────────────────────────────────────────────────

  app.get('/status', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      connected: server.cdp?.isConnected || false,
      tabId: server.cdp?._tabId || null,
      memory: process.memoryUsage(),
      tweetsAnalyzed: server.tweetsAnalyzed || 0,
      alertsFired: server.delivery?.alertQueue?.count() || 0,
      lastReport: server.lastReportTime || null,
    });
  });

  // ── Navigation ──────────────────────────────────────────────────────────

  app.post('/navigate', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    try {
      await server.cdp.navigate(url);
      res.json({ success: true, url });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Scroll ──────────────────────────────────────────────────────────────

  app.post('/scroll', async (req, res) => {
    const { deltaY } = req.body;
    if (typeof deltaY !== 'number') return res.status(400).json({ error: 'deltaY required' });
    try {
      await server.checkScroll();
      const result = await server.cdp.scrollBy(deltaY);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Click ───────────────────────────────────────────────────────────────

  app.post('/click', async (req, res) => {
    const { selector } = req.body;
    if (!selector) return res.status(400).json({ error: 'selector required' });
    try {
      await server.checkClick();
      const result = await server.cdp.click(selector);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Extract ─────────────────────────────────────────────────────────────

  app.post('/extract', async (req, res) => {
    try {
      await server.checkScan();
      const tweets = await server.semantic.extractTweets();
      res.json({ success: true, count: tweets.length, tweets });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Search ──────────────────────────────────────────────────────────────

  app.post('/search', async (req, res) => {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'query required' });
    try {
      // Open Twitter search
      await server.cdp.navigate(`https://twitter.com/search?q=${encodeURIComponent(query)}&src=typed_query`);
      await new Promise(r => setTimeout(r, 2000));
      const tweets = await server.semantic.extractTweets();
      res.json({ success: true, query, count: tweets.length, tweets });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── Intelligence ────────────────────────────────────────────────────────

  app.get('/intelligence', async (req, res) => {
    const alerts = server.delivery?.getAlerts() || [];
    const trending = server.intel?.getTrending() || [];
    res.json({ alerts, trending });
  });

  app.get('/alerts', (req, res) => {
    const { priority } = req.query;
    const alerts = server.delivery?.getAlerts(priority || null) || [];
    res.json(alerts);
  });

  app.get('/report', (req, res) => {
    const report = server.lastReport || null;
    if (!report) return res.status(404).json({ error: 'no report generated yet' });
    res.json(report);
  });

  // ── Memory / Search ─────────────────────────────────────────────────────

  app.get('/search', (req, res) => {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'q query param required' });
    try {
      const results = server.memory?.searchTweets(q, 50) || [];
      res.json({ query: q, count: results.length, results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Subscribe ───────────────────────────────────────────────────────────

  app.post('/subscribe', (req, res) => {
    const { events } = req.body;
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'events array required' });
    }
    // WebSocket subscription is handled via ws — this just validates
    res.json({ success: true, subscribed: events });
  });

  // ── Cohort ──────────────────────────────────────────────────────────────

  app.get('/tweet/:id', (req, res) => {
    const tweet = server.memory?.getTweet(req.params.id) || null;
    if (!tweet) return res.status(404).json({ error: 'tweet not found' });
    res.json(tweet);
  });

  app.get('/trending', (req, res) => {
    const trending = server.intel?.getTrending() || [];
    res.json(trending);
  });

  return app;
}

module.exports = { createRouter };