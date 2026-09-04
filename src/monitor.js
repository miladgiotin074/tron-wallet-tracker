import { EventEmitter } from "node:events";
import { depositKey } from "./tron.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TronMonitor extends EventEmitter {
  constructor({ client, store, pollIntervalMs }) {
    super();
    this.client = client;
    this.store = store;
    this.pollIntervalMs = pollIntervalMs;
    this.running = false;
    this.startedAt = Date.now();
    this.stats = {
      lastHead: 0,
      lastPollMs: 0,
      lastPollAt: 0,
      lastDetectMs: 0,
      deposits: 0,
      errors: 0,
      currentNode: "",
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log("[monitor] started");
    this.loop().catch((error) => {
      console.error("[monitor] loop crashed:", error);
    });
  }

  stop() {
    this.running = false;
  }

  async loop() {
    while (this.running) {
      const t0 = Date.now();
      try {
        await this.tick();
        this.stats.lastPollMs = Date.now() - t0;
        this.stats.lastPollAt = Date.now();
        this.stats.currentNode = this.client.provider || "";
      } catch (error) {
        this.stats.errors += 1;
        console.error("[monitor]", error.message);
        if (error.code === "RATE_LIMIT") {
          await sleep(15_000);
          continue;
        }
      }

      const wait = Math.max(0, this.pollIntervalMs - (Date.now() - t0));
      await sleep(wait);
    }
  }

  async tick() {
    const wallets = this.store.getWallets();
    if (!wallets.length) return;

    for (const wallet of wallets) {
      await this.pollWallet(wallet);
    }
  }

  async pollWallet(wallet) {
    const deposits = await this.client.getIncomingTrx(wallet.address);
    deposits.sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0));

    if (!wallet.bootstrapped) {
      for (const deposit of deposits) {
        this.store.markSeen(depositKey(deposit));
      }
      await this.store.markBootstrapped(wallet.address);
      console.log(`[monitor] ${wallet.address} synced (${deposits.length} existing txs)`);
      return;
    }

    const detectedAt = Date.now();
    for (const deposit of [...deposits].reverse()) {
      this.emitDeposit(deposit, detectedAt);
    }

    const newest = deposits[0];
    if (newest?.blockNumber) {
      this.stats.lastHead = Math.max(this.stats.lastHead, newest.blockNumber);
      this.store.setLastBlock(newest.blockNumber);
    }
  }

  emitDeposit(deposit, detectedAt) {
    const key = depositKey(deposit);
    if (!this.store.markSeen(key)) return;
    this.stats.deposits += 1;
    this.stats.lastDetectMs = Math.max(0, detectedAt - (deposit.blockTime || detectedAt));
    const wallet = this.store.findWallet(deposit.to);
    console.log(`[monitor] new deposit ${deposit.txid} -> ${deposit.to}`);
    this.emit("deposit", {
      ...deposit,
      label: wallet?.label || "",
      detectedAt,
      detectDelayMs: this.stats.lastDetectMs,
    });
  }
}
