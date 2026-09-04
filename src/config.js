import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseAdminIds(raw) {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export function loadConfig() {
  const requestedPoll = Number(process.env.POLL_INTERVAL_MS || 2500);
  const pollIntervalMs = Number.isFinite(requestedPoll) ? requestedPoll : 2500;
  const port = Number(process.env.PORT);
  const dataDir = (process.env.DATA_DIR || path.join(rootDir, "data")).trim();

  return {
    rootDir,
    dataDir,
    dataFile: path.join(dataDir, "state.json"),
    telegramToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || "",
    adminIds: parseAdminIds(process.env.TELEGRAM_ADMIN_IDS),
    port: Number.isInteger(port) && port > 0 ? port : 0,
    explorer: {
      tronscanUrl: (process.env.TRONSCAN_API_URL || "https://apilist.tronscanapi.com").replace(
        /\/+$/,
        ""
      ),
      tronscanApiKey: process.env.TRONSCAN_API_KEY?.trim() || "",
      trongridUrl: (process.env.TRONGRID_API_URL || "https://api.trongrid.io").replace(
        /\/+$/,
        ""
      ),
      trongridApiKey: process.env.TRONGRID_API_KEY?.trim() || "",
      pollIntervalMs: Math.max(1500, pollIntervalMs),
      minRequestGapMs: Number(process.env.MIN_REQUEST_GAP_MS || 400),
      requestTimeoutMs: 8000,
    },
  };
}
