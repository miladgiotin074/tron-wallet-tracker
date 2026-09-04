import { hexToBase58, isTronAddress, sunToTrx, toBase58 } from "./address.js";
import { parseTronGridTransactions, parseTronscanTransfers } from "./explorer.js";
import { depositKey } from "./tron.js";

const hex = "41" + "11".repeat(20);
const address = hexToBase58(hex);
if (!isTronAddress(address)) {
  throw new Error("checksum address failed");
}

const realHex = "415339e68c0c65377afd6265ebf78a35398c650274";
const realAddr = "THZGSyzJEMU9SdwGWUr9HjLjPMziZCycfX";
if (toBase58(realHex) !== realAddr) {
  throw new Error("real wallet hex mismatch");
}

const grid = parseTronGridTransactions(
  {
    data: [
      {
        txID: "abc123",
        blockNumber: 10,
        block_timestamp: 1_700_000_000_000,
        ret: [{ contractRet: "SUCCESS" }],
        raw_data: {
          contract: [
            {
              type: "TransferContract",
              parameter: {
                value: {
                  amount: 2_500_000,
                  owner_address: realHex,
                  to_address: realHex,
                },
              },
            },
          ],
        },
      },
    ],
  },
  realAddr
);

if (grid.length !== 1 || grid[0].amountSun !== 2_500_000 || grid[0].to !== realAddr) {
  throw new Error("trongrid parse failed");
}

const scan = parseTronscanTransfers(
  {
    data: [
      {
        transactionHash: "abc123",
        transferFromAddress: realAddr,
        transferToAddress: realAddr,
        amount: "2500000",
        tokenName: "_",
        tokenAbbr: "trx",
        block: 10,
        timestamp: 1_700_000_000_000,
      },
    ],
  },
  realAddr
);

if (scan.length !== 1 || scan[0].txid !== "abc123") {
  throw new Error("tronscan parse failed");
}

if (sunToTrx(2_500_000) !== "2.5") {
  throw new Error(`sun convert failed: ${sunToTrx(2_500_000)}`);
}

if (!depositKey(grid[0]).startsWith("abc123:")) {
  throw new Error("deposit key failed");
}

console.log("selfcheck ok", address);
