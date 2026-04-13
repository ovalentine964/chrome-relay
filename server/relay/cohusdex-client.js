'use strict';

const http = require('http');
const https = require('https');

/**
 * CohusdexClient — Client library for Cohusdex agents to connect to the relay server.
 * Handles HTTP REST calls and WebSocket real-time event streaming.
 */

class CohusdexClient extends EventEmitter {
  constructor(baseUrl = 'http://localhost:3131') {
    super();
    this.baseUrl = baseUrl;
    this.ws = null;
    this.handlers = {};
    this._connectPromise = null;
    this._reconnectDelay = 3000;
    this._reconnectTimer = null;
    this._wsUrl = baseUrl.replace('http', 'ws') + '/ws';
  }

  // ── Connection ───────────────────────────────────────────────────────────

  async connect() {
    if (this._connectPromise) return this._connectPromise;
    
    this._connectPromise = new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this._wsUrl);
        
        this.ws.onopen = () => {
          this._connectPromise = null;
          this._reconnectDelay = 3000;
          this.emit('connected');
          resolve(this);
        };
        
        this.ws.onerror = (e) => {
          this.emit('error', e);
          reject(e);
        };
        
        this.ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            this._dispatch(msg);
          } catch {}
        };
        
        this.ws.onclose = () => {
          this.emit('disconnected');
          this._scheduleReconnect();
        };
      } catch (e) {
        this._connectPromise = null;
        reject(e);
      }
    });
    
    return this._connectPromise;
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 30000);
      this.connect().catch(() => {});
    }, this._reconnectDelay);
  }

  disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'normal');
      this.ws = null;
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  // ── Event Subscription ───────────────────────────────────────────────────

  on(event, handler) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(handler);
    this._send({ type: 'subscribe', events: [event] });
  }

  off(event, handler) {
    if (this.handlers[event]) {
      this.handlers[event] = this.handlers[event].filter(h => h !== handler);
    }
    this._send({ type: 'unsubscribe', events: [event] });
  }

  _dispatch(msg) {
    const handlers = this.handlers[msg.type] || [];
    handlers.forEach(h => {
      try { h(msg.data); } catch (e) { console.error('CohusdexClient handler error:', e); }
    });
    // Also emit on this
    this.emit(msg.type, msg.data);
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // ── Browser Commands ──────────────────────────────────────────────────────

  async _post(endpoint, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + endpoint);
      const isHttps = url.protocol === 'https:';
      const mod = isHttps ? https : http;
      
      const req = mod.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 3131),
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d)); }
          catch { reject(new Error('Invalid JSON response')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  async _get(endpoint) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + endpoint);
      const isHttps = url.protocol === 'https:';
      const mod = isHttps ? https : http;
      
      const req = mod.get({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 3131),
        path: url.pathname + url.search,
        timeout: 15000,
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try { resolve(JSON.parse(d)); }
          catch { reject(new Error('Invalid JSON response')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    });
  }

  async scroll(deltaY) {
    return this._post('/scroll', { deltaY });
  }

  async click(selector) {
    return this._post('/click', { selector });
  }

  async extract() {
    return this._post('/extract', {});
  }

  async navigate(url) {
    return this._post('/navigate', { url });
  }

  async search(query) {
    return this._post('/search', { query });
  }

  async getAlerts(priority = null) {
    const ep = priority ? `/alerts?priority=${priority}` : '/alerts';
    return this._get(ep);
  }

  async getReport() {
    return this._get('/report');
  }

  async searchTweets(query) {
    return this._get(`/search?q=${encodeURIComponent(query)}`);
  }

  async status() {
    return this._get('/status');
  }
}

const { EventEmitter } = require('events');
require('events').prototype._super = EventEmitter.prototype;

module.exports = { CohusdexClient };