const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const INIT_ENGINE = require("stockfish/src/stockfish-17.1-lite-51f59da.js");

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

app.get("/evaluate", async (req, res) => {
  const { fen } = req.query;
  if (!fen) return res.status(400).json({ error: "fen missing" });
  const evaluation = await evaluateFen(fen);
  res.json({ evaluation: Math.round(evaluation * 10) / 10 });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});