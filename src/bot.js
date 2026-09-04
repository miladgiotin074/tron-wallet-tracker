import { Telegraf } from "telegraf";
import { escapeHtml, isTronAddress, sunToTrx } from "./address.js";

const HELP_TEXT = `
<b>ربات مانیتور ولت ترون</b>

هر واریز TRX به ولت‌های اضافه‌شده، از روی لیست تراکنش همان ولت (مثل صفحه ترون‌اسکن) برای ادمین ارسال می‌شود.

<b>دستورات</b>
/add <code>آدرس</code> [نام]
/remove <code>آدرس یا نام</code>
/list
/status
/ping
/test
/help

می‌توانید خود آدرس را هم بدون دستور بفرستید تا اضافه شود.
`.trim();

export function createBot({ token, adminIds, store, client, monitor }) {
  const bot = new Telegraf(token);

  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (!adminIds.length) {
      if (ctx.message?.text) {
        await ctx.reply(
          [
            "هنوز ادمینی تنظیم نشده.",
            `آیدی تلگرام شما: <code>${userId}</code>`,
            "این عدد را در <code>TELEGRAM_ADMIN_IDS</code> فایل <code>.env</code> بگذارید و ربات را دوباره اجرا کنید.",
          ].join("\n"),
          { parse_mode: "HTML" }
        );
      }
      return;
    }

    if (!adminIds.includes(userId)) return;
    if (ctx.chat?.id) store.addNotifyChat(ctx.chat.id);
    return next();
  });

  bot.start((ctx) => ctx.reply(HELP_TEXT, { parse_mode: "HTML" }));
  bot.command("help", (ctx) => ctx.reply(HELP_TEXT, { parse_mode: "HTML" }));

  bot.command("add", async (ctx) => {
    const { address, label } = parseAddArgs(ctx.message.text);
    await handleAdd(ctx, { address, label, store, client });
  });

  bot.command("remove", async (ctx) => {
    const query = (ctx.message.text || "").split(/\s+/).slice(1).join(" ").trim();
    if (!query) {
      await ctx.reply("مثال: <code>/remove T... </code> یا <code>/remove کیف۱</code>", {
        parse_mode: "HTML",
      });
      return;
    }
    const wallet = await store.removeWallet(query);
    if (!wallet) {
      await ctx.reply("این ولت در لیست نیست.");
      return;
    }
    await ctx.reply(
      `ولت حذف شد:\n<code>${escapeHtml(wallet.address)}</code>${
        wallet.label ? `\nنام: ${escapeHtml(wallet.label)}` : ""
      }`,
      { parse_mode: "HTML" }
    );
  });

  bot.command("list", async (ctx) => {
    const wallets = store.getWallets();
    if (!wallets.length) {
      await ctx.reply("هنوز ولتی اضافه نشده. با /add شروع کنید.");
      return;
    }

    const lines = await Promise.all(
      wallets.map(async (wallet, index) => {
        let balance = "—";
        try {
          balance = `${sunToTrx(await client.getTrxBalance(wallet.address))} TRX`;
        } catch {
          balance = "خطا در خواندن موجودی";
        }
        const name = wallet.label ? ` — ${escapeHtml(wallet.label)}` : "";
        return `${index + 1}. <code>${wallet.address}</code>${name}\nموجودی: <b>${balance}</b>`;
      })
    );

    await ctx.reply(`<b>ولت‌های تحت نظر (${wallets.length})</b>\n\n${lines.join("\n\n")}`, {
      parse_mode: "HTML",
    });
  });

  bot.command("status", async (ctx) => {
    const uptimeMin = Math.floor((Date.now() - monitor.startedAt) / 60000);
    const node = monitor.stats.currentNode || client.provider || "-";
    await ctx.reply(
      [
        "<b>وضعیت مانیتور</b>",
        `ولت‌ها: <b>${store.getWallets().length}</b>`,
        `منبع: <b>${escapeHtml(node)}</b>`,
        `آخرین بلاک دیده‌شده: <code>${monitor.stats.lastHead || store.lastBlock || "-"}</code>`,
        `زمان پُل: <b>${monitor.stats.lastPollMs}ms</b>`,
        `آخرین چک: ${monitor.stats.lastPollAt ? `<b>${Math.round((Date.now() - monitor.stats.lastPollAt) / 1000)}s</b> پیش` : "هنوز چک نشده — ربات را ری‌استارت کنید"}`,
        `واریزهای دیده‌شده: <b>${monitor.stats.deposits}</b>`,
        `خطاها: ${monitor.stats.errors}`,
        `آپتایم: ${uptimeMin} دقیقه`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  });

  bot.command("ping", async (ctx) => {
    const t0 = Date.now();
    try {
      const result = await client.ping();
      await ctx.reply(
        `pong\nمنبع: <b>${escapeHtml(result.provider)}</b>\nبلاک: <code>${result.block || "-"}</code>\nتأخیر: <b>${result.ms || Date.now() - t0}ms</b>`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      await ctx.reply(`خطای منبع: ${escapeHtml(error.message)}`, { parse_mode: "HTML" });
    }
  });

  bot.command("test", async (ctx) => {
    const wallets = store.getWallets();
    if (!wallets.length) {
      await ctx.reply("اول با /add یک ولت اضافه کنید.");
      return;
    }
    try {
      await ctx.reply("در حال خواندن آخرین واریز TRX از ترون‌اسکن...");
      const deposits = await client.getIncomingTrx(wallets[0].address);
      if (!deposits.length) {
        await ctx.reply("برای این ولت واریز TRX پیدا نشد.");
        return;
      }
      const newest = [...deposits].sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0))[0];
      await ctx.reply(
        formatDeposit({
          ...newest,
          label: wallets[0].label,
          detectDelayMs: Date.now() - (newest.blockTime || Date.now()),
        }),
        { parse_mode: "HTML", disable_web_page_preview: true }
      );
    } catch (error) {
      await ctx.reply(`خطا: ${escapeHtml(error.message)}`, { parse_mode: "HTML" });
    }
  });

  bot.on("text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return;
    const parts = text.split(/\s+/);
    if (isTronAddress(parts[0])) {
      await handleAdd(ctx, {
        address: parts[0],
        label: parts.slice(1).join(" "),
        store,
        client,
      });
    }
  });

  monitor.on("deposit", async (deposit) => {
    const message = formatDeposit(deposit);
    await notifyAdmins(bot, adminIds, store, message);
  });

  monitor.on("gap", async (gap) => {
    await notifyAdmins(
      bot,
      adminIds,
      store,
      `ربات عقب افتاد و بلاک‌های <code>${gap.skippedFrom}</code> تا <code>${gap.skippedTo}</code> را رد کرد تا به هد زنجیره برسد.`
    );
  });

  bot.catch((error) => {
    console.error("[telegram]", error.message || error);
  });

  return bot;
}

