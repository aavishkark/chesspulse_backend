const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const INIT_ENGINE = require("stockfish/src/stockfish-17.1-lite-51f59da.js");

// In-memory cache with TTL
const cache = {
  scrapeData: null,
  scrapeTime: 0,
  TTL: 60 * 60 * 1000 // 1 hour in milliseconds
};

let isScraping = false;
const evalQueue = [];
let isProcessingEval = false;

const app = express();
app.use(cors());

const pathToEngine = path.join(__dirname, "node_modules", "stockfish", "src", "stockfish-17.1-lite-51f59da.js");
const ext = path.extname(pathToEngine);
const basepath = pathToEngine.slice(0, -ext.length);
const wasmPath = basepath + ".wasm";

const engineOptions = {
  locateFile: function (p) {
    if (p.indexOf(".wasm") > -1) {
      if (p.indexOf(".wasm.map") > -1) return wasmPath + ".map";
      return wasmPath;
    }
    return pathToEngine;
  },
};

try {
  const engineDir = path.dirname(pathToEngine);
  const basename = path.basename(basepath);
  const parts = fs.readdirSync(engineDir).filter((f) => f.startsWith(basename + "-part-") && f.endsWith(".wasm")).sort();
  if (parts.length) {
    const buffers = parts.map((p) => fs.readFileSync(path.join(engineDir, p)));
    engineOptions.wasmBinary = Buffer.concat(buffers);
  } else if (fs.existsSync(wasmPath)) {
    engineOptions.wasmBinary = fs.readFileSync(wasmPath);
  }
} catch (e) {
}

const engineWrapper = {
  onmessage: null,
  postMessage: function (msg) {
    if (engineOptions.sendCommand) {
      engineOptions.sendCommand(String(msg));
    } else if (engineOptions.ccall) {
      setImmediate(() => engineOptions.ccall("command", null, ["string"], [String(msg)], { async: /^go\b/.test(msg) }));
    }
  },
  terminate: function () {
    if (engineOptions.terminate) engineOptions.terminate();
  },
};

if (typeof INIT_ENGINE === "function") {
  const Stockfish = INIT_ENGINE();
  Stockfish(engineOptions).then(() => {
    engineOptions.sendCommand = function (cmd) {
      setImmediate(function () {
        engineOptions.ccall("command", null, ["string"], [cmd], { async: /^go\b/.test(cmd) });
      });
    };

    engineOptions.listener = function (line) {
      if (engineWrapper.onmessage) engineWrapper.onmessage(line);
    };

    if (!engineOptions._isReady || engineOptions._isReady()) {
      engineWrapper.postMessage("uci");
    } else {
      const check = function () {
        if (engineOptions._isReady && engineOptions._isReady()) {
          engineWrapper.postMessage("uci");
        } else {
          setTimeout(check, 20);
        }
      };
      check();
    }
  }).catch((err) => {
    console.error("Failed to initialize Stockfish engine:", err);
  });
} else {
  console.error("Stockfish initializer not found in package");
}

// Queue-based evaluation to prevent concurrency issues
const evaluateFen = (fen) =>
  new Promise((resolve, reject) => {
    evalQueue.push({ fen, resolve, reject });
    processEvalQueue();
  });

const processEvalQueue = async () => {
  if (isProcessingEval || evalQueue.length === 0) return;
  
  isProcessingEval = true;
  const { fen, resolve, reject } = evalQueue.shift();
  
  try {
    const result = await new Promise((resolveEval, rejectEval) => {
      const timeout = setTimeout(() => {
        rejectEval(new Error("Evaluation timeout"));
      }, 30000);
      
      engineWrapper.postMessage(`position fen ${fen}`);
      engineWrapper.postMessage("go depth 12");
      
      engineWrapper.onmessage = (line) => {
        if (typeof line === "string" && line.includes("score")) {
          clearTimeout(timeout);
          if (line.includes("score cp")) {
            const cp = Number(line.split("score cp ")[1].split(" ")[0]);
            resolveEval(cp / 100);
          } else if (line.includes("score mate")) {
            const mate = Number(line.split("score mate ")[1].split(" ")[0]);
            resolveEval(mate > 0 ? 9999 : -9999);
          }
        }
      };
    });
    resolve(result);
  } catch (error) {
    reject(error);
  } finally {
    isProcessingEval = false;
    if (evalQueue.length > 0) {
      setImmediate(processEvalQueue);
    }
  }
};

// ========== 2700chess.com SCRAPER ==========

