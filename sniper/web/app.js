// Polls /api/state and redraws. Plain JS, no build step.
const POLL_MS = 3000;
const $ = (id) => document.getElementById(id);
const seen = new Set();
const seenAlerts = new Set();
const cache = new Map();
let firstLoad = true;
let booted = false;
let latest = null;
let filter = "ALL";
let selected = null;
let hidePass = false;
let drawerKey = "";
let feedKey = "";
let booksKey = "";
let backtestKey = "";
let alertsKey = "";

const CHECK_LABEL = {
  rug_ring: "Rug ring",
  dev_sold: "Dev sold",
  supply_grab: "Supply grab",
  top3_supply: "Top 3 supply",
  deployer_rugs: "Deployer history",
  serial_launcher: "Serial launcher",
  buyers: "Crowd",
  buy_concentration: "Top 3 buyers",
  known_bots: "Known bots",
  entity_cluster: "Entity cluster",
  wash_trading: "Wash trading",
  liquidity: "Liquidity",
  price_move: "Price path",
  honeypot: "Honeypot",
  gt_score: "GT Score",
  dev_holding: "Dev holding",
  top10_holders: "Top 10 holders",
  token_info: "Token info",
  fresh_wallets: "Fresh wallets",
  proven_traders: "Proven traders",
};
const GROUP_ORDER = ["wash", "clusters", "dev", "holders", "market", "token", "traders"];
const GROUP_LABEL = {
  wash: "Wash trading",
  clusters: "Wallets in memory",
  dev: "Deployer",
  holders: "Supply",
  market: "Crowd and liquidity",
  token: "Token info",
  traders: "Buyer profiles",
  other: "Checks",
};
const ALERT_LABEL = { rug_ring: "Rug ring", entity_cluster: "Cluster", known_bots: "Known bots" };
const CHAINS = {
  robinhood: "Robinhood Chain",
  eth: "Ethereum",
  base: "Base",
  solana: "Solana",
  bsc: "BNB Chain",
  arbitrum: "Arbitrum",
  polygon_pos: "Polygon",
  optimism: "Optimism",
  avax: "Avalanche",
};
const BOOKS = [
  ["bouncer", "Bouncer", "Buys ENTER"],
  ["crowd", "Crowd", "Busy pairs only"],
  ["control", "Buy everything", "Every pair checked"],
];

const DOOR = `<svg class="door" viewBox="0 0 64 64" aria-hidden="true"><rect x="14" y="8" width="36" height="44" rx="4" fill="#121a16" stroke="currentColor" stroke-width="1.6"/><path d="M32 8.8v42.4" stroke="currentColor" stroke-opacity=".35"/><circle cx="39" cy="32" r="1.8" fill="#8dc63f"/><rect x="20" y="54" width="24" height="2.2" rx="1" fill="#8dc63f"/></svg>`;

