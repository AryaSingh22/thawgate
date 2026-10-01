/**
 * The reserve report the attestor posts, read from a JSON file or an http(s) URL:
 *
 *   { "mint": "<address>", "reserves": "1000000000", "asOf": 1790000000, "reportUri": "https://..." }
 *
 * - `reserves`: a decimal integer **string** in the mint's base units (same decimals as the token, so 1,000.00 of a
 *   6-decimal coin is "1000000000"). A string, so values above 2^53 survive JSON.
 * - `asOf`: when the reserves were measured. Unix seconds, or an ISO 8601 date.
 * - `reportUri`: where the report lives, at most 200 bytes (UTF-8).
 */
import fs from "fs";
import { Address, isAddress } from "@solana/kit";

export interface ReserveReport {
  mint: Address;
  reserves: bigint;
  asOf: bigint;
  reportUri: string;
}

export const MAX_URI_BYTES = 200;
const U64_MAX = (1n << 64n) - 1n;

/** Validates a parsed source document. Throws with the field that is wrong. */
export function parseReport(doc: unknown): ReserveReport {
  if (typeof doc !== "object" || doc === null) throw new Error("source: expected a JSON object");
  const d = doc as Record<string, unknown>;

  if (typeof d.mint !== "string" || !isAddress(d.mint)) throw new Error("source: mint is not a base58 address");
  if (typeof d.reserves !== "string" || !/^\d+$/.test(d.reserves)) {
    throw new Error("source: reserves must be a decimal integer string in base units");
  }
  const reserves = BigInt(d.reserves);
  if (reserves > U64_MAX) throw new Error("source: reserves exceed u64");

  let asOf: bigint;
  if (typeof d.asOf === "number" && Number.isSafeInteger(d.asOf)) asOf = BigInt(d.asOf);
  else if (typeof d.asOf === "string" && /^\d+$/.test(d.asOf)) asOf = BigInt(d.asOf);
  else if (typeof d.asOf === "string" && !Number.isNaN(Date.parse(d.asOf))) asOf = BigInt(Math.floor(Date.parse(d.asOf) / 1000));
  else throw new Error("source: asOf must be unix seconds or an ISO 8601 date");

  if (typeof d.reportUri !== "string") throw new Error("source: reportUri must be a string");
  if (Buffer.byteLength(d.reportUri, "utf8") > MAX_URI_BYTES) throw new Error(`source: reportUri is over ${MAX_URI_BYTES} bytes`);

  return { mint: d.mint, reserves, asOf, reportUri: d.reportUri };
}

/** Reads and validates the source: an http(s) URL, or a file path. */
export async function readReport(location: string): Promise<ReserveReport> {
  if (/^https?:\/\//.test(location)) {
    const res = await fetch(location, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`source: HTTP ${res.status}`);
    return parseReport(await res.json());
  }
  return parseReport(JSON.parse(fs.readFileSync(location, "utf8")));
}