async function handleAdd(ctx, { address, label, store, client }) {
  if (!address || !isTronAddress(address)) {
    await ctx.reply("آدرس ترون معتبر نیست. مثال:\n<code>/add T... کیف اصلی</code>", {
      parse_mode: "HTML",
    });
    return;
  }

  try {
    const wallet = await store.addWallet(address, label);
    let extra = "";
    try {
      extra = `\nموجودی فعلی: <b>${sunToTrx(await client.getTrxBalance(address))} TRX</b>`;
    } catch {
      extra = "";
    }
    await ctx.reply(
      [
        "ولت اضافه شد و از این لحظه واریز TRX مانیتور می‌شود.",
        `<code>${wallet.address}</code>`,
        wallet.label ? `نام: ${escapeHtml(wallet.label)}` : "",
        extra,
      ]
        .filter(Boolean)
        .join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (error) {
    if (error.message === "duplicate") {
      await ctx.reply("این ولت از قبل در لیست است.");
      return;
    }
    await ctx.reply("اضافه کردن ولت ناموفق بود.");
  }
}

function parseAddArgs(text) {
  const parts = String(text || "")
    .split(/\s+/)
    .slice(1);
  return {
    address: parts[0] || "",
    label: parts.slice(1).join(" "),
  };
}

export function formatDeposit(deposit) {
  const kind =
    deposit.kind === "internal" ? "واریز داخلی (از قرارداد)" : "انتقال مستقیم TRX";
  const delaySec = (Number(deposit.detectDelayMs || 0) / 1000).toFixed(2);
  const when = deposit.blockTime
    ? new Date(deposit.blockTime).toISOString().replace("T", " ").replace("Z", " UTC")
    : "-";
  const name = deposit.label ? `\nنام ولت: <b>${escapeHtml(deposit.label)}</b>` : "";

  return [
    "⚡️ <b>واریز TRX</b>",
    "",
    `مبلغ: <b>${sunToTrx(deposit.amountSun)} TRX</b>`,
    `نوع: ${kind}`,
    `ولت مقصد: <code>${deposit.to}</code>${name}`,
    `فرستنده: <code>${deposit.from || "-"}</code>`,
    `بلاک: <code>${deposit.blockNumber}</code>`,
    `زمان بلاک: ${escapeHtml(when)}`,
    `تأخیر تشخیص: <b>${delaySec}s</b>`,
    "",
    "هش تراکنش:",
    `<code>${deposit.txid}</code>`,
    "",
    "لینک ترون‌اسکن:",
    `<code>https://tronscan.org/#/transaction/${deposit.txid}</code>`,
  ].join("\n");
}

async function notifyAdmins(bot, adminIds, store, html) {
  const chats = [...new Set([...(adminIds || []), ...(store?.getNotifyChats?.() || [])])];
  if (!chats.length) {
    console.error("[telegram] no chat to notify");
    return;
  }
  const results = await Promise.allSettled(
    chats.map((chatId) =>
      bot.telegram.sendMessage(chatId, html, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      })
    )
  );
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("[telegram] send failed:", result.reason?.message || result.reason);
    }
  }
}
