/**
 * CoHusdex Extension — Content Script
 * Runs on twitter.com/x.com — reads DOM, intercepts GraphQL, sends to background relay.
 */

(function() {
  const RELAY_PORT = 3131;
  let relayWs = null;
  let retryTimer = null;
  let tweetObserver = null;

  // ── Connect to relay server ─────────────────────────────────────────────

  function connectRelay() {
    try {
      relayWs = new WebSocket(`ws://localhost:${RELAY_PORT}/ws`);
      
      relayWs.onopen = () => {
        console.log('[CoHusdex] Connected to relay');
        subscribe(['tweet', 'alert', 'command']);
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      };
      
      relayWs.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          handleMessage(msg);
        } catch {}
      };
      
      relayWs.onclose = () => {
        console.log('[CoHusdex] Relay disconnected, retrying in 3s');
        retryTimer = setTimeout(connectRelay, 3000);
      };
      
      relayWs.onerror = () => {
        relayWs.close();
      };
    } catch {}
  }

  // ── Message handling ────────────────────────────────────────────────────

  function handleMessage(msg) {
    if (msg.type === 'command') {
      executeCommand(msg.action, msg.params);
    }
  }

  function executeCommand(action, params) {
    switch (action) {
      case 'scroll':
        window.scrollBy(0, params.deltaY || 300);
        break;
      case 'click':
        const el = document.querySelector(params.selector);
        if (el) el.click();
        break;
      case 'extract':
        const tweets = extractVisibleTweets();
        send({ type: 'tweets', data: tweets });
        break;
      default:
        console.log('[CoHusdex] Unknown command:', action);
    }
  }

  // ── Tweet extraction ────────────────────────────────────────────────────

  function extractVisibleTweets() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const tweets = [];
    
    articles.forEach(article => {
      try {
        const link = article.querySelector('a[href*="/status/"]');
        const idMatch = link?.getAttribute('href')?.match(/\/status\/(\d+)/);
        const tweetId = idMatch?.[1];
        if (!tweetId) return;
        
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const timeEl = article.querySelector('time');
        const likeEls = article.querySelectorAll('[data-testid="like"] span');
        const retweetEls = article.querySelectorAll('[data-testid="retweet"] span');
        const replyEls = article.querySelectorAll('[data-testid="reply"] span');
        
        tweets.push({
          id: tweetId,
          text: textEl?.textContent?.trim() || '',
          timestamp: timeEl?.getAttribute('datetime') || null,
          url: link?.href || null,
          engagement: {
            likes: parseInt(likeEls[likeEls.length-1]?.textContent?.replace(/[^0-9]/,'') || '0'),
            retweets: parseInt(retweetEls[retweetEls.length-1]?.textContent?.replace(/[^0-9]/,'') || '0'),
            replies: parseInt(replyEls[replyEls.length-1]?.textContent?.replace(/[^0-9]/,'') || '0'),
          },
        });
      } catch {}
    });
    
    return tweets;
  }

  // ── MutationObserver — watch for new tweets ─────────────────────────────

  function startTweetObserver() {
    tweetObserver = new MutationObserver(mutations => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1 && node.matches?.('article[data-testid="tweet"]')) {
            handleNewTweet(node);
          }
          if (node.nodeType === 1) {
            const tweets = node.querySelectorAll?.('article[data-testid="tweet"]');
            tweets?.forEach(handleNewTweet);
          }
        });
      });
    });
    
    tweetObserver.observe(document.body, { childList: true, subtree: true });
    console.log('[CoHusdex] Tweet observer active');
  }

  function handleNewTweet(article) {
    try {
      const link = article.querySelector('a[href*="/status/"]');
      const idMatch = link?.getAttribute('href')?.match(/\/status\/(\d+)/);
      const tweetId = idMatch?.[1];
      if (!tweetId) return;
      
      const textEl = article.querySelector('[data-testid="tweetText"]');
      const timeEl = article.querySelector('time');
      const likeEls = article.querySelectorAll('[data-testid="like"] span');
      
      const tweet = {
        id: tweetId,
        text: textEl?.textContent?.trim() || '',
        timestamp: timeEl?.getAttribute('datetime') || null,
        url: link?.href || null,
        engagement: {
          likes: parseInt(likeEls[likeEls.length-1]?.textContent?.replace(/[^0-9]/,'') || '0'),
        },
      };
      
      send({ type: 'new_tweet', data: tweet });
    } catch {}
  }

  // ── Network interceptor (GraphQL) ───────────────────────────────────────

  function startNetworkInterceptor() {
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      
      try {
        const url = args[0]?.url || args[0];
        if (typeof url === 'string' && url.includes('graphql.twitter.com')) {
          const clone = response.clone();
          clone.json().then(data => {
            send({ type: 'graphql', data });
          }).catch(() => {});
        }
      } catch {}
      
      return response;
    };
    
    console.log('[CoHusdex] Network interceptor active');
  }

  // ── Relay messaging ─────────────────────────────────────────────────────

  function send(msg) {
    if (relayWs && relayWs.readyState === WebSocket.OPEN) {
      relayWs.send(JSON.stringify(msg));
    }
  }

  function subscribe(events) {
    send({ type: 'subscribe', events });
  }

  // ── Init ────────────────────────────────────────────────────────────────

  function init() {
    // Wait for Twitter to fully load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', doInit);
    } else {
      doInit();
    }
  }

  function doInit() {
    setTimeout(() => {
      startTweetObserver();
      startNetworkInterceptor();
      connectRelay();
    }, 1500);
  }

  init();
})();