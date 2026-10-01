/** A small Prometheus registry (text format 0.0.4): counters, gauges and histograms with labels. No dependency. */

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
    this.define("thawgate_keeper_freezes_total", "counter", "Freezes sent and confirmed, by trigger and the gate's TG:ALLOW reason.");
    this.define("thawgate_keeper_skipped_total", "counter", "Freeze attempts that were no-ops: compliant (TG:DENY:COMPLIANT) or already frozen.");
    this.define("thawgate_keeper_denied_total", "counter", "Freeze attempts the gate or Token ACL refused for another reason (not retried).");
    this.define("thawgate_keeper_failures_total", "counter", "Freeze attempts that failed after all retries, or crashed.");
    this.define("thawgate_keeper_retries_total", "counter", "Send retries (blockhash, RPC or confirmation errors).");
    this.define("thawgate_keeper_freeze_latency_seconds", "histogram", "Trigger seen by the keeper -> freeze confirmed.");
    this.define("thawgate_keeper_sweeps_total", "counter", "Completed sweeps.");
    this.define("thawgate_keeper_last_sweep_timestamp_seconds", "gauge", "Wall clock of the last completed sweep.");
    this.define("thawgate_keeper_last_sweep_cluster_time_seconds", "gauge", "Cluster Clock.unix_timestamp read by the last sweep.");
    this.define("thawgate_keeper_sweep_duration_seconds", "gauge", "Duration of the last sweep.");
    this.define("thawgate_keeper_tracked_mints", "gauge", "Gated mints in the holder index.");
    this.define("thawgate_keeper_tracked_token_accounts", "gauge", "Token accounts in the holder index, by state.");
    this.define("thawgate_keeper_tracked_owners", "gauge", "Owners with at least one thawed token account.");
    this.define("thawgate_keeper_ws_connected", "gauge", "1 while a websocket subscription is live, by stream.");
    this.define("thawgate_keeper_triggers_total", "counter", "Triggers received, by source.");
    this.define("thawgate_keeper_fee_payer_lamports", "gauge", "Keeper fee payer balance.");
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
