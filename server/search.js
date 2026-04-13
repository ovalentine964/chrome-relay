#!/usr/bin/env node
/**
 * DuckDuckGo Search Tool
 * Powerful, no-API-key web search for agents
 * 
 * Usage:
 *   node search.js "your search query" [--limit=10] [--json]
 * 
 * Or import as module:
 *   const { ddgSearch } = require('./search');
 *   const results = await ddgSearch("query", { limit: 10 });
 */

const https = require('https');
const { URL } = require('url');

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const ACCEPT_LANGUAGE = 'en-US,en;q=0.9';
const DDG_LITE = 'lite.duckduckgo.com';

/**
 * Search DuckDuckGo HTML and parse results
 * @param {string} query - Search query
 * @param {object} options - { limit: number, safeSearch: boolean }
 * @returns {Promise<Array>} Array of search results
 */
async function ddgSearch(query, options) {
  options = options || {};
  const limit = options.limit || 10;
  const safeSearch = options.safeSearch !== false;

  const params = new URLSearchParams({ q: query, kl: 'us-en' });

  const reqOptions = {
    hostname: DDG_LITE,
    path: '/html/?' + params.toString(),
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': ACCEPT_LANGUAGE,
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    }
  };

  return new Promise(function(resolve, reject) {
    var req = https.get(reqOptions, function(res) {
      if ([301, 302, 303, 307, 308].indexOf(res.statusCode) !== -1) {
        var redirectUrl = res.headers.location;
        if (redirectUrl) {
          var rUrl = new URL(redirectUrl);
          var ro = {
            hostname: rUrl.hostname,
            path: rUrl.pathname + rUrl.search,
            method: 'GET',
            headers: reqOptions.headers
          };
          https.get(ro, function(r2) { handleResponse(r2, resolve, reject); })
              .on('error', reject);
          return;
        }
      }
      handleResponse(res, resolve, reject);
    });
    req.on('error', reject);
    req.setTimeout(15000, function() {
      req.destroy();
      reject(new Error('Search request timeout'));
    });
  });
}

function handleResponse(res, resolve, reject) {
  var chunks = [];
  res.on('data', function(chunk) { chunks.push(chunk); });
  res.on('end', function() {
    var data = Buffer.concat(chunks).toString('utf8');
    try {
      var results = parseDDGHTML(data);
      resolve(results);
    } catch (e) {
      reject(new Error('Failed to parse results: ' + e.message));
    }
  });
}

function parseDDGHTML(html) {
  var results = [];
  var resultBlocks = html.split(/class="result["']/);
  
  for (var i = 1; i < resultBlocks.length; i++) {
    (function(block) {
      var titleMatch = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/s);
      if (!titleMatch) return;
      
      var url = decodeHTMLEntities(titleMatch[1]);
      var titleRaw = titleMatch[2];
      var title = stripHTML(titleRaw);
      
      var snippetMatch = block.match(/class="result__snippet"[^>]*>(.*?)<\/a>/s);
      var snippet = snippetMatch ? stripHTML(snippetMatch[1]) : '';
      
      var domain = '';
      try { domain = new URL(url).hostname.replace('www.', ''); } catch (e) {}
      
      if (title && url && url.indexOf('http') === 0) {
        results.push({ title: title.trim(), url: url, snippet: snippet.trim(), domain: domain });
      }
    })(resultBlocks[i]);
    
    if (results.length >= 20) break;
  }
  
  return results;
}

function stripHTML(str) {
  return str
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

function decodeHTMLEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ─── CLI Interface ────────────────────────────────────────────────────────────

async function main() {
  var args = process.argv.slice(2);
  
  if (args.indexOf('--help') !== -1 || args.indexOf('-h') !== -1 || args.length === 0) {
    console.log('\nDuckDuckGo Search Tool\n========================\nUsage:\n  node search.js "your search query" [options]\n\nOptions:\n  --limit=N     Maximum results to return (default: 10, max: 20)\n  --json        Output raw JSON (for agent consumption)\n  --verbose     Show extra debug info\n  --help        Show this help\n\nExamples:\n  node search.js "Niko Kadi Kenya movement"\n  node search.js "IEBC election Kenya 2027" --limit=20 --json\n  node search.js "AI agent framework comparison" --verbose\n');
    process.exit(0);
  }

  var queryArgs = args.filter(function(a) { return a.indexOf('--') !== 0; });
  var query = queryArgs.join(' ');
  var limitMatch = args.find(function(a) { return a.match(/^--limit=(\d+)$/); });
  var limit = limitMatch ? parseInt(limitMatch.split('=')[1]) : 10;
  var jsonOutput = args.indexOf('--json') !== -1;
  var verbose = args.indexOf('--verbose') !== -1;

  if (!query) {
    console.error('Error: No search query provided. Use --help for usage.');
    process.exit(1);
  }

  if (verbose) console.error('[search] Query: "' + query + '" (limit=' + limit + ')');

  try {
    var results = await ddgSearch(query, { limit: limit });
    
    if (jsonOutput) {
      console.log(JSON.stringify({ query: query, count: results.length, results: results }, null, 2));
    } else {
      console.log('\nResults for: "' + query + '" (' + results.length + ' found)\n');
      results.slice(0, limit).forEach(function(r, i) {
        console.log((i + 1) + '. ' + r.title);
        console.log('   -> ' + r.url);
        if (r.snippet) console.log('   Snippet: ' + r.snippet.substring(0, 150) + (r.snippet.length > 150 ? '...' : ''));
        console.log('');
      });
    }
  } catch (e) {
    if (verbose) console.error('Error: ' + e.message);
    if (jsonOutput) {
      console.log(JSON.stringify({ error: e.message, query: query }, null, 2));
    } else {
      console.error('Search failed: ' + e.message);
    }
    process.exit(1);
  }
}

module.exports = { ddgSearch: ddgSearch, parseDDGHTML: parseDDGHTML };

if (require.main === module) {
  main();
}