const ENDPOINTS = {
  general: {
    standard: "https://2700chess.com/ajax/index-json?sort=standard&per-page=100",
    rapid: "https://2700chess.com/ajax/index-json?sort=live_rapid_pos&per-page=100",
    blitz: "https://2700chess.com/ajax/index-json?sort=live_blitz_pos&per-page=100",
    juniors: "https://2700chess.com/ajax/index-json?sort=live_juniors_pos&per-page=100"
  },
  women: {
    standard: "https://2700chess.com/ajax/index-json-women?sort=standard&per-page=100",
    rapid: "https://2700chess.com/ajax/index-json-women?sort=live_rapid_pos&per-page=100",
    blitz: "https://2700chess.com/ajax/index-json-women?sort=live_blitz_pos&per-page=100",
    girls: "https://2700chess.com/ajax/index-json-women?sort=live_girls_pos&per-page=100"
  }
};

// Direct fetch with rotating user agents and retry logic
async function fetchJSON(url, retries = 3) {
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"
  ];

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": userAgent,
          "Referer": "https://2700chess.com",
          "Accept": "application/json",
          "Accept-Language": "en-US,en;q=0.9"
        },
        timeout: 10000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log(`✓ Fetched ${url.split('?')[0]} (attempt ${attempt + 1})`);
      return data;
    } catch (error) {
      console.log(`⚠ Fetch failed for ${url.split('?')[0]}: ${error.message} (attempt ${attempt + 1}/${retries})`);
      
      if (attempt < retries - 1) {
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw new Error(`Failed to fetch ${url} after ${retries} attempts: ${error.message}`);
      }
    }
  }
}

async function scrape2700() {
  // Check if cache is still valid
  if (cache.scrapeData && Date.now() - cache.scrapeTime < cache.TTL) {
    console.log("Returning cached scrape data (TTL not expired)");
    return cache.scrapeData;
  }

  const output = {
    general: { standard: [], rapid: [], blitz: [] },
    women: { standard: [], rapid: [], blitz: [] },
    juniors: [],
    girls: [],
    generated_at: new Date().toISOString()
  };

  console.log("Fetching GENERAL categories...");

  /* ------------ GENERAL: FILTER 2700+ ------------- */
  for (const type of ["standard", "rapid", "blitz"]) {
    const list = await fetchJSON(ENDPOINTS.general[type]);

    const clean = list.filter(p => parseFloat(p.raiting) >= 2700);

    output.general[type] = clean;
    console.log(`General ${type}: ${clean.length} players ≥2700`);
  }

  console.log("Fetching WOMEN categories...");

  /* ------------ WOMEN: TOP 20 ------------- */
  for (const type of ["standard", "rapid", "blitz"]) {
    const list = await fetchJSON(ENDPOINTS.women[type]);

    const top20 = list.slice(0, 20);
    output.women[type] = top20;
    console.log(`Women ${type}: top 20 selected`);
  }

  console.log("Fetching JUNIORS...");
  const juniors = await fetchJSON(ENDPOINTS.general.juniors);

  output.juniors = juniors.slice(0, 20);
  console.log("Juniors: top 20 selected");

  console.log("Fetching GIRLS...");
  const girls = await fetchJSON(ENDPOINTS.women.girls);

  output.girls = girls.slice(0, 20);
  console.log("Girls: top 20 selected");

  // Cache the result
  cache.scrapeData = output;
  cache.scrapeTime = Date.now();

  console.log("✔ Scrape completed and cached");
  return output;
}

app.get("/evaluate", async (req, res) => {
  const { fen } = req.query;
  if (!fen) return res.status(400).json({ error: "fen missing" });
  const evaluation = await evaluateFen(fen);
  res.json({ evaluation: Math.round(evaluation * 10) / 10 });
});

// ========== SCRAPER ENDPOINTS ==========

app.get("/scrape", async (req, res) => {
  try {
    if (isScraping) {
      return res.status(429).json({ success: false, error: "Scrape already in progress. Please wait." });
    }

    const forceRefresh = req.query.force === "true";
    if (forceRefresh) {
      cache.scrapeData = null; // Clear cache to force fresh scrape
    }

    isScraping = true;
    console.log("Starting scrape...");
    const result = await scrape2700();
    isScraping = false;
    
    res.json({ 
      success: true, 
      data: result,
      cached: !forceRefresh && cache.scrapeTime > 0,
      cacheExpiry: new Date(cache.scrapeTime + cache.TTL).toISOString()
    });
  } catch (error) {
    isScraping = false;
    console.error("Scrape error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/scrape-cached", (req, res) => {
  if (!cache.scrapeData) {
    return res.status(404).json({ success: false, error: "No cached data. Run /scrape first." });
  }
  res.json({ 
    success: true, 
    data: cache.scrapeData,
    cacheExpiry: new Date(cache.scrapeTime + cache.TTL).toISOString()
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  process.exit(0);
});