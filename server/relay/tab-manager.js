'use strict';

const { EventEmitter } = require('events');

/**
 * Multi-Tab Manager
 * Manages multiple browser tabs, shared context, and tab lifecycle.
 */

class TabManager extends EventEmitter {
  constructor(cdpRelay) {
    super();
    this.cdp = cdpRelay;
    this.tabs = new Map(); // tabId → tab state
    this.activeTabId = null;
    this.suspendTimeout = 10 * 60 * 1000; // 10 min
    this._suspendTimers = new Map();
  }

  async getAllTabs() {
    try {
      const { Chrome } = require('chrome-remote-interface');
      const tabs = await Chrome.List({ host: this.cdp.host, port: this.cdp.port });
      return tabs.map(t => ({
        id: t.id,
        url: t.url,
        title: t.title,
        type: t.type,
      }));
    } catch (err) {
      return [];
    }
  }

  async createTab(url) {
    try {
      const { Chrome } = require('chrome-remote-interface');
      const target = await Chrome.New({ 
        url, 
        host: this.cdp.host, 
        port: this.cdp.port 
      });
      const tab = {
        id: String(target.id),
        url,
        state: 'active',
        createdAt: Date.now(),
        lastSeen: Date.now(),
        tweetCount: 0,
      };
      this.tabs.set(tab.id, tab);
      this.activeTabId = tab.id;
      this.emit('tab:created', tab);
      return tab;
    } catch (err) {
      this.emit('error', err);
      return null;
    }
  }

  async closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;
    
    try {
      const { Chrome } = require('chrome-remote-interface');
      await Chrome.Close({ id: tabId, host: this.cdp.host, port: this.cdp.port });
      this.tabs.delete(tabId);
      if (this.activeTabId === tabId) {
        this.activeTabId = this.tabs.keys().next().value || null;
      }
      this.emit('tab:closed', tabId);
      return true;
    } catch (err) {
      this.emit('error', err);
      return false;
    }
  }

  async switchTo(tabId) {
    if (!this.tabs.has(tabId)) return false;
    
    // Clear suspend timer
    this._clearSuspendTimer(tabId);
    
    this.activeTabId = tabId;
    const tab = this.tabs.get(tabId);
    tab.lastSeen = Date.now();
    tab.state = 'active';
    
    // Connect CDP to this tab
    try {
      await this.cdp.connect(tabId);
      this.emit('tab:activated', tab);
      return true;
    } catch (err) {
      this.emit('error', err);
      return false;
    }
  }

  getActiveTab() {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }

  getTab(tabId) {
    return this.tabs.get(tabId);
  }

  getAll() {
    return Array.from(this.tabs.values());
  }

  incrementTweetCount(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.tweetCount++;
      tab.lastSeen = Date.now();
    }
  }

  markSeen(tabId) {
    const tab = this.tabs.get(tabId);
    if (tab) {
      tab.lastSeen = Date.now();
      if (tab.state === 'suspended') {
        tab.state = 'active';
        this.emit('tab:resumed', tab);
      } else {
        this._resetSuspendTimer(tabId);
      }
    }
  }

  _resetSuspendTimer(tabId) {
    this._clearSuspendTimer(tabId);
    const timer = setTimeout(() => {
      this._suspendTab(tabId);
    }, this.suspendTimeout);
    this._suspendTimers.set(tabId, timer);
  }

  _clearSuspendTimer(tabId) {
    if (this._suspendTimers.has(tabId)) {
      clearTimeout(this._suspendTimers.get(tabId));
      this._suspendTimers.delete(tabId);
    }
  }

  async _suspendTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.state === 'suspended') return;
    
    tab.state = 'suspended';
    try {
      await this.cdp.close();
    } catch {}
    this.emit('tab:suspended', tab);
  }

  setSuspendTimeout(ms) {
    this.suspendTimeout = ms;
  }
}

module.exports = { TabManager };