const num = (n) => (n == null || Number.isNaN(Number(n)) ? "–" : Number(n).toLocaleString("en-US"));
const pct = (x, digits = 0) => (x == null || Number.isNaN(Number(x)) ? "–" : `${(100 * Number(x)).toFixed(digits)}%`);
function numOrNull(x) {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function usd(x, signed = false) {
  const n = numOrNull(x);
  if (n == null) return "–";
  const sign = signed ? (n > 0 ? "+" : n < 0 ? "−" : "") : n < 0 ? "−" : "";
  const a = Math.abs(n);
  const body = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(1)}K` : a >= 100 ? Math.round(a).toLocaleString("en-US") : a.toFixed(a >= 10 ? 0 : 2);
  return `${sign}$${body}`;
}
const signedPct = (x) => {
  const n = numOrNull(x);
  if (n == null) return "–";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}%`;
};
function price(x) {
  const n = numOrNull(x);
  if (n == null) return "–";
  if (n === 0) return "$0";
  if (n >= 1000) return usd(n);
  if (n >= 1) return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  const digits = Math.min(10, -Math.floor(Math.log10(n)) + 3);
  return `$${n.toFixed(digits)}`;
}
function ago(ts, now) {
  const s = Math.max(0, Math.round(now - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${(s / 3600).toFixed(1)}h ago`;
}
const clock = (ts) => new Date(ts * 1000).toLocaleTimeString("en-GB", { hour12: false });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const tone = (x) => {
  const n = numOrNull(x);
  if (n == null || n === 0) return "";
  return n > 0 ? "green" : "red";
};
const labelOf = (k) => CHECK_LABEL[k] || String(k || "").replace(/_/g, " ");
const chainName = (c) => CHAINS[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : "Chain");
const verdictClass = (v) => (v === "ENTER" ? "enter" : v === "WATCH" ? "watch" : v === "AVOID" ? "avoid" : "unknown");
const statusClass = (s) => (["pass", "fail", "warn", "unknown"].includes(s) ? s : "unknown");
function shortAddr(w) {
  if (!w) return "";
  return w.length <= 12 ? w : `${w.slice(0, 6)}…${w.slice(-4)}`;
}
function dexName(d) {
  return String(d || "").replace(/_/g, " ");
}

function emptyBlock(title, body) {
  return `<div class="empty">${DOOR}<strong>${esc(title)}</strong><p>${esc(body)}</p></div>`;
}

function renderHeader(s) {
  const names = (s.chains || []).map(chainName);
  $("eyebrow").textContent = `${names.join(" · ") || "Chain"} · paper books only`;
  const age = s.now - (s.last_sweep || 0);
  const dot = $("dot");
  if (!s.last_sweep) {
    dot.className = "dot";
    $("sweep").textContent = "waiting for the collector";
  } else if (age < (s.interval_s || 120) * 2.5) {
    dot.className = "dot live";
    $("sweep").textContent = `live · last sweep ${ago(s.last_sweep, s.now)}`;
  } else {
    dot.className = "dot stale";
    $("sweep").textContent = `quiet · last sweep ${ago(s.last_sweep, s.now)}`;
  }
  const used = Math.round(numOrNull(s.credits_today) || 0);
  const cap = numOrNull(s.credit_cap);
  $("credits").textContent = cap ? `${num(used)} / ${num(cap)} credits today` : `${num(used)} credits today`;
  const track = $("credit-track");
  if (cap) {
    track.hidden = false;
    const ratio = Math.max(0, used / cap);
    const bar = $("credit-bar");
    bar.style.width = `${Math.min(100, ratio * 100)}%`;
    bar.className = ratio >= 1 ? "hot" : ratio >= 0.8 ? "warn" : "";
    track.title = "CoinGecko credits counted since 00:00 UTC";
  } else {
    track.hidden = true;
  }

  const feed = (s.bouncer || {}).feed || [];
  const lags = feed.map((f) => f.decided_ts - f.created_ts).filter((x) => x > 0).sort((a, b) => a - b);
  const bits = [];
  if (s.launches_captured) bits.push(`${num(s.launches_captured)} launches on file`);
  if (lags.length) {
    const mid = lags[Math.floor(lags.length / 2)] / 60;
    bits.push(`latest calls about ${mid < 10 ? mid.toFixed(1) : Math.round(mid)} min after launch`);
  }
  const sn = s.last24 && s.last24.with_sniper_pct;
  const bot = s.last24 && s.last24.with_bot_pct;
  if (sn != null) bits.push(`serial snipers in ${sn}% of the last 24h`);
  if (bot != null) bits.push(`round-trip bots in ${bot}%`);
  const hint = bits.join(" · ") || "Each new pair, a few minutes after launch.";
  $("tape-hint").textContent = hint;
  $("tape-hint").title = hint;

  const cls = (s.last24 && s.last24.classes) || {};
  const mem = [];
  if (cls.serial_sniper) mem.push(`${num(cls.serial_sniper)} serial snipers`);
  if (cls.round_tripper) mem.push(`${num(cls.round_tripper)} round-trip bots`);
  $("alerts-hint").textContent = mem.length ? `${mem.join(" · ")} in memory` : "Repeat wallets and coordinated buyers";
}

function renderKpis(s) {
  const b = s.bouncer || {};
  const c = b.counts_24h || {};
  const enter = Number(c.ENTER || 0);
  const watch = Number(c.WATCH || 0);
  const avoid = Number(c.AVOID || 0);
  const total = enter + watch + avoid;
  $("k-checked").textContent = num(total);
  $("k-checked-sub").innerHTML = total
    ? `<span class="dotlet enter"></span>${num(enter)} let in · <span class="dotlet watch"></span>${num(watch)} watch · <span class="dotlet avoid"></span>${num(avoid)} turned away`
    : "Last 24 hours";
  const parts = [["enter", enter], ["watch", watch], ["avoid", avoid]].filter((p) => p[1] > 0);
  $("mix-bar").innerHTML = parts.map(([cls, n]) => `<span class="${cls}" style="flex:${n} 1 0"></span>`).join("");
  $("mix-bar").setAttribute("aria-label", total ? `${enter} enter, ${watch} watch, ${avoid} avoid` : "No verdicts in the last 24 hours");
  $("k-enter").textContent = total ? `${Math.round((100 * enter) / total)}%` : "–";
  $("k-enter-sub").textContent = total ? `${num(enter)} ENTER verdicts, last 24 hours` : "Last 24 hours";

  const books = b.books || {};
  const bk = books.bouncer || {};
  const ck = books.control || {};
  $("k-books").textContent = signedPct(bk.return_pct);
  $("k-books").className = `k-value ${tone(bk.return_pct)}`;
  $("k-books-sub").textContent = `vs buy everything ${signedPct(ck.return_pct)} · ${num(bk.positions || 0)} pairs`;

  const bt = s.backtest || {};
  if (bt.bouncer && bt.control) {
    $("k-bt").textContent = signedPct(bt.bouncer.paper_return_pct);
    $("k-bt").className = `k-value ${tone(bt.bouncer.paper_return_pct)}`;
    $("k-bt-sub").textContent = `vs every launch ${signedPct(bt.control.paper_return_pct)} · ${num(bt.bouncer.with_pnl)} trades`;
  } else {
    $("k-bt").textContent = "–";
    $("k-bt").className = "k-value";
    $("k-bt-sub").textContent = bt.error || "Needs launches with a one-hour outcome";
  }
}

function meterCell(cls, text, ratio, bad, title) {
  if (text == null || ratio == null) return `<span class="meter-cell ${cls}"><span class="meter-n">–</span></span>`;
  const width = Math.max(8, Math.min(100, ratio * 100));
  return `<span class="meter-cell ${cls}" title="${esc(title)}"><span class="meter-n">${text}</span><span class="meter"><span class="${bad ? "bad" : "ok"}" style="width:${width}%"></span></span></span>`;
}

function whyCell(f) {
  const reasons = f.reasons || [];
  if (f.verdict === "ENTER" && !reasons.length) {
    return `<span class="why-wrap"><span class="why quiet">Passed ${num(f.passed)} of ${num(f.checks)}</span></span>`;
  }
  const more = reasons.length > 1 ? `<span class="more">+${reasons.length - 1}</span>` : "";
  return `<span class="why-wrap"><span class="why" title="${esc(reasons.join(" · "))}">${esc(reasons[0] || "")}</span>${more}</span>`;
}

function renderFilters(feed) {
  const counts = { ALL: feed.length, ENTER: 0, WATCH: 0, AVOID: 0 };
  for (const f of feed) if (counts[f.verdict] != null) counts[f.verdict] += 1;
  for (const key of ["ALL", "ENTER", "WATCH", "AVOID"]) {
    const btn = $(`f-${key}`);
    const name = key === "ALL" ? "All" : key[0] + key.slice(1).toLowerCase();
    btn.textContent = `${name} ${counts[key]}`;
    btn.classList.toggle("on", filter === key);
    btn.setAttribute("aria-selected", filter === key ? "true" : "false");
  }
}

function renderFeed(s) {
  const b = s.bouncer || {};
  const feed = b.feed || [];
  const rules = b.rules || {};
  const minBuyers = rules.min_buyers || 15;
  const maxTop3 = rules.max_top3 ?? 0.45;
  const maxBots = rules.max_bots ?? 0.15;
  const tapes = new Map((s.feed || []).map((t) => [t.pool, t]));
  for (const f of feed) {
    cache.set(f.pool, { ...f, tape: tapes.get(f.pool) || null, chain: f.chain || (s.chains || [])[0] || "", snipeS: s.snipe_s });
  }
  renderFilters(feed);
  const q = $("q").value.trim().toLowerCase();
  const rows = feed.filter((f) => (filter === "ALL" || f.verdict === filter) && (!q || `${f.name || ""} ${f.pool || ""}`.toLowerCase().includes(q)));
  const nextKey = `${filter}|${q}|${selected || ""}|${rows.map((f) => [f.pool, f.verdict, (f.reasons || []).join("|"), f.buyers, f.top3, f.bots].join(":")).join("~")}`;
  if (nextKey === feedKey) return;
  feedKey = nextKey;
  if (!rows.length) {
    const title = q ? "No matches" : feed.length ? "Nothing in this view" : "Waiting for the first verdict";
    const body = q
      ? "Nothing in the latest verdicts matches that search."
      : feed.length
        ? "Try another verdict, or clear the search."
        : "The collector records two minutes of trading, then decides once those trades are indexed.";
    $("feed").innerHTML = emptyBlock(title, body);
    return;
  }
  $("feed").innerHTML = rows.map((f) => {
    const fresh = !firstLoad && !seen.has(f.pool);
    seen.add(f.pool);
    const parts = String(f.name || "?").split(" / ");
    const token = parts[0];
    const quote = parts.slice(1).join(" / ");
    const lagMin = (f.decided_ts - f.created_ts) / 60;
    const lagTitle = Number.isFinite(lagMin) && lagMin >= 0 ? `Decided ${lagMin.toFixed(1)} min after launch` : "";
    const buyers = numOrNull(f.buyers);
    const top = numOrNull(f.top3);
    const bots = numOrNull(f.bots);
    const current = selected === f.pool ? ` aria-current="true"` : "";
    return `<button type="button" class="row cols ${fresh ? "fresh" : ""} ${verdictClass(f.verdict)} ${selected === f.pool ? "on" : ""}" data-pool="${esc(f.pool)}"${current}>
      <span class="time" title="${esc(lagTitle)}">${clock(f.decided_ts)}</span>
      <span class="pair">${esc(token)}${quote ? `<span class="quote"> / ${esc(quote)}</span>` : ""}</span>
      <span class="stamp ${verdictClass(f.verdict)}">${esc(f.verdict || "–")}</span>
      ${whyCell(f)}
      ${meterCell("m-buy", buyers == null ? null : num(buyers), buyers == null ? null : buyers / minBuyers, buyers != null && buyers < minBuyers, `Floor is ${minBuyers} buyers`)}
      ${meterCell("m-top", top == null ? null : pct(top), top, top != null && top > maxTop3, `Turns away above ${pct(maxTop3)}`)}
      ${meterCell("m-bot", bots == null ? null : pct(bots), bots, bots != null && bots > maxBots, `Turns away above ${pct(maxBots)}`)}
    </button>`;
  }).join("");
}

function exitLabel(k) {
  const map = { take_profit: "take profit", stop_loss: "stop", time: "time", time_stale: "late time" };
  if (map[k]) return map[k];
  if (String(k).endsWith("_no_price")) return `${exitLabel(String(k).replace(/_no_price$/, ""))}, no price`;
  return String(k || "").replace(/_/g, " ");
}
function exitLine(exits) {
  const parts = Object.entries(exits || {}).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  if (!parts.length) return "";
  return parts.map(([k, n]) => `${num(n)} ${exitLabel(k)}`).join(" · ");
}

function renderBooks(s) {
  const b = s.bouncer || {};
  const r = b.rules || {};
  const books = b.books || {};
  const booksSig = JSON.stringify(books) + JSON.stringify(r) + JSON.stringify(s.money || null);
  if (booksSig === booksKey) return;
  booksKey = booksSig;
  $("rules").textContent = r.take_profit_pct != null ? `Take profit +${r.take_profit_pct}% · stop −${r.stop_loss_pct}% · ${r.max_hold_min} min` : "";
  $("books").innerHTML = BOOKS.map(([key, name, note]) => {
    const k = books[key] || {};
    const ret = numOrNull(k.return_pct);
    const exits = exitLine(k.exits);
    return `<article class="book${key === "bouncer" ? " feature" : ""}">
      <div class="book-main">
        <div>
          <div class="book-name">${name}</div>
          <div class="book-note">${note}</div>
        </div>
        <div class="book-ret ${tone(ret)}">${signedPct(ret)}</div>
      </div>
      <div class="book-meta">
        <span>${num(k.positions || 0)} pairs</span>
        <span>${num(k.open || 0)} open</span>
        <span>${k.win_rate == null ? "–" : pct(k.win_rate)} wins</span>
        <span class="${tone(k.pnl_usd)}">${usd(k.pnl_usd, true)}</span>
      </div>
      ${exits ? `<div class="exits">${esc(exits)}</div>` : ""}
    </article>`;
  }).join("");
  let foot = `$${r.position_usd ?? 100} a pair. Same exits, fees, and slippage from pool liquidity.`;
  const sn = s.money && s.money.classes && s.money.classes.serial_sniper;
  if (sn) foot += ` Serial snipers put in ${usd(sn.put_in_usd)}, took out ${usd(sn.took_out_usd)} (net ${usd(sn.net_cash_usd, true)}).`;
  $("books-foot").textContent = foot;
}

function renderBacktest(s) {
  const bt = s.backtest || {};
  const sig = JSON.stringify(bt);
  if (sig === backtestKey) return;
  backtestKey = sig;
  if (!bt.bouncer) {
    $("bt-hint").textContent = "Recorded launches, in order";
    $("bt").innerHTML = `<p class="empty-inline">${esc(bt.error || "Needs launches with a one-hour outcome.")}</p>`;
    return;
  }
  $("bt-hint").textContent = `${num(bt.launches)} launches · ${bt.hours}h · entry at the decision`;
  const chips = ["ENTER", "WATCH", "AVOID"].map((name) => {
    const row = (bt.by_verdict || {})[name] || {};
    const dead = row.dead_pct == null ? "–" : `${row.dead_pct}% dead`;
    const mult = row.median_multiple == null ? "–" : `×${row.median_multiple}`;
    return `<div class="vchip ${name.toLowerCase()}"><b>${name}</b><span>${esc(dead)} · ${esc(String(mult))}</span><span>${num(row.launches)} launches</span></div>`;
  }).join("");
  const fails = Object.entries(bt.fail_reasons || {}).slice(0, 4);
  const max = Math.max(1, ...fails.map(([, v]) => v));
  const bars = fails.map(([k, v]) => `<div class="failrow"><span>${esc(labelOf(k))}</span><span class="failtrack"><span style="width:${(100 * v) / max}%"></span></span><span class="mono">${num(v)}</span></div>`).join("");
  const rc = bt.ring_catch;
  let ring = "";
  if (rc && rc.rugs) {
    const rugPct = Math.round((100 * rc.rugs_flagged) / rc.rugs);
    ring = `Rug ring flagged ${num(rc.rugs_flagged)} of ${num(rc.rugs)} pools that were still trading at the decision and dead within the hour (${rugPct}%).`;
    if (rc.survivors) ring += ` It also flagged ${Math.round((100 * rc.survivors_flagged) / rc.survivors)}% of the pools that survived.`;
  }
  const notes = [];
  if (bt.worst_avoided) notes.push(String(bt.worst_avoided).replace("were not ENTER", "were turned away"));
  if (bt.good_rejected) notes.push(String(bt.good_rejected).replace("were not ENTER", "were also turned away"));
  $("bt").innerHTML = `${chips ? `<div class="vchips">${chips}</div>` : ""}${bars ? `<div class="fails">${bars}</div>` : ""}${ring ? `<p class="ringline">${esc(ring)}</p>` : ""}${notes.length ? `<p class="note">${esc(notes.join(" "))}</p>` : ""}`;
}

function renderAlerts(s) {
  const alerts = (s.bouncer || {}).cluster_alerts || [];
  const sig = JSON.stringify(alerts);
  if (sig === alertsKey) return;
  alertsKey = sig;
  if (!alerts.length) {
    $("alerts").innerHTML = `<li class="quiet">None yet. Rug rings, clusters, and known bots show up here.</li>`;
    return;
  }
  $("alerts").innerHTML = alerts.map((a) => {
    const key = `${a.ts}-${a.name}-${a.key || ""}`;
    const fresh = !firstLoad && !seenAlerts.has(key);
    seenAlerts.add(key);
    const token = String(a.name || "?").split(" / ")[0];
    const kind = ALERT_LABEL[a.key] ? `<span class="kind">${ALERT_LABEL[a.key]}</span>` : "";
    return `<li class="${fresh ? "fresh" : ""}"><span class="a-time">${clock(a.ts)}</span><div><div class="a-top"><b>${esc(token)}</b><span class="stamp avoid">AVOID</span>${kind}</div><div class="a-reason">${esc(a.reason)}</div></div></li>`;
  }).join("");
}

function stageLabel(stage) {
  if (stage === 0 || stage === "0") return "Launch tape and memory";
  if (stage === 1 || stage === "1") return "Tape plus token info";
  if (stage === 2 || stage === "2") return "Tape, token info, and wallet profiles";
  return "";
}

function memoryNote(item) {
  const t = item.tape;
  if (!t) return "";
  const secs = item.snipeS || 10;
  const bits = [];
  if (t.serial_snipers) bits.push(`${t.serial_snipers} wallet${t.serial_snipers === 1 ? "" : "s"} already labeled serial sniper${t.serial_snipers === 1 ? "" : "s"} bought in the first ${secs}s.`);
  if (t.top_sniper) bits.push(`The busiest, ${shortAddr(t.top_sniper.wallet)}, was early on ${num(t.top_sniper.launches)} launches in memory.`);
  if (t.launcher) bits.push("The deployer, or a known serial launcher, bought in the opening seconds.");
  if (t.bots) bits.push(t.bots === 1 ? "1 buyer is labeled a round-trip bot." : `${num(t.bots)} buyers are labeled round-trip bots.`);
  if (t.snipe_usd) bits.push(`${usd(t.snipe_usd)} was bought in the first ${secs}s.`);
  return bits.join(" ");
}

function grouped(list) {
  const map = new Map();
  for (const c of list || []) {
    const g = c.group || "other";
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(c);
  }
  const keys = [...GROUP_ORDER.filter((k) => map.has(k)), ...[...map.keys()].filter((k) => !GROUP_ORDER.includes(k))];
  return keys.map((k) => [k, map.get(k)]);
}

function renderDrawer(s, focus) {
  if (!selected || $("drawer").hidden) return;
  const item = cache.get(selected);
  if (!item) return;
  const key = `${hidePass}|${JSON.stringify(item)}`;
  if (!focus && key === drawerKey) return;
  const scroll = $("drawer").scrollTop;
  const parts = String(item.name || "?").split(" / ");
  const token = parts[0];
  const quote = parts.slice(1).join(" / ");
  const checks = item.checklist || [];
  const fails = checks.filter((c) => c.status === "fail");
  const warns = checks.filter((c) => c.status === "warn");
  const passed = checks.filter((c) => c.status === "pass").length;
  const unknown = checks.filter((c) => c.status === "unknown").length;
  const counts = { pass: passed, warn: warns.length, fail: fails.length, unknown };
  const lagMin = (item.decided_ts - item.created_ts) / 60;
  const lead = fails[0]?.reason || warns[0]?.reason || (item.reasons || [])[0] || (item.verdict === "ENTER" ? "Every check that ran came back clear." : "");
  const also = fails.slice(1).map((c) => labelOf(c.key));
  const visible = hidePass ? checks.filter((c) => c.status !== "pass") : checks;
  const groups = grouped(visible).map(([g, rows]) => {
    const body = rows.map((c) => `<div class="check ${statusClass(c.status)}"><span class="st ${statusClass(c.status)}" aria-label="${esc(c.status)}"></span><div><div class="check-name">${esc(labelOf(c.key))}</div><div class="check-reason">${esc(c.reason)}</div></div></div>`).join("");
    return `<section class="group"><h4>${esc(GROUP_LABEL[g] || labelOf(g))}</h4>${body}</section>`;
  }).join("");
  const bar = ["fail", "warn", "unknown", "pass"].filter((k) => counts[k]).map((k) => `<span class="${k}" style="flex:${counts[k]}"></span>`).join("");
  const legend = [`${num(passed)} passed`, warns.length ? `${num(warns.length)} warning${warns.length === 1 ? "" : "s"}` : "", fails.length ? `${num(fails.length)} failed` : "", unknown ? `${num(unknown)} unknown` : ""].filter(Boolean).join(" · ");
  const note = memoryNote(item);
  const chain = item.chain || (s.chains || [])[0] || "";
  const href = chain && item.pool ? `https://www.geckoterminal.com/${encodeURIComponent(chain)}/pools/${encodeURIComponent(item.pool)}` : "";
  const when = item.decided_ts ? new Date(item.decided_ts * 1000).toLocaleString("en-GB", { hour12: false, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "–";
  $("drawer").innerHTML = `
    <div class="drawer-head">
      <div>
        <p class="eyebrow">${esc(chainName(chain))}</p>
        <h3 id="drawer-title">${esc(token)}${quote ? ` <span>/ ${esc(quote)}</span>` : ""}</h3>
        <p class="meta-line"><span>${esc(dexName(item.dex) || "pool")}</span><span class="mono">${esc(shortAddr(item.pool))}</span><button type="button" class="texty" data-copy="${esc(item.pool)}">Copy address</button></p>
      </div>
      <button type="button" class="close" aria-label="Close">×</button>
    </div>
    <div class="stamp-row"><span class="stamp ${verdictClass(item.verdict)}">${esc(item.verdict || "–")}</span><span class="stage">${esc(stageLabel(item.stage))}</span></div>
    <div class="facts">
      <div class="fact"><span>Decided</span><b>${esc(when)}</b></div>
      <div class="fact"><span>After launch</span><b>${Number.isFinite(lagMin) && lagMin >= 0 ? `${lagMin.toFixed(1)} min` : "–"}</b></div>
      <div class="fact"><span>Price</span><b>${esc(price(item.price_usd))}</b></div>
      <div class="fact"><span>Liquidity</span><b>${esc(usd(item.reserve_usd))}</b></div>
      <div class="fact"><span>Buyers</span><b>${num(item.buyers)}</b></div>
      <div class="fact"><span>Passed</span><b>${num(item.passed)} of ${num(item.checks)}</b></div>
    </div>
    ${lead ? `<p class="lead">${esc(lead)}</p>` : ""}
    ${also.length ? `<p class="also">Also failed: ${esc(also.join(", "))}</p>` : ""}
    ${bar ? `<div class="checkbar" aria-hidden="true">${bar}</div><div class="check-legend">${esc(legend)}</div>` : ""}
    ${note ? `<div class="callout">${esc(note)}</div>` : ""}
    <div class="list-tools"><h2>Checks</h2>${checks.some((c) => c.status === "pass") ? `<button type="button" class="texty" id="toggle-pass">${hidePass ? "Show passed checks" : "Hide passed checks"}</button>` : ""}</div>
    ${groups || `<p class="empty-inline">${checks.length ? "Passed checks are hidden." : "This verdict was stored without the check list."}</p>`}
    ${href ? `<a class="pool-link" href="${esc(href)}" target="_blank" rel="noopener">Open this pool on GeckoTerminal</a>` : ""}
  `;
  drawerKey = key;
  $("drawer").scrollTop = scroll;
  if (focus) $("drawer").querySelector(".close")?.focus();
}

function openDrawer(pool) {
  const first = $("drawer").hidden;
  selected = pool;
  $("backdrop").hidden = false;
  $("drawer").hidden = false;
  if (latest) {
    renderFeed(latest);
    renderDrawer(latest, first);
  }
}

function closeDrawer() {
  const pool = selected;
  $("drawer").hidden = true;
  $("backdrop").hidden = true;
  drawerKey = "";
  selected = null;
  if (latest) renderFeed(latest);
  if (pool) $("feed").querySelector(`[data-pool="${CSS.escape(pool)}"]`)?.focus();
}

function render(s) {
  latest = s;
  renderHeader(s);
  renderKpis(s);
  renderFeed(s);
  renderBooks(s);
  renderBacktest(s);
  renderAlerts(s);
  if (!$("drawer").hidden) renderDrawer(s, false);
  firstLoad = false;
  booted = true;
}

async function tick() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    const s = await r.json();
    if (s.error) throw new Error(s.error);
    render(s);
  } catch (e) {
    console.error(e);
    $("dot").className = "dot stale";
    $("sweep").textContent = "dashboard can't read the database";
    if (!booted) $("feed").innerHTML = emptyBlock("The dashboard can't read the database", "Run it beside the collector. It only reads data/sniper.db.");
  }
}

$("feed").addEventListener("click", (e) => {
  const row = e.target.closest(".row");
  if (row) openDrawer(row.dataset.pool);
});
document.querySelector(".seg").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-filter]");
  if (!btn || !latest) return;
  filter = btn.dataset.filter;
  renderFeed(latest);
});
$("q").addEventListener("input", () => latest && renderFeed(latest));
$("backdrop").addEventListener("click", closeDrawer);
$("drawer").addEventListener("click", async (e) => {
  if (e.target.closest(".close")) {
    closeDrawer();
    return;
  }
  if (e.target.closest("#toggle-pass")) {
    hidePass = !hidePass;
    drawerKey = "";
    if (latest) renderDrawer(latest, false);
    return;
  }
  const copy = e.target.closest("[data-copy]");
  if (!copy) return;
  try {
    await navigator.clipboard.writeText(copy.dataset.copy);
    copy.textContent = "Copied";
  } catch (err) {
    copy.textContent = "Copy failed";
  }
  setTimeout(() => { copy.textContent = "Copy address"; }, 1200);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("q") === document.activeElement && $("q").value) {
      $("q").value = "";
      if (latest) renderFeed(latest);
      return;
    }
    if (!$("drawer").hidden) closeDrawer();
    return;
  }
  if ($("drawer").hidden || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  const rows = [...$("feed").querySelectorAll(".row")];
  const i = rows.findIndex((r) => r.dataset.pool === selected);
  const next = rows[e.key === "ArrowDown" ? i + 1 : i - 1];
  if (!next) return;
  e.preventDefault();
  openDrawer(next.dataset.pool);
});

tick();
setInterval(tick, POLL_MS);
