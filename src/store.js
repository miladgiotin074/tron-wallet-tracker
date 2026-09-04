import { mkdir, readFile, writeFile, copyFile, unlink } from "node:fs/promises";
import path from "node:path";
import { isTronAddress } from "./address.js";

const MAX_SEEN = 4000;

export class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.wallets = [];
    this.lastBlock = 0;
    this.seen = new Set();
    this.notifyChats = [];
    this._saveTimer = null;
  }

  async load() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      const data = JSON.parse(raw);
      this.wallets = Array.isArray(data.wallets) ? data.wallets : [];
      this.lastBlock = Number(data.lastBlock || 0);
      this.seen = new Set(Array.isArray(data.seenTxIds) ? data.seenTxIds : []);
      this.notifyChats = Array.isArray(data.notifyChats)
        ? data.notifyChats.map(Number).filter((id) => Number.isFinite(id))
        : [];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.saveNow();
    }
  }

  getWallets() {
    return this.wallets;
  }

  findWallet(query) {
    const q = String(query || "").trim();
    if (!q) return null;
    return (
      this.wallets.find((wallet) => wallet.address === q) ||
      this.wallets.find(
        (wallet) => wallet.label && wallet.label.toLowerCase() === q.toLowerCase()
      ) ||
      null
    );
  }

  addNotifyChat(chatId) {
    const id = Number(chatId);
    if (!Number.isFinite(id) || this.notifyChats.includes(id)) return;
    this.notifyChats.push(id);
    this.scheduleSave();
  }

  getNotifyChats() {
    return this.notifyChats;
  }

  async addWallet(address, label = "") {
    if (!isTronAddress(address)) {
      throw new Error("invalid_address");
    }
    if (this.findWallet(address)) {
      throw new Error("duplicate");
    }
    const wallet = {
      address,
      label: String(label || "").trim(),
      addedAt: new Date().toISOString(),
      bootstrapped: false,
    };
    this.wallets.push(wallet);
    await this.saveNow();
    return wallet;
  }

  async removeWallet(query) {
    const wallet = this.findWallet(query);
    if (!wallet) return null;
    this.wallets = this.wallets.filter((item) => item.address !== wallet.address);
    await this.saveNow();
    return wallet;
  }

  async markBootstrapped(address) {
    const wallet = this.findWallet(address);
    if (!wallet || wallet.bootstrapped) return;
    wallet.bootstrapped = true;
    await this.saveNow();
  }

  hasSeen(id) {
    return this.seen.has(id);
  }

  markSeen(id) {
    if (!id || this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > MAX_SEEN) {
      const extra = this.seen.size - MAX_SEEN;
      const iterator = this.seen.values();
      for (let i = 0; i < extra; i += 1) {
        const oldest = iterator.next().value;
        this.seen.delete(oldest);
      }
    }
    this.scheduleSave();
    return true;
  }

  setLastBlock(num) {
    if (!Number.isFinite(num) || num <= this.lastBlock) return;
    this.lastBlock = num;
    this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.saveNow().catch((error) => {
        console.error("[store] save failed:", error.message);
      });
    }, 250);
  }

  async saveNow() {
    clearTimeout(this._saveTimer);
    const payload = JSON.stringify(
      {
        lastBlock: this.lastBlock,
        wallets: this.wallets,
        seenTxIds: [...this.seen],
        notifyChats: this.notifyChats,
      },
      null,
      2
    );
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, payload, "utf8");
    try {
      await copyFile(tmp, this.filePath);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }
}
