import { toBase58 } from "./address.js";
import { depositKey } from "./tron.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTrxToken(row) {
  const token = String(
    row.tokenAbbr || row.tokenName || row.tokenId || row.token || ""
  ).toLowerCase();
  return token === "_" || token === "trx" || token === "";
}

export function parseTronscanTransfers(payload, watchedAddress) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const deposits = [];

  for (const row of rows) {
    if (!isTrxToken(row)) continue;
    const to = toBase58(row.transferToAddress || row.toAddress || row.to || "");
    if (to !== watchedAddress) continue;
    const amountSun = Number(row.amount || row.quant || 0);
    if (amountSun <= 0) continue;
    const txid = row.transactionHash || row.hash || row.txHash || "";
    if (!txid) continue;

    deposits.push({
      txid,
      to,
      from: toBase58(row.transferFromAddress || row.fromAddress || row.from || ""),
      amountSun,
      blockNumber: Number(row.block || row.blockNum || 0),
      blockTime: Number(row.timestamp || row.date_created || 0),
      kind: "transfer",
      token: "TRX",
    });
  }

  return deposits;
}

export function parseTronGridTransactions(payload, watchedAddress) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const deposits = [];

  for (const tx of rows) {
    const result = tx.ret?.[0]?.contractRet;
    if (result && result !== "SUCCESS") continue;
    const txid = tx.txID || tx.txid || "";
    const contracts = tx.raw_data?.contract || [];

    for (const contract of contracts) {
      if (contract.type !== "TransferContract" && contract.type !== 1) continue;
      const value = contract.parameter?.value || {};
      const to = toBase58(value.to_address);
      if (to !== watchedAddress) continue;
      const amountSun = Number(value.amount || 0);
      if (amountSun <= 0) continue;

      deposits.push({
        txid,
        to,
        from: toBase58(value.owner_address),
        amountSun,
        blockNumber: Number(tx.blockNumber || tx.block_number || 0),
        blockTime: Number(tx.block_timestamp || tx.raw_data?.timestamp || 0),
        kind: "transfer",
        token: "TRX",
      });
    }
  }

  return deposits;
}

export class TronExplorer {
  constructor(options) {
    this.tronscanUrl = options.tronscanUrl;
    this.tronscanApiKey = options.tronscanApiKey;
    this.trongridUrl = options.trongridUrl;
    this.trongridApiKey = options.trongridApiKey;
    this.timeoutMs = options.requestTimeoutMs || 8000;
    this.minRequestGapMs = Math.max(200, Number(options.minRequestGapMs || 400));
    this.provider = options.tronscanApiKey ? "tronscan" : "trongrid";
    this.nextRequestAt = 0;
    this.stats = { provider: this.provider, lastError: "" };
  }

  async getIncomingTrx(address) {
    if (this.provider === "tronscan") {
      try {
        const deposits = await this.fromTronscan(address);
        this.stats.provider = "tronscan";
        this.stats.lastError = "";
        return deposits;
      } catch (error) {
        this.stats.lastError = error.message;
        console.warn(
          "[explorer] Tronscan خطا داد، سوییچ به TronGrid account API:",
          error.message
        );
        this.provider = "trongrid";
        this.stats.provider = "trongrid";
      }
    }

    const deposits = await this.fromTronGrid(address);
    this.stats.provider = "trongrid";
    return deposits;
  }

  async getTrxBalance(address) {
    if (this.provider === "tronscan") {
      try {
        return await this.balanceFromTronscan(address);
      } catch {
        // fall through
      }
    }
    return this.balanceFromTronGrid(address);
  }

  async ping() {
    const t0 = Date.now();
    if (this.provider === "tronscan") {
      const json = await this.request(
        `${this.tronscanUrl}/api/block?sort=-number&limit=1`,
        this.tronscanHeaders()
      );
      const block = json?.data?.[0]?.number || json?.number || 0;
      return { ms: Date.now() - t0, provider: this.provider, block };
    }

    const json = await this.request(
      `${this.trongridUrl}/wallet/getnowblock`,
      this.trongridHeaders(),
      "POST"
    );
    return {
      ms: Date.now() - t0,
      provider: this.provider,
      block: json?.block_header?.raw_data?.number || 0,
    };
  }

  async fromTronscan(address) {
    const query = new URLSearchParams({
      sort: "-timestamp",
      count: "true",
      limit: "30",
      start: "0",
      toAddress: address,
      address,
      direction: "in",
    });
    const url = `${this.tronscanUrl}/api/transfer?${query.toString()}`;
    const json = await this.request(url, this.tronscanHeaders());
    return parseTronscanTransfers(json, address);
  }

  async fromTronGrid(address) {
    const query = new URLSearchParams({
      only_to: "true",
      only_confirmed: "false",
      limit: "30",
      search_internal: "false",
    });
    const url = `${this.trongridUrl}/v1/accounts/${address}/transactions?${query.toString()}`;
    const json = await this.request(url, this.trongridHeaders());
    return parseTronGridTransactions(json, address);
  }

  async balanceFromTronscan(address) {
    const url = `${this.tronscanUrl}/api/accountv2?address=${encodeURIComponent(address)}`;
    const json = await this.request(url, this.tronscanHeaders());
    return Number(json.balance || json.data?.balance || 0);
  }

  async balanceFromTronGrid(address) {
    const url = `${this.trongridUrl}/v1/accounts/${address}`;
    const json = await this.request(url, this.trongridHeaders());
    const account = Array.isArray(json.data) ? json.data[0] : json.data;
    return Number(account?.balance || 0);
  }

  tronscanHeaders() {
    const headers = {
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    };
    if (this.tronscanApiKey) {
      headers["TRON-PRO-API-KEY"] = this.tronscanApiKey;
    }
    return headers;
  }

  trongridHeaders() {
    const headers = {
      Accept: "application/json",
      "User-Agent": BROWSER_UA,
    };
    if (this.trongridApiKey) {
      headers["TRON-PRO-API-KEY"] = this.trongridApiKey;
    }
    return headers;
  }

  headersFor(url) {
    return url.includes("tronscan") ? this.tronscanHeaders() : this.trongridHeaders();
  }

  async request(url, headers, method = "GET") {
    await this.gate();
    let lastError;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          method,
          headers: {
            ...headers,
            ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
          },
          body: method === "POST" ? "{}" : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.status === 429) {
          this.penalize(15_000);
          const error = new Error("rate limited");
          error.code = "RATE_LIMIT";
          throw error;
        }

        const text = await response.text();
        let json = {};
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { raw: text.slice(0, 200) };
        }

        if (response.status === 401 || response.status === 403) {
          const error = new Error(json.Error || json.raw || `HTTP ${response.status}`);
          error.code = "AUTH";
          throw error;
        }

        if (!response.ok) {
          throw new Error(json.Error || json.raw || `HTTP ${response.status}`);
        }

        if (json?.Error) {
          throw new Error(String(json.Error));
        }

        return json;
      } catch (error) {
        lastError = error;
        if (error.code === "AUTH" || error.code === "RATE_LIMIT") throw error;
        await sleep(400 * (attempt + 1));
      }
    }

    throw lastError || new Error("explorer request failed");
  }

  async gate() {
    const wait = this.nextRequestAt - Date.now();
    if (wait > 0) await sleep(wait);
    this.nextRequestAt = Date.now() + this.minRequestGapMs;
  }

  penalize(ms) {
    this.nextRequestAt = Date.now() + ms;
  }
}

export { depositKey };
