/**
 * CDP Relay — Raw WebSocket Chrome DevTools Protocol Client
 * Replaces chrome-remote-interface for Chrome 145+ compatibility.
 * Communicates directly via WebSocket using Chrome's CDP JSON protocol.
 */
const WebSocket = require('ws');
const { EventEmitter } = require('events');
const http = require('http');

class CDPRelay extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 9222;
    this.secure = options.secure || false;
    this._ws = null;
    this._tabId = null;
    this._messageId = 0;
    this._pending = new Map(); // id → {resolve, reject, method}
    this._connected = false;
    this._reconnectDelay = 2000;
    this._reconnectTimer = null;
    this._eventHandlers = new Map(); // method → [handlers]
  }

  /** Send a CDP command and wait for response */
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected to Chrome'));
        return;
      }
      const id = ++this._messageId;
      const payload = JSON.stringify({ id, method, params });
      this._pending.set(id, { resolve, reject, method });
      this._ws.send(payload);
      // Timeout after 30s
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  /** Subscribe to a CDP event (e.g. 'Page.loadEventFired') */
  on(event, handler) {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, []);
    }
    this._eventHandlers.get(event).push(handler);
    return this;
  }

  /** Unsubscribe */
  off(event, handler) {
    if (handler) {
      const handlers = this._eventHandlers.get(event) || [];
      this._eventHandlers.set(event, handlers.filter(h => h !== handler));
    } else {
      this._eventHandlers.delete(event);
    }
    return this;
  }

  /** Connect to a specific tab */
  async connect(tabId) {
    await this._ensureConnection();
    if (tabId) {
      this._tabId = tabId;
    }
    return this;
  }

  async _ensureConnection() {
    // Get the first available tab if none specified
    if (!this._tabId) {
      const tabs = await this._listTabs();
      const target = tabs.find(t =>
        t.url && (t.url.includes('x.com') || t.url.includes('twitter.com'))
      ) || tabs.find(t => t.url && !t.url.includes('accounts.google.com') && !t.url.includes('accounts.youtube.com'));
      if (!target) throw new Error('No suitable Chrome tab found. Open twitter.com first.');
      this._tabId = target.id;
      this._wsUrl = target.webSocketDebuggerUrl;
    } else {
      // Build WebSocket URL from tab ID
      this._wsUrl = `ws://${this.host}:${this.port}/devtools/page/${this._tabId}`;
    }

    return new Promise((resolve, reject) => {
      const wsUrl = this._wsUrl || `ws://${this.host}:${this.port}/devtools/page/${this._tabId}`;
      this._ws = new WebSocket(wsUrl);

      const connectTimeout = setTimeout(() => {
        this._ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, 15000);

      this._ws.on('open', () => {
        clearTimeout(connectTimeout);
        this._connected = true;
        this.emit('connected', { tabId: this._tabId });
        resolve(this);
      });

      this._ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(msg);
        } catch (e) {
          // ignore parse errors
        }
      });

      this._ws.on('close', () => {
        this._connected = false;
        this.emit('disconnected');
        this._scheduleReconnect();
      });

      this._ws.on('error', (err) => {
        this.emit('error', err);
      });
    });
  }

  _handleMessage(msg) {
    if (msg.id !== undefined) {
      // Response to our command
      const pending = this._pending.get(msg.id);
      if (pending) {
        this._pending.delete(msg.id);
        if (msg.result !== undefined) {
          pending.resolve(msg.result);
        } else if (msg.error) {
          pending.reject(new Error(msg.error.message || msg.error));
        }
      }
    } else if (msg.method) {
      // CDP event
      const handlers = this._eventHandlers.get(msg.method) || [];
      handlers.forEach(h => {
        try { h(msg.params || {}); } catch(e) { /* ignore handler errors */ }
      });
      this.emit('event', msg.method, msg.params || {});
    }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, 30000);
      this._ensureConnection().catch(() => {});
    }, this._reconnectDelay);
  }

  async _listTabs() {
    return new Promise((resolve, reject) => {
      http.get(`http://${this.host}:${this.port}/json`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
        });
      }).on('error', reject);
    });
  }

  async activateTab(tabId) {
    await this.send('Target.activateTarget', { targetId: tabId });
  }

  async closeTab(tabId) {
    await this.send('Target.closeTarget', { targetId: tabId });
  }

  /** Enable a CDP domain */
  async enable(domain) {
    try { await this.send(`${domain}.enable`); } catch(e) { /* domain may not exist */ }
  }

  /** Navigate to a URL */
  async navigate(url) {
    await this.send('Page.navigate', { url });
  }

  /** Evaluate JavaScript in the page */
  async evaluate(js) {
    const result = await this.send('Runtime.evaluate', {
      expression: js,
      returnByValue: true,
      awaitPromise: true
    });
    return result.result ? result.result.value : undefined;
  }

  /** Get page title */
  async getTitle() {
    return this.evaluate('document.title');
  }

  /** Scroll the page */
  async scrollTo(y) {
    await this.evaluate(`window.scrollTo(0, ${y})`);
  }

  /** Get scroll height */
  async getScrollHeight() {
    return this.evaluate('document.body.scrollHeight');
  }

  /** Get viewport height */
  async getViewportHeight() {
    return this.evaluate('window.innerHeight');
  }

  isConnected() { return this._connected; }

  async disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._connected = false;
  }
}

module.exports = { CDPRelay };