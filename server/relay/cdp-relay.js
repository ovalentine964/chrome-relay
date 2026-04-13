'use strict';

const CDP = require('chrome-remote-interface');
const { EventEmitter } = require('events');

/**
 * CDP Relay — Core browser connection manager
 * Connects to Chrome via chrome-remote-interface, manages event subscriptions,
 * command queue with retry logic, and auto-reconnect.
 */
class CDPRelay extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} [options.host='127.0.0.1'] - Chrome host
   * @param {number} [options.port=9222] - Chrome remote debugging port
   * @param {boolean} [options.secure=false] - Use wss:// instead of ws://
   */
  constructor(options = {}) {
    super();
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 9222;
    this.secure = options.secure || false;
    this.client = null;
    this._commandQueue = [];
    this._processingQueue = false;
    this._retryTimeout = null;
    this._reconnectDelay = 2000;
    this._maxReconnectDelay = 30000;
    this._connected = false;
    this._tabId = null;
  }

  /** Establish CDP connection */
  async connect(tabId) {
    try {
      if (this.client) {
        await this._cleanup();
      }

      const target = tabId
        ? { id: tabId }
        : await this._discoverActiveTab();

      this.client = await CDP({
        host: this.host,
        port: this.port,
        secure: this.secure,
        target,
      });

      this._tabId = target.id;
      this._connected = true;
      this._reconnectDelay = 2000;

      // Wire up CDP event forwarding
      this._wireEvents();

      // Enable required CDP domains
      await Promise.all([
        this.client.Page.enable(),
        this.client.Runtime.enable(),
        this.client.Network.enable(),
        this.client.DOM.enable(),
      ]);

      this.emit('connected', { tabId: this._tabId });
      return this;
    } catch (err) {
      this.emit('error', err);
      this._scheduleReconnect();
      throw err;
    }
  }

  /** Discover the active/foreground tab */
  async _discoverActiveTab() {
    const tabs = await CDP.List({ host: this.host, port: this.port });
    const twitterTab = tabs.find(t =>
      t.url && (t.url.includes('twitter.com') || t.url.includes('x.com'))
    );
    return twitterTab || tabs[0];
  }

  /** Wire CDP events to relay emitters */
  _wireEvents() {
    const cdp = this.client;

    cdp.Page.lifecycleEvent && cdp.Page.lifecycleEvent.on(ev => {
      this.emit('lifecycle', ev);
    });

    cdp.DOM.modified && cdp.DOM.modified.on(ev => {
      this.emit('dom:modified', ev);
    });

    cdp.Network.responseReceived && cdp.Network.responseReceived.on(ev => {
      this.emit('network:response', ev);
    });

    cdp.Runtime.consoleAPICalled && cdp.Runtime.consoleAPICalled.on(ev => {
      this.emit('console:api', ev);
    });

    cdp.Runtime.exceptionThrown && cdp.Runtime.exceptionThrown.on(ev => {
      this.emit('runtime:exception', ev);
    });

    cdp.Page.frameStartedLoading && cdp.Page.frameStartedLoading.on(ev => {
      this.emit('frame:loading', ev);
    });

    cdp.Page.frameStoppedLoading && cdp.Page.frameStoppedLoading.on(ev => {
      this.emit('frame:stopped', ev);
    });

    cdp.Network.loadingFailed && cdp.Network.loadingFailed.on(ev => {
      this.emit('network:failed', ev);
    });
  }

  /** Cleanup on disconnect */
  async _cleanup() {
    if (this.client) {
      try {
        await this.client.close();
      } catch (_) {}
      this.client = null;
    }
    this._connected = false;
    this._tabId = null;
  }

  /** Schedule reconnection attempt */
  _scheduleReconnect() {
    if (this._retryTimeout) return;
    this._retryTimeout = setTimeout(async () => {
      this._retryTimeout = null;
      try {
        await this.connect();
      } catch (_) {
        // will reschedule
      }
    }, this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 1.5, this._maxReconnectDelay);
  }

  // ── Public Commands ─────────────────────────────────────────────────────────

  /** Navigate to a URL */
  async navigate(url, options = {}) {
    return this._enqueueCommand('navigate', async () => {
      const { timeout = 30000 } = options;
      await this.client.Page.navigate({ url });
      await this._waitForLoad(timeout);
      return { success: true, url };
    });
  }

  /** Scroll to an absolute Y position */
  async scrollTo(y, options = {}) {
    return this._enqueueCommand('scrollTo', async () => {
      await this.client.Runtime.evaluate({
        expression: `window.scrollTo({ top: ${y}, behavior: 'smooth' })`,
        awaitPromise: true,
      });
      return { success: true, y };
    });
  }

  /** Scroll by delta pixels */
  async scrollBy(deltaY, options = {}) {
    return this._enqueueCommand('scrollBy', async () => {
      await this.client.Runtime.evaluate({
        expression: `window.scrollBy({ top: ${deltaY}, behavior: 'smooth' })`,
        awaitPromise: true,
      });
      return { success: true, deltaY };
    });
  }

  /** Click an element by CSS selector */
  async click(selector, options = {}) {
    return this._enqueueCommand('click', async () => {
      const result = await this.client.Runtime.evaluate({
        expression: `
          (() => {
            const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (!el) return { success: false, error: 'element not found' };
            const rect = el.getBoundingClientRect();
            return {
              success: true,
              element: el.tagName,
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
            };
          })()
        `,
        returnByValue: true,
        awaitPromise: true,
      });

      if (!result.result || !result.result.value || !result.result.value.success) {
        return { success: false, error: 'element not found or not clickable' };
      }

      const { x, y } = result.result.value;

      // Dispatch mousedown + mouseup + click events for human-like feel
      await this.client.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y });
      await this._delay(80);
      await this.client.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await this._delay(120);
      await this.client.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });

      return { success: true, x, y, selector };
    });
  }

  /** Hover over an element by CSS selector (no click) */
  async hover(selector) {
    return this._enqueueCommand('hover', async () => {
      const result = await this.client.Runtime.evaluate({
        expression: `
          (() => {
            const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          })()
        `,
        returnByValue: true,
      });

      if (!result.result || !result.result.value) {
        return { success: false };
      }

      await this.client.Input.dispatchMouseEvent({
        type: 'mouseMoved',
        x: result.result.value.x,
        y: result.result.value.y,
      });

      return { success: true, x: result.result.value.x, y: result.result.value.y };
    });
  }

  /** Get a DOM snapshot of visible elements */
  async getDOMSnapshot(options = {}) {
    return this._enqueueCommand('getDOMSnapshot', async () => {
      const { maxDepth = 3 } = options;
      try {
        const snap = await this.client.DOMSnapshot.captureSnapshot({
          computedStyleStops: [],
          includeSAXParser: false,
          maxDepth,
        });
        return { success: true, snapshot: snap };
      } catch (err) {
        // Fallback to Runtime.evaluate
        const html = await this.client.Runtime.evaluate({
          expression: 'document.body.innerHTML',
          returnByValue: true,
        });
        return { success: true, html: html.result ? html.result.value : '' };
      }
    });
  }

  /** Execute arbitrary JavaScript in page context */
  async evaluate(js, options = {}) {
    return this._enqueueCommand('evaluate', async () => {
      const result = await this.client.Runtime.evaluate({
        expression: js,
        returnByValue: true,
        awaitPromise: !!(options.awaitPromise),
      });
      return {
        success: true,
        result: result.result ? result.result.value : undefined,
        resultDescription: result.result ? result.result.type : 'undefined',
      };
    });
  }

  /** Call a function in page context */
  async callFunction(fn, ...args) {
    return this._enqueueCommand('callFunction', async () => {
      const result = await this.client.Runtime.callFunctionOn({
        functionDeclaration: fn,
        arguments: args.map(a => ({ value: a })),
        returnByValue: true,
      });
      return {
        success: true,
        result: result.result ? result.result.value : undefined,
      };
    });
  }

  /** Get the current URL and title */
  async getPageInfo() {
    return this._enqueueCommand('getPageInfo', async () => {
      const [urlResult, titleResult] = await Promise.all([
        this.client.Runtime.evaluate({ expression: 'window.location.href', returnByValue: true }),
        this.client.Runtime.evaluate({ expression: 'document.title', returnByValue: true }),
      ]);
      return {
        url: urlResult.result ? urlResult.result.value : '',
        title: titleResult.result ? titleResult.result.value : '',
        tabId: this._tabId,
      };
    });
  }

  // ── Queue & Retry ───────────────────────────────────────────────────────────

  /** Enqueue a command with automatic retry on disconnect */
  _enqueueCommand(type, fn, retries = 3) {
    return new Promise(async (resolve, reject) => {
      this._commandQueue.push({ type, fn, retries, resolve, reject });
      if (!this._processingQueue) {
        this._processQueue();
      }
    });
  }

  /** Process the command queue sequentially */
  async _processQueue() {
    if (this._processingQueue || !this._connected) return;
    this._processingQueue = true;

    while (this._commandQueue.length > 0 && this._connected) {
      const cmd = this._commandQueue.shift();
      try {
        const result = await cmd.fn();
        cmd.resolve(result);
      } catch (err) {
        if (cmd.retries > 0) {
          // Put it back in queue with one less retry
          cmd.retries -= 1;
          this._commandQueue.unshift(cmd);
          await this._delay(500);
        } else {
          cmd.reject(err);
        }
      }
    }

    this._processingQueue = false;
  }

  /** Wait for Page.loadEventFired */
  _waitForLoad(timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(), timeout);
      this.client.Page.loadEventFired && this.client.Page.loadEventFired.once(() => {
        clearTimeout(timer);
        resolve();
      });
      // If event already fired, resolve immediately
      setTimeout(resolve, 500); // fallback timeout
    });
  }

  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Status ──────────────────────────────────────────────────────────────────

  get isConnected() {
    return this._connected && this.client !== null;
  }

  async close() {
    if (this._retryTimeout) {
      clearTimeout(this._retryTimeout);
      this._retryTimeout = null;
    }
    this._commandQueue = [];
    await this._cleanup();
    this.emit('disconnected');
  }
}

module.exports = { CDPRelay };