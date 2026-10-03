/**
 * A small Prometheus registry (text format 0.0.4): counters, gauges and histograms with labels. No dependency.
 * The same shape as services/keeper/src/metrics.ts, with the screener's families.
 */

type Labels = Record<string, string>;
type Kind = "counter" | "gauge" | "histogram";

const LATENCY_BUCKETS = [0.5, 1, 1.5, 2, 3, 5, 8, 13, 21, 34, 60];

interface Histogram {
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

interface Family {
  kind: Kind;
  help: string;
  values: Map<string, number | Histogram>;
}

const key = (labels: Labels) =>
  Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k]).replace(/["\\\n]/g, "_")}"`)
    .join(",");
const braces = (inner: string) => (inner ? `{${inner}}` : "");

export class Metrics {
  private families = new Map<string, Family>();

  constructor() {
    this.define("thawgate_screener_provider_info", "gauge", "The risk provider in use. fallback=\"1\" means the static list, used because RANGE_API_KEY is not set.");
    this.define("thawgate_screener_threshold", "gauge", "Risk score at or above which a wallet is blacklisted.");
    this.define("thawgate_screener_screens_total", "counter", "Provider screens, by provider and result (clean, flagged, error).");
    this.define("thawgate_screener_provider_errors_total", "counter", "Provider errors and timeouts, by kind. None of them blacklists.");
    this.define("thawgate_screener_list_reload_errors_total", "counter", "Static list edits that could not be loaded (the last good list stays in use).");
    this.define("thawgate_screener_blacklists_total", "counter", "add_to_blacklist transactions confirmed, by provider.");
    this.define("thawgate_screener_blacklist_failures_total", "counter", "add_to_blacklist attempts that failed, by reason.");
    this.define("thawgate_screener_skipped_total", "counter", "Flagged or due wallets not sent, by reason (already_blacklisted, operator_cleared, exempt, dry_run).");
    this.define("thawgate_screener_flag_to_blacklist_seconds", "histogram", "Provider result at or above the threshold -> add_to_blacklist confirmed.");
    this.define("thawgate_screener_eligible_mints", "gauge", "Keeper-tracked mints the screener may blacklist on (blacklist policy + Blacklister role).");
    this.define("thawgate_screener_tracked_wallets", "gauge", "Wallets holding a token account on an eligible mint.");
    this.define("thawgate_screener_keeper_errors_total", "counter", "Failed polls of the keeper's HTTP index.");
    this.define("thawgate_screener_polls_total", "counter", "Completed polls.");
    this.define("thawgate_screener_last_poll_timestamp_seconds", "gauge", "Wall clock of the last completed poll.");
    this.define("thawgate_screener_signer_lamports", "gauge", "Screener key balance (fees and BlacklistEntry rent).");
  }

  private define(name: string, kind: Kind, help: string) {
    this.families.set(name, { kind, help, values: new Map() });
  }

  private family(name: string): Family {
    const f = this.families.get(name);
    if (!f) throw new Error(`unknown metric ${name}`);
    return f;
  }

  inc(name: string, labels: Labels = {}, by = 1) {
    const values = this.family(name).values;
    const k = key(labels);
    values.set(k, ((values.get(k) as number | undefined) ?? 0) + by);
  }

  set(name: string, labels: Labels, value: number) {
    this.family(name).values.set(key(labels), value);
  }

  observe(name: string, labels: Labels, value: number) {
    const values = this.family(name).values;
    const k = key(labels);
    let h = values.get(k) as Histogram | undefined;
    if (!h) {
      h = { buckets: LATENCY_BUCKETS, counts: LATENCY_BUCKETS.map(() => 0), sum: 0, count: 0 };
      values.set(k, h);
    }
    h.buckets.forEach((le, i) => {
      if (value <= le) h!.counts[i]++;
    });
    h.sum += value;
    h.count++;
  }

  /** A counter or gauge value, summed over the label sets that match `labels`. */
  get(name: string, labels: Labels = {}): number {
    let total = 0;
    for (const [k, v] of this.family(name).values) {
      if (typeof v !== "number") continue;
      if (Object.entries(labels).every(([lk, lv]) => k.split(",").includes(`${lk}="${lv}"`))) total += v;
    }
    return total;
  }

  render(): string {
    const out: string[] = [];
    for (const [name, f] of this.families) {
      out.push(`# HELP ${name} ${f.help}`, `# TYPE ${name} ${f.kind}`);
      for (const [k, v] of f.values) {
        if (typeof v === "number") {
          out.push(`${name}${braces(k)} ${v}`);
          continue;
        }
        const sep = k ? `${k},` : "";
        v.buckets.forEach((le, i) => out.push(`${name}_bucket{${sep}le="${le}"} ${v.counts[i]}`));
        out.push(`${name}_bucket{${sep}le="+Inf"} ${v.count}`, `${name}_sum${braces(k)} ${v.sum}`, `${name}_count${braces(k)} ${v.count}`);
      }
    }
    return out.join("\n") + "\n";
  }
}
