import { createHash } from "node:crypto";
import bs58 from "bs58";

const BASE58_REGEX = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest();
}

function checksum4(payload) {
  return sha256(sha256(payload)).subarray(0, 4);
}

export function hexToBase58(hex) {
  let normalized = String(hex || "")
    .trim()
    .replace(/^0x/i, "")
    .toLowerCase();

  if (!normalized) return "";
  if (normalized.length === 40) normalized = `41${normalized}`;
  if (normalized.length !== 42 || !/^[0-9a-f]+$/.test(normalized)) {
    return "";
  }

  const payload = Buffer.from(normalized, "hex");
  return bs58.encode(Buffer.concat([payload, checksum4(payload)]));
}

export function toBase58(address) {
  const value = String(address || "").trim();
  if (!value) return "";
  if (value.startsWith("T")) return value;
  return hexToBase58(value);
}

export function isTronAddress(address) {
  if (!BASE58_REGEX.test(address || "")) return false;
  try {
    const decoded = Buffer.from(bs58.decode(address));
    if (decoded.length !== 25 || decoded[0] !== 0x41) return false;
    return decoded.subarray(21).equals(checksum4(decoded.subarray(0, 21)));
  } catch {
    return false;
  }
}

export function sunToTrx(sun) {
  const value = Number(sun || 0) / 1_000_000;
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
  });
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
