const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const INIT_ENGINE = require("stockfish/src/stockfish-17.1-lite-51f59da.js");

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

const evaluateFen = (fen) =>
  new Promise((resolve) => {
    engineWrapper.postMessage(`position fen ${fen}`);
    engineWrapper.postMessage("go depth 12");
    engineWrapper.onmessage = (line) => {
      if (typeof line === "string" && line.includes("score")) {
        if (line.includes("score cp")) {
          const cp = Number(line.split("score cp ")[1].split(" ")[0]);
          resolve(cp / 100);
        } else if (line.includes("score mate")) {
          const mate = Number(line.split("score mate ")[1].split(" ")[0]);
          resolve(mate > 0 ? 9999 : -9999);
        }
      }
    };
  });

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

async function fetchJSON(url) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36"
  );

  await page.goto("https://2700chess.com", {
    waitUntil: "networkidle2",
    timeout: 60000
  });

  const data = await page.evaluate(async (endpoint) => {
    const res = await fetch(endpoint);
    return await res.json();
  }, url);

  await browser.close();
  return data;
}

async function scrape2700() {
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

  fs.writeFileSync(
    "chesspulse_filtered.json",
    JSON.stringify(output, null, 2),
    "utf-8"
  );

  console.log("✔ Saved: chesspulse_filtered.json");
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
    console.log("Starting scrape...");
    const result = await scrape2700();
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Scrape error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/scrape-cached", (req, res) => {
  const filePath = path.join(__dirname, "chesspulse_filtered.json");
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: "No cached data. Run /scrape first." });
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(5000, () => console.log("Listening on http://localhost:5000"));