const express = require("express");
const cors = require("cors");
// Load the Stockfish build and initialize it for Node.js (based on examples).
const fs = require("fs");
const path = require("path");
const INIT_ENGINE = require("stockfish/src/stockfish-17.1-lite-51f59da.js");

const app = express();
app.use(cors());

// Prepare engine paths and options similar to the package examples.
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

// If the wasm is split into parts, assemble them.
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
  // ignore; fallback behavior will try to load .wasm via locateFile
}

// Wrapper that mimics a worker-like interface used in this file: `postMessage` + `onmessage`.
const engineWrapper = {
  onmessage: null,
  postMessage: function (msg) {
    // The actual engine expects command via ccall("command"...)
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

// Initialize the engine module and wire its listener back to our wrapper.
if (typeof INIT_ENGINE === "function") {
  const Stockfish = INIT_ENGINE();
  Stockfish(engineOptions).then(() => {
    // engineOptions now has ccall / _isReady / etc. Provide sendCommand helper.
    engineOptions.sendCommand = function (cmd) {
      setImmediate(function () {
        engineOptions.ccall("command", null, ["string"], [cmd], { async: /^go\b/.test(cmd) });
      });
    };

    // Bridge the engine listener to our wrapper.onmessage
    engineOptions.listener = function (line) {
      if (engineWrapper.onmessage) engineWrapper.onmessage(line);
    };

    // Start engine (send uci) when ready
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

app.get("/evaluate", async (req, res) => {
  const { fen } = req.query;
  if (!fen) return res.status(400).json({ error: "fen missing" });
  const evaluation = await evaluateFen(fen);
  res.json({ evaluation: Math.round(evaluation * 10) / 10 });
});

app.listen(5000, () => console.log("Listening on http://localhost:5000"));