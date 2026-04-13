'use strict';

const { WebSocketServer } = require('ws');

/**
 * WebSocket Event Router
 * Handles real-time bidirectional communication with clients.
 */

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server: server.httpServer, path: '/ws' });
  const clients = new Set();

  wss.on('connection', (ws, req) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const client = { id: clientId, ws, subscriptions: new Set(), alive: true };
    clients.add(client);

    ws.on('pong', () => { client.alive = true; });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        handleMessage(client, msg, server);
      } catch {}
    });

    ws.on('close', () => {
      clients.delete(client);
    });

    ws.on('error', () => {
      clients.delete(client);
    });

    // Send welcome
    send(client, { type: 'connected', clientId });
  });

  // Heartbeat to keep connections alive
  const interval = setInterval(() => {
    wss.clients.forEach(ws => {
      const client = [...clients].find(c => c.ws === ws);
      if (!client?.alive) return ws.terminate();
      client.alive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  // Wire server events to broadcast
  if (server.intel) {
    server.intel.on('tweet', (tweet) => {
      broadcast({ type: 'tweet', data: tweet }, clients, 'tweet');
    });
    server.intel.on('anomaly', ({ tweet, anomaly }) => {
      broadcast({ type: 'anomaly', data: { tweet, anomaly } }, clients, 'anomaly');
    });
    server.intel.on('trend', (trend) => {
      broadcast({ type: 'trend', data: trend }, clients, 'trend');
    });
    server.intel.on('highInsight', (tweet) => {
      broadcast({ type: 'insight', data: tweet }, clients, 'insight');
    });
  }

  if (server.delivery) {
    server.delivery.alertQueue.on?.('alert', (alert) => {
      broadcast({ type: 'alert', data: alert }, clients, 'alert');
    });
  }

  if (server.cdp) {
    server.cdp.on('lifecycle', (ev) => {
      broadcast({ type: 'lifecycle', data: ev }, clients, 'lifecycle');
    });
    server.cdp.on('network:response', (ev) => {
      // Only Twitter GraphQL
      if (ev.response?.url?.includes('graphql.twitter.com')) {
        broadcast({ type: 'graphql', data: ev }, clients, 'graphql');
      }
    });
  }

  return wss;
}

function handleMessage(client, msg, server) {
  switch (msg.type) {
    case 'subscribe':
      if (Array.isArray(msg.events)) {
        msg.events.forEach(e => client.subscriptions.add(e));
      }
      send(client, { type: 'subscribed', events: [...client.subscriptions] });
      break;

    case 'unsubscribe':
      if (Array.isArray(msg.events)) {
        msg.events.forEach(e => client.subscriptions.delete(e));
      }
      break;

    case 'command':
      handleCommand(client, msg, server);
      break;

    case 'ping':
      send(client, { type: 'pong' });
      break;
  }
}

async function handleCommand(client, msg, server) {
  const { action, params = {}, id } = msg;
  
  try {
    let result;
    switch (action) {
      case 'scroll':
        await server.checkScroll?.();
        result = await server.cdp.scrollBy(params.deltaY || 300);
        break;
      case 'scrollTo':
        await server.checkScroll?.();
        result = await server.cdp.scrollTo(params.y || 0);
        break;
      case 'click':
        await server.checkClick?.();
        result = await server.cdp.click(params.selector);
        break;
      case 'navigate':
        result = await server.cdp.navigate(params.url);
        break;
      case 'extract':
        await server.checkScan?.();
        const tweets = await server.semantic.extractTweets();
        result = { tweets, count: tweets.length };
        break;
      case 'search':
        await server.cdp.navigate(`https://twitter.com/search?q=${encodeURIComponent(params.query)}&src=typed_query`);
        await new Promise(r => setTimeout(r, 2000));
        const found = await server.semantic.extractTweets();
        result = { query: params.query, count: found.length };
        break;
      default:
        result = { error: `unknown action: ${action}` };
    }
    send(client, { type: 'command_result', id, success: true, result });
  } catch (err) {
    send(client, { type: 'command_result', id, success: false, error: err.message });
  }
}

function send(client, msg) {
  if (client.ws.readyState === 1) { // OPEN
    client.ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg, clients, eventType) {
  clients.forEach(client => {
    if (client.subscriptions.has(eventType) || client.subscriptions.has('*')) {
      send(client, msg);
    }
  });
}

module.exports = { setupWebSocket };