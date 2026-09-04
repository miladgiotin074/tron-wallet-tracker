import "dotenv/config";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { TronExplorer } from "./explorer.js";
import { TronMonitor } from "./monitor.js";
import { createBot } from "./bot.js";
import { startHealthServer } from "./health.js";

const config = loadConfig();

if (!config.telegramToken) {
  console.error("TELEGRAM_BOT_TOKEN در فایل .env تنظیم نشده است.");
  process.exit(1);
}

const store = new Store(config.dataFile);
const client = new TronExplorer(config.explorer);
const monitor = new TronMonitor({
  client,
  store,
  pollIntervalMs: config.explorer.pollIntervalMs,
});
const bot = createBot({
  token: config.telegramToken,
  adminIds: config.adminIds,
  store,
  client,
  monitor,
});

await store.load();

if (config.port) {
  await startHealthServer(config.port, () => ({
    wallets: store.getWallets().length,
    provider: client.provider,
    lastPollAt: monitor.stats.lastPollAt || 0,
    deposits: monitor.stats.deposits,
  }));
}

monitor.on("deposit", (deposit) => {
  console.log(
    `[deposit] ${deposit.amountSun / 1_000_000} TRX -> ${deposit.to} ${deposit.txid}`
  );
});

monitor.start();

bot.launch({ dropPendingUpdates: true }, () => {
  console.log("اتصال تلگرام برقرار شد.");
  const chats = [...new Set([...config.adminIds, ...store.getNotifyChats()])];
  const text = [
    "مانیتور ولت روشن شد.",
    `${store.getWallets().length} ولت تحت نظر است.`,
    "واریزهای قبلی اعلام نمی‌شوند؛ از این لحظه هر واریز جدید TRX پیام می‌آید.",
  ].join("\n");
  for (const chatId of chats) {
    bot.telegram.sendMessage(chatId, text).catch((error) => {
      console.error("[telegram] startup notify failed:", error.message);
    });
  }
}).catch((error) => {
  console.error("[telegram] launch failed:", error);
});

console.log(
  [
    "ربات تلگرام روشن شد.",
    `ادمین‌ها: ${config.adminIds.join(", ") || "تنظیم نشده"}`,
    `ولت‌ها: ${store.getWallets().length}`,
    `پُل: ${config.explorer.pollIntervalMs}ms`,
    `داده: ${config.dataFile}`,
    config.port ? `health: 0.0.0.0:${config.port}` : "health: off (no PORT)",
    `منبع: ${client.provider}`,
    config.explorer.tronscanApiKey
      ? "Tronscan API key: دارد"
      : "Tronscan API key: ندارد — واریز هر ولت از API حساب خوانده می‌شود (لینک ترون‌اسکن در پیام)",
  ].join("\n")
);

async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  monitor.stop();
  bot.stop(signal);
  await store.saveNow();
  process.exit(0);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
