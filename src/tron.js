import { toBase58 } from "./address.js";

export class TronClient {
  constructor({ urls, apiKey, timeoutMs, requestTimeoutMs }) {
    this.urls = urls;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs || requestTimeoutMs || 1800;
    this.primaryIndex = 0;
  }

  async getHead() {
    const block = await this.withFallback(
      () => this.post("/wallet/getblock", { detail: false }),
      () => this.post("/wallet/getnowblock", { visible: true })
    );
    const number = block?.block_header?.raw_data?.number;
    if (!Number.isFinite(number)) {
      throw new Error("invalid head block");
    }
    return {
      number,
      timestamp: block.block_header.raw_data.timestamp || 0,
      blockId: block.blockID || "",
    };
  }

  async getBlock(number) {
    const block = await this.withFallback(
      () =>
        this.post("/wallet/getblock", {
          id_or_num: String(number),
          detail: true,
          visible: true,
        }),
      () => this.post("/wallet/getblockbynum", { num: number, visible: true })
    );
    if (!block?.block_header) {
      throw new Error(`block ${number} not found`);
    }
    return block;
  }

  async getTransactionInfos(number) {
    try {
      const data = await this.post("/wallet/gettransactioninfobyblocknum", {
        num: number,
      });
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  async getTrxBalance(address) {
    const account = await this.post("/wallet/getaccount", {
      address,
      visible: true,
    });
    return Number(account?.balance || 0);
  }

  async post(pathname, body) {
    let lastError;
    const indexes = rotate(this.urls.length, this.primaryIndex);

    for (const index of indexes) {
      try {
        const result = await this.postUrl(this.urls[index], pathname, body);
        this.primaryIndex = index;
        return result;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("tron request failed");
  }

  async withFallback(primary, fallback) {
    try {
      const result = await primary();
      if (result?.block_header) return result;
    } catch {
      // older public nodes may not implement /wallet/getblock
    }
    return fallback();
  }

  async postUrl(baseUrl, pathname, body) {
    const url = `${baseUrl}${pathname}`;
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey && baseUrl.includes("trongrid")) {
      headers["TRON-PRO-API-KEY"] = this.apiKey;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (response.status === 429) {
      const error = new Error("tron rate limited");
      error.code = "RATE_LIMIT";
      throw error;
    }

    if (!response.ok) {
      throw new Error(`tron HTTP ${response.status} ${pathname}`);
    }

    const data = await response.json();
    if (data?.Error) {
      throw new Error(String(data.Error));
    }
    return data;
  }
}

export function extractIncomingTrx(block, watched) {
  const deposits = [];
  const blockNumber = block?.block_header?.raw_data?.number || 0;
  const blockTime = block?.block_header?.raw_data?.timestamp || 0;

  for (const tx of block.transactions || []) {
    const txid = tx.txID || tx.txid || "";
    const contracts = tx.raw_data?.contract || [];

    for (const contract of contracts) {
      if (contract.type !== "TransferContract" && contract.type !== 1) continue;
      const value = contract.parameter?.value || {};
      const to = toBase58(value.to_address);
      if (!watched.has(to)) continue;
      const amountSun = Number(value.amount || 0);
      if (amountSun <= 0) continue;

      deposits.push({
        txid,
        to,
        from: toBase58(value.owner_address),
        amountSun,
        blockNumber,
        blockTime,
        kind: "transfer",
      });
    }
  }

  return deposits;
}

export function extractInternalIncomingTrx(infos, watched, blockNumber, blockTime) {
  const deposits = [];

  for (const info of infos || []) {
    const txid = info.id || info.txid || "";
    if (info.receipt?.result && info.receipt.result !== "SUCCESS") continue;

    for (const internal of info.internal_transactions || []) {
      if (internal.rejected) continue;
      const to = toBase58(internal.transferTo_address);
      if (!watched.has(to)) continue;

      const valueInfos = internal.callValueInfo?.length
        ? internal.callValueInfo
        : [{ callValue: internal.callValue || 0 }];

      for (const item of valueInfos) {
        if (item.tokenId) continue;
        const amountSun = Number(item.callValue || 0);
        if (amountSun <= 0) continue;
        deposits.push({
          txid,
          to,
          from: toBase58(internal.caller_address),
          amountSun,
          blockNumber,
          blockTime,
          kind: "internal",
        });
      }
    }
  }

  return deposits;
}

export function depositKey(deposit) {
  return `${deposit.txid}:${deposit.to}:${deposit.amountSun}`;
}

function rotate(length, start) {
  return [...Array(length).keys()].map((offset) => (start + offset) % length);
}
