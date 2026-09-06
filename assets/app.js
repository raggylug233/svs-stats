/* SvS Prep power rankings — reads the extracted snapshot JSON, nothing else. */
(() => {
  "use strict";

  const RANKS = ["R5", "R4", "R3", "R2", "R1"]; // stack order, bottom -> top
  const COLORS = {
    R5: "#5B8CFF", // neon blue
    R4: "#C300FF", // neon purple
    R3: "#33D1D1", // cyan
    R2: "#FFC300", // yellow
    R1: "#FF2D7A", // pink
  };
  const BUCKET = 25_000_000;
  const ALL = "__all__";

  // The two things a chart can be about. Power is on every player; the
  // Labyrinth score is only on those who made their state's top 100, so
  // anything drawing it has to say how many players it actually covers.
  const METRICS = {
    power: {
      label: "Power",
      of: (p) => p.power,
      bucket: 25_000_000,
      bucketWord: "25M",
      yStep: 50_000_000,
      fromZero: true, // chart.md: the x-axis always runs down to the 25M bucket
    },
    labyrinth: {
      label: "Labyrinth",
      of: (p) => (p.labyrinth == null ? null : p.labyrinth),
      bucket: 50,
      bucketWord: "50-stage",
      yStep: 5_000,
      fromZero: false, // scores cluster in a narrow band; start where they do
    },
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs = {}, kids = []) => {
    const ns = "http://www.w3.org/2000/svg";
    const svgTags = /^(svg|g|rect|line|text|title)$/;
    const node = svgTags.test(tag)
      ? document.createElementNS(ns, tag)
      : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.setAttribute("class", v);
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const kid of [].concat(kids)) if (kid) node.appendChild(kid);
    return node;
  };

  /* ---------- formatting ---------- */

  const fmtInt = (n) => n.toLocaleString("en-US");
  const fmtB = (n) => (n / 1e9).toFixed(2) + "B";
  const fmtM = (n) => Math.round(n / 1e6) + "m";
  const fmtPower = (n) =>
    n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : fmtInt(n);

  // Same three jobs for either metric: a y-axis tick, an x-axis bucket label,
  // and a single measurement in a tooltip or caption.
  const axisFmt = (m, n) => (m === "power" ? fmtB(n) : fmtInt(Math.round(n)));
  const bucketFmt = (m, n) => (m === "power" ? fmtM(n) : fmtInt(n));
  const valueFmt = (m, n) => (m === "power" ? fmtPower(n) : fmtInt(n));

  // Some rosters are only partly captured — the screenshots ran out before the
  // list did. Their totals are real but low, so mark them everywhere they show
  // up rather than letting a short bar read as a genuine decline.
  const PARTIAL_MARK = "\u2020"; // dagger
  const partialTitle = (a) =>
    `${a.partialNote} — totals for this alliance are lower than reality`;

  /* ---------- state ---------- */

  const state = {
    index: null,
    snapshot: null,
    stateFilter: ALL,
    sortKey: "power",
    sortDir: -1,
    q: "",
    picked: new Set(), // alliance keys currently shown
    chartMode: "alliance", // "alliance" | "state" (aggregate)
    metric: "power", // "power" | "labyrinth"
    ranks: new Set(RANKS), // ranks currently shown
    furnace: ALL,
  };

  /* ---------- data helpers ---------- */

  // Everything in the chosen state, before the alliance/rank pickers apply.
  const scopedAlliances = () =>
    state.snapshot.alliances.filter(
      (a) => state.stateFilter === ALL || a.state === state.stateFilter
    );

  // What the charts and tables actually draw.
  const activeAlliances = () => scopedAlliances().filter((a) => state.picked.has(a.key));

  const activePlayers = () =>
    state.snapshot.players.filter(
      (p) => state.picked.has(`${p.state}_${p.allianceTag}`) && state.ranks.has(p.rank)
    );

  const selectAllInScope = () => {
    state.picked = new Set(scopedAlliances().map((a) => a.key));
  };

  /* ---------- tiles ---------- */

  function renderTiles() {
    const players = activePlayers();
    const alliances = activeAlliances();
    if (!players.length) {
      $("#tiles").replaceChildren();
      return;
    }
    const total = players.reduce((s, p) => s + p.power, 0);
    const top = players.reduce((m, p) => (p.power > m.power ? p : m), players[0]);
    const fc = players.filter((p) => p.furnace.startsWith("fc")).length;

    const tiles = [
      ["Players", fmtInt(players.length), `${alliances.length} alliances`],
      ["Total Power", fmtB(total), "combined"],
      ["Average Power", fmtPower(Math.round(total / players.length)), "per chief"],
      ["Top Chief", fmtPower(top.power), top.chiefName || "(blank name)"],
      ["Fire Crystal", `${Math.round((fc / players.length) * 100)}%`, `${fc} of ${players.length}`],
    ];

    $("#tiles").replaceChildren(
      ...tiles.map(([k, v, n]) =>
        el("div", { class: "tile" }, [
          el("div", { class: "k", text: k }),
          el("div", { class: "v", text: v }),
          el("div", { class: "n", text: n }),
        ])
      )
    );
  }

  /* ---------- legend ---------- */

  function renderLegend() {
    // Only the ranks actually drawn, so the legend never promises a colour
    // that isn't on screen.
    $("#legend").replaceChildren(
      ...RANKS.filter((r) => state.ranks.has(r)).map((r) => {
        const s = el("span", { role: "listitem" });
        s.appendChild(el("i", { style: `background:${COLORS[r]}` }));
        s.appendChild(document.createTextNode(r));
        return s;
      })
    );
  }

  /* ---------- chart ---------- */

  const tip = () => $("#tooltip");

  function showTip(evt, html) {
    const t = tip();
    t.innerHTML = html;
    t.classList.add("on");
    // Clamp inside the viewport: a touch near an edge would otherwise put the
    // tooltip half off-screen, where a mouse cursor never goes.
    t.style.left = "0px";
    t.style.top = "0px";
    const w = t.offsetWidth;
    const h = t.offsetHeight;
    const pad = 8;
    const x = Math.min(Math.max(evt.clientX, w / 2 + pad), window.innerWidth - w / 2 - pad);
    const y = Math.max(evt.clientY, h + pad + 10);
    t.style.left = x + "px";
    t.style.top = y + "px";
  }

  function hideTip() {
    tip().classList.remove("on");
  }

  /** Pointer events cover mouse and touch; on touch a tap opens the tooltip
   *  and the next tap elsewhere dismisses it. */
  function bindTip(node, html) {
    node.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") showTip(e, html);
    });
    node.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse") showTip(e, html);
    });
    node.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") hideTip();
    });
    node.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      e.stopPropagation();
      showTip(e, html);
    });
  }

  /**
   * Per chart.md: 25M buckets (upper bound), x descending, bars stacked
   * R5..R1 bottom-to-top, one chart per alliance sorted by total power,
   * every bucket position present in every chart, one shared y max.
   */
  function renderCharts() {
    const players = activePlayers();
    const alliances = activeAlliances();
    const host = $("#charts");
    const drawnRanks = RANKS.filter((r) => state.ranks.has(r));

    const M_ = METRICS[state.metric];
    // Only the top 100 of each state have a Labyrinth score, so a chart of it
    // covers a subset of whoever is selected.
    const scored = players.filter((p) => M_.of(p) != null);

    if (!scored.length) {
      $("#chart-sub").textContent = "";
      host.replaceChildren(
        el("p", {
          class: "empty",
          text: !alliances.length
            ? "No alliances selected — pick at least one alliance."
            : !players.length
              ? "No ranks selected — pick at least one rank."
              : "No selected chief has a Labyrinth score — only each state's top 100 do.",
        })
      );
      return;
    }

    const bucketOf = (p) => Math.ceil(M_.of(p) / M_.bucket) * M_.bucket;
    const lo = scored.reduce((m, p) => Math.min(m, bucketOf(p)), Infinity);
    const hi = scored.reduce((m, p) => Math.max(m, bucketOf(p)), M_.bucket);
    const buckets = [];
    for (let b = M_.fromZero ? M_.bucket : lo; b <= hi; b += M_.bucket) buckets.push(b);
    const xOrder = [...buckets].reverse(); // largest -> smallest

    // A "unit" is one chart: either a single alliance or a whole state's
    // alliances aggregated together.
    const byState = state.chartMode === "state";
    const units = new Map();
    const unitOf = (p) =>
      byState ? p.state : `${p.state}_${p.allianceTag}`;

    for (const a of alliances) {
      const id = byState ? a.state : a.key;
      if (!units.has(id))
        units.set(id, {
          id,
          state: a.state,
          title: byState
            ? `State ${a.state}`
            : `${a.tag} — ${a.name}${a.partial ? " " + PARTIAL_MARK : ""}`,
          sub: byState ? [] : `State ${a.state}`,
          cells: new Map(),
          total: 0,
          n: 0,
        });
      if (byState) units.get(id).sub.push(a.tag);
    }

    for (const p of scored) {
      const u = units.get(unitOf(p));
      if (!u) continue;
      const b = bucketOf(p);
      if (!u.cells.has(b)) u.cells.set(b, {});
      const slot = u.cells.get(b);
      slot[p.rank] = slot[p.rank] || { v: 0, count: 0 };
      slot[p.rank].v += M_.of(p);
      slot[p.rank].count += 1;
      u.total += M_.of(p);
      u.n += 1;
    }
    // An alliance with nobody on the leaderboard gets no chart at all, rather
    // than an empty frame.
    for (const [id, u] of [...units]) if (!u.cells.size) units.delete(id);

    // chart.md: one shared Y max across every chart on screen, rounded up to
    // the next 50M. Aggregating by state raises it, which is why it is
    // recomputed per view rather than baked in.
    let yMax = 0;
    for (const u of units.values())
      for (const slot of u.cells.values())
        yMax = Math.max(yMax, drawnRanks.reduce((s, r) => s + (slot[r]?.v || 0), 0));
    yMax = Math.ceil(yMax / M_.yStep) * M_.yStep || M_.yStep;

    const scopeLabel = state.stateFilter === ALL ? "All states" : `State ${state.stateFilter}`;
    const covered =
      state.metric === "labyrinth"
        ? ` • ${fmtInt(scored.length)} of ${fmtInt(players.length)} selected chiefs are on a top-100 board`
        : "";
    $("#chart-sub").textContent =
      `${scopeLabel} — ${M_.label}, ${byState ? "one chart per state" : "one chart per alliance"}, ` +
      `${M_.bucketWord} buckets • shared Y max ${axisFmt(state.metric, yMax)}${covered}`;

    const ordered = [...units.values()].sort((x, y) => y.total - x.total);

    // Geometry in CSS pixels: the viewBox is sized to the container so one
    // user unit is one device-independent pixel. That keeps label text at a
    // fixed readable size as the chart shrinks, instead of scaling it down
    // into illegibility the way a fixed 1000-unit viewBox would.
    const W = Math.max(300, Math.floor(host.clientWidth) || 900);
    const H = Math.round(Math.min(320, Math.max(210, W * 0.3)));
    const M = { top: 10, right: 6, bottom: 48, left: 52 };
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;
    const band = plotW / xOrder.length;
    const barW = Math.max(3, band * 0.86);
    const y = (v) => M.top + plotH - (v / yMax) * plotH;

    // Rotated bucket labels need roughly 13px of run before they collide, so
    // thin them out rather than letting them overlap on a narrow screen.
    const labelStep = Math.max(1, Math.ceil(13 / band));

    const drawUnit = (u) => {
      {
        const svg = el("svg", {
          viewBox: `0 0 ${W} ${H}`,
          role: "img",
          "aria-label":
            `${u.title} ${M_.label} distribution by ${M_.bucketWord} bucket, stacked by rank`,
        });

        // horizontal grid + y ticks
        for (let i = 0; i <= 4; i++) {
          const v = (yMax / 4) * i;
          svg.appendChild(
            el("line", {
              x1: M.left, x2: W - M.right, y1: y(v), y2: y(v),
              stroke: "#fff", "stroke-opacity": ".18",
              "stroke-dasharray": "4 5", "stroke-width": "1",
            })
          );
          svg.appendChild(
            el("text", {
              x: M.left - 10, y: y(v) + 4, "text-anchor": "end",
              fill: "#b9c0d4", "font-size": "12", text: axisFmt(state.metric, v),
            })
          );
        }

        // bars
        xOrder.forEach((b, i) => {
          const slot = u.cells.get(b) || {};
          let acc = 0;
          drawnRanks.forEach((r) => {
            const d = slot[r];
            if (!d || d.v <= 0) return;
            const yTop = y(acc + d.v);
            const yBot = y(acc);
            const h = Math.max(1, yBot - yTop - 2); // 2px surface gap between segments
            const rect = el("rect", {
              class: "seg",
              x: M.left + i * band + (band - barW) / 2,
              y: yTop,
              width: barW,
              height: h,
              rx: 2,
              fill: COLORS[r],
            });
            const bl = bucketFmt(state.metric, b);
            const label =
              `<span class="t-rank" style="color:${COLORS[r]}">${r}</span> · ${bl} bucket<br>` +
              `${valueFmt(state.metric, d.v)} from ${d.count} chief${d.count === 1 ? "" : "s"}<br>` +
              `<span class="t-sub">${u.title}</span>`;
            bindTip(rect, label);
            rect.appendChild(
              el("title", { text: `${r} ${bl}: ${valueFmt(state.metric, d.v)} (${d.count})` })
            );
            svg.appendChild(rect);
            acc += d.v;
          });
        });

        // x labels
        xOrder.forEach((b, i) => {
          if (i % labelStep) return;
          const cx = M.left + i * band + band / 2;
          svg.appendChild(
            el("text", {
              x: cx, y: M.top + plotH + 16,
              "text-anchor": "end", fill: "#b9c0d4", "font-size": "12",
              transform: `rotate(-45 ${cx} ${M.top + plotH + 16})`,
              text: bucketFmt(state.metric, b),
            })
          );
        });

        const cap = el("figcaption");
        const detail = Array.isArray(u.sub)
          ? `${u.sub.length} alliance${u.sub.length === 1 ? "" : "s"}: ${u.sub.join(", ")}`
          : u.sub;
        cap.append(`${u.title} — Total: `);
        cap.appendChild(el("b", { text: axisFmt(state.metric, u.total) }));
        cap.appendChild(
          el("span", {
            class: "cap-sub",
            text: state.metric === "labyrinth" ? `${detail} • ${u.n} ranked` : detail,
          })
        );

        return el("figure", { class: "chart" }, [cap, svg]);
      }
    };

    // In per-alliance view across multiple states, band the charts under a
    // heading per state so it is obvious which state a bar belongs to.
    const statesShown = [...new Set(ordered.map((u) => u.state))];
    if (byState || statesShown.length < 2) {
      host.replaceChildren(...ordered.map(drawUnit));
      return;
    }

    const stateTotal = (st) =>
      ordered.filter((u) => u.state === st).reduce((s, u) => s + u.total, 0);

    host.replaceChildren(
      ...statesShown
        .sort((a, b) => stateTotal(b) - stateTotal(a))
        .map((st) => {
          const mine = ordered.filter((u) => u.state === st);
          const head = el("h3", { class: "state-head" });
          head.append(`State ${st}`);
          head.appendChild(
            el("span", {
              text: `${mine.length} alliance${mine.length === 1 ? "" : "s"} · ${fmtB(stateTotal(st))}`,
            })
          );
          return el("section", { class: "state-group" }, [head, ...mine.map(drawUnit)]);
        })
    );
  }

  /* ---------- alliance table ---------- */

  function renderAllianceTable() {
    const players = activePlayers();
    const rows = activeAlliances()
      .map((a) => {
        const mine = players.filter((p) => p.state === a.state && p.allianceTag === a.tag);
        const total = mine.reduce((s, p) => s + p.power, 0);
        return { a, mine, total };
      })
      .filter(({ mine }) => mine.length)
      .sort((x, y) => y.total - x.total);

    $("#alliance-table tbody").replaceChildren(
      ...rows.map(({ a, mine, total }) => {
        const tr = el("tr");
        const nameCell = el("td", { text: `[${a.tag}] ${a.name}` });
        if (a.partial) {
          nameCell.appendChild(
            el("span", { class: "partial", text: " " + PARTIAL_MARK, title: partialTitle(a) })
          );
        }
        tr.appendChild(nameCell);
        tr.appendChild(el("td", { text: a.state }));
        tr.appendChild(el("td", { class: "num", text: fmtInt(mine.length) }));
        tr.appendChild(el("td", { class: "num", text: fmtB(total) }));
        tr.appendChild(el("td", { class: "num", text: fmtPower(Math.round(total / mine.length)) }));
        tr.appendChild(
          el("td", { class: "num", text: fmtPower(Math.max(...mine.map((p) => p.power))) })
        );
        // Counts reflect the active rank filter, not the full roster, so the
        // row always adds up to the Members column.
        for (const r of RANKS) {
          const td = el("td", { class: "num" });
          const n = mine.filter((p) => p.rank === r).length;
          if (n) {
            const pill = el("span", { class: "pill", text: String(n) });
            pill.style.background = COLORS[r];
            td.appendChild(pill);
          } else td.textContent = "—";
          tr.appendChild(td);
        }
        return tr;
      })
    );

    // Spell the dagger out, so the caveat does not depend on hovering a tooltip.
    const short = rows.map(({ a }) => a).filter((a) => a.partial);
    const note = $("#partial-note");
    note.hidden = !short.length;
    note.textContent = short.length
      ? `${PARTIAL_MARK} ` +
        short.map((a) => `[${a.tag}] ${a.name}: ${a.partialNote}`).join("; ") +
        ". Their totals and bars are lower than reality."
      : "";
  }

  /* ---------- player table ---------- */

  function filteredPlayers() {
    const q = state.q.trim().toLowerCase();
    // Alliance and rank are already applied by activePlayers().
    return activePlayers().filter((p) => {
      if (q && !p.chiefName.toLowerCase().includes(q)) return false;
      if (state.furnace !== ALL) {
        const kind = p.furnace.startsWith("fc") ? "fc" : "f";
        if (kind !== state.furnace) return false;
      }
      return true;
    });
  }

  function sortPlayers(list) {
    const k = state.sortKey;
    const dir = state.sortDir;
    return [...list].sort((a, b) => {
      let x, y;
      if (k === "rank") {
        x = RANKS.indexOf(a.rank);
        y = RANKS.indexOf(b.rank);
      } else if (k === "furnace") {
        const val = (f) => (f.startsWith("fc") ? 100 : 0) + parseInt(f.replace(/\D/g, ""), 10);
        x = val(a.furnace);
        y = val(b.furnace);
      } else if (k === "index") {
        return 0;
      } else if (k === "labyrinth") {
        // No score is "not on the board", not "scored nothing" -- keep those
        // rows at the bottom whichever direction the column is sorted.
        if (a.labyrinth == null || b.labyrinth == null) {
          if (a.labyrinth == null && b.labyrinth == null) return 0;
          return a.labyrinth == null ? 1 : -1;
        }
        x = a.labyrinth;
        y = b.labyrinth;
      } else {
        x = a[k];
        y = b[k];
      }
      if (typeof x === "string") return dir * x.localeCompare(y);
      return dir * (x - y);
    });
  }

  function renderPlayerTable() {
    const list = sortPlayers(filteredPlayers());
    $("#player-count").textContent =
      `${fmtInt(list.length)} of ${fmtInt(activePlayers().length)} shown \u00b7 ${fmtInt(state.snapshot.players.length)} in snapshot`;

    $("#player-table tbody").replaceChildren(
      ...list.map((p, i) => {
        const tr = el("tr");
        tr.appendChild(el("td", { class: "num", text: String(i + 1) }));

        const nameTd = el("td");
        nameTd.textContent = p.chiefName || "(blank in game)";
        if (!p.chiefName) nameTd.style.color = "var(--ink-3)";
        tr.appendChild(nameTd);

        tr.appendChild(el("td", { class: "num", text: fmtPower(p.power) }));
        // Only each state's top 100 have a Labyrinth score at all.
        const lab = el("td", { class: "num" });
        if (p.labyrinth == null) {
          lab.textContent = "\u2014";
          lab.style.color = "var(--ink-3)";
        } else {
          lab.textContent = fmtInt(p.labyrinth);
          lab.setAttribute("title", `Rank ${p.labyrinthRank} in state ${p.state}`);
        }
        tr.appendChild(lab);
        tr.appendChild(el("td", { class: "num", text: p.state }));
        tr.appendChild(el("td", { text: `[${p.allianceTag}] ${p.alliance}` }));

        const rankTd = el("td");
        const pill = el("span", { class: "pill", text: p.rank });
        pill.style.background = COLORS[p.rank];
        rankTd.appendChild(pill);
        tr.appendChild(rankTd);

        tr.appendChild(
          el("td", { class: p.furnace.startsWith("fc") ? "fc" : "f", text: p.furnace })
        );
        return tr;
      })
    );
  }

  /* ---------- controls ---------- */

  function option(value, label) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  }

  /** Alliance checkbox list, grouped by state, with a per-state toggle. */
  function buildAlliancePicker() {
    const groups = $("#ms-alliance .ms-groups");
    const byState = new Map();
    for (const a of scopedAlliances()) {
      if (!byState.has(a.state)) byState.set(a.state, []);
      byState.get(a.state).push(a);
    }

    groups.replaceChildren(
      ...[...byState.entries()].map(([st, list]) => {
        const g = el("div", { class: "ms-group" });

        const head = el("label", { class: "ms-opt ms-state" });
        const headBox = document.createElement("input");
        headBox.type = "checkbox";
        headBox.checked = list.every((a) => state.picked.has(a.key));
        headBox.indeterminate =
          !headBox.checked && list.some((a) => state.picked.has(a.key));
        headBox.addEventListener("change", () => {
          for (const a of list) {
            if (headBox.checked) state.picked.add(a.key);
            else state.picked.delete(a.key);
          }
          buildAlliancePicker();
          renderAll();
        });
        head.append(headBox, `State ${st}`);
        g.appendChild(head);

        for (const a of list) {
          const row = el("label", { class: "ms-opt" });
          const box = document.createElement("input");
          box.type = "checkbox";
          box.checked = state.picked.has(a.key);
          box.addEventListener("change", () => {
            if (box.checked) state.picked.add(a.key);
            else state.picked.delete(a.key);
            buildAlliancePicker();
            renderAll();
          });
          row.append(box);
          row.appendChild(el("span", { class: "tag", text: `[${a.tag}]` }));
          row.appendChild(
            el("span", { text: a.name + (a.partial ? " " + PARTIAL_MARK : "") })
          );
          row.appendChild(el("span", { class: "n", text: String(a.memberCount) }));
          g.appendChild(row);
        }
        return g;
      })
    );

    const total = scopedAlliances().length;
    const n = activeAlliances().length;
    $("#ms-alliance-value").textContent =
      n === total ? `All ${total}` : n === 0 ? "None" : `${n} of ${total}`;
  }

  /** Rank toggles — five values, so pills beat a dropdown. */
  function buildRankPills() {
    $("#rank-pills").replaceChildren(
      ...RANKS.map((r) => {
        const on = state.ranks.has(r);
        const b = el("button", { type: "button", text: r });
        b.setAttribute("aria-pressed", String(on));
        if (on) b.style.background = COLORS[r];
        b.addEventListener("click", () => {
          if (state.ranks.has(r)) state.ranks.delete(r);
          else state.ranks.add(r);
          buildRankPills();
          renderAll();
        });
        return b;
      })
    );
  }

  function buildFilters() {
    const stateSel = $("#sel-state");
    stateSel.replaceChildren(
      option(ALL, "All states"),
      ...state.snapshot.states.map((s) => option(s, s))
    );
    stateSel.value = state.stateFilter;

    buildAlliancePicker();
    buildRankPills();

    $("#sel-furnace").replaceChildren(
      option(ALL, "All furnaces"),
      option("fc", "Fire Crystal (fc)"),
      option("f", "Regular (f)")
    );
    $("#sel-furnace").value = state.furnace;
    $("#sel-chartmode").value = state.chartMode;
  }

  /* ---------- top 20 per state, side by side ---------- */

  function renderTop20() {
    const M_ = METRICS[state.metric];
    const host = $("#top20");
    const players = activePlayers().filter((p) => M_.of(p) != null);
    const states = [...new Set(players.map((p) => p.state))].sort();

    if (!states.length) {
      $("#top20-sub").textContent = "";
      host.replaceChildren(
        el("p", {
          class: "empty",
          text:
            state.metric === "labyrinth"
              ? "No selected chief has a Labyrinth score — only each state's top 100 do."
              : "No chiefs selected.",
        })
      );
      return;
    }

    $("#top20-sub").textContent =
      `Ranked by ${M_.label.toLowerCase()}, one column per state, following the filters above.` +
      (states.length === 1 ? " Widen the state filter to compare two side by side." : "");

    host.replaceChildren(
      ...states.map((st) => {
        const top = players
          .filter((p) => p.state === st)
          .sort((a, b) => M_.of(b) - M_.of(a))
          .slice(0, 20);
        // A column total makes the two states comparable at a glance, rather
        // than leaving the reader to eyeball twenty rows against twenty rows.
        const sum = top.reduce((n, p) => n + M_.of(p), 0);

        const head = el("div", { class: "t20-head" });
        head.appendChild(el("span", { class: "t20-state", text: `State ${st}` }));
        head.appendChild(
          el("span", {
            class: "t20-sum",
            text: `${top.length} shown · ${axisFmt(state.metric, sum)} total`,
          })
        );

        const list = el("ol", { class: "t20-list" });
        for (const [i, pl] of top.entries()) {
          const li = el("li");
          li.appendChild(el("span", { class: "t20-pos", text: String(i + 1) }));
          const who = el("span", { class: "t20-who" });
          who.appendChild(el("span", { class: "t20-name", text: pl.chiefName || "(blank in game)" }));
          who.appendChild(el("span", { class: "t20-tag", text: `[${pl.allianceTag}]` }));
          li.appendChild(who);
          const pill = el("span", { class: "pill t20-rank", text: pl.rank });
          pill.style.background = COLORS[pl.rank];
          li.appendChild(pill);
          li.appendChild(el("span", { class: "t20-val", text: valueFmt(state.metric, M_.of(pl)) }));
          list.appendChild(li);
        }
        return el("section", { class: "t20-col" }, [head, list]);
      })
    );
  }

  function renderAll() {
    renderTiles();
    renderLegend();
    renderCharts();
    renderAllianceTable();
    renderTop20();
    renderPlayerTable();
  }

  function wire() {
    $("#sel-date").addEventListener("change", (e) => loadSnapshot(e.target.value));

    // Changing state re-scopes the alliance picker; select everything in the
    // new scope so the view is never mysteriously empty.
    $("#sel-state").addEventListener("change", (e) => {
      state.stateFilter = e.target.value;
      selectAllInScope();
      buildFilters();
      renderAll();
    });

    $("#q").addEventListener("input", (e) => {
      state.q = e.target.value;
      renderPlayerTable();
    });

    $("#sel-furnace").addEventListener("change", (e) => {
      state.furnace = e.target.value;
      renderPlayerTable();
    });

    $("#sel-chartmode").addEventListener("change", (e) => {
      state.chartMode = e.target.value;
      renderCharts();
    });

    $("#sel-metric").addEventListener("change", (e) => {
      state.metric = e.target.value;
      renderCharts();
      renderTop20();
    });

    // alliance dropdown open/close
    const ms = $("#ms-alliance");
    const msBtn = ms.querySelector(".ms-btn");
    const msPanel = ms.querySelector(".ms-panel");
    const setOpen = (open) => {
      msPanel.hidden = !open;
      msBtn.setAttribute("aria-expanded", String(open));
    };
    msBtn.addEventListener("click", () => setOpen(msPanel.hidden));
    ms.querySelector('[data-act="all"]').addEventListener("click", () => {
      selectAllInScope();
      buildAlliancePicker();
      renderAll();
    });
    ms.querySelector('[data-act="none"]').addEventListener("click", () => {
      state.picked.clear();
      buildAlliancePicker();
      renderAll();
    });
    document.addEventListener("click", (e) => {
      if (!ms.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });

    $("#reset").addEventListener("click", () => {
      state.q = "";
      state.furnace = ALL;
      state.ranks = new Set(RANKS);
      selectAllInScope();
      $("#q").value = "";
      buildFilters();
      renderAll();
    });

    document.querySelectorAll("#player-table th[data-sort]").forEach((th) => {
      th.tabIndex = 0;
      const activate = () => {
        const key = th.dataset.sort;
        if (state.sortKey === key) state.sortDir *= -1;
        else {
          state.sortKey = key;
          // Numeric "bigger is better" columns open descending; names open A-Z.
          state.sortDir = key === "power" || key === "labyrinth" ? -1 : 1;
        }
        document
          .querySelectorAll("#player-table th[aria-sort]")
          .forEach((o) => o.removeAttribute("aria-sort"));
        th.setAttribute("aria-sort", state.sortDir === 1 ? "ascending" : "descending");
        renderPlayerTable();
      };
      th.addEventListener("click", activate);
      th.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      });
    });

    // The chart viewBox is sized in real pixels, so a width change needs a
    // redraw to keep label density and bar widths right.
    let resizeTimer = null;
    let lastW = 0;
    window.addEventListener("resize", () => {
      const w = Math.floor($("#charts").clientWidth);
      if (w === lastW) return;
      lastW = w;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderCharts, 120);
    });

    window.addEventListener("scroll", hideTip, { passive: true });
    // a tap anywhere off a bar dismisses a touch-opened tooltip
    document.addEventListener("pointerdown", hideTip);
  }

  /* ---------- boot ---------- */

  async function loadSnapshot(date) {
    const entry = state.index.snapshots.find((s) => s.date === date);
    const res = await fetch("data/" + entry.file);
    state.snapshot = await res.json();
    if (!state.snapshot.states.includes(state.stateFilter)) state.stateFilter = ALL;
    selectAllInScope();
    buildFilters();
    renderAll();
  }

  async function boot() {
    try {
      state.index = await (await fetch("data/index.json")).json();
      const dates = state.index.snapshots.map((s) => s.date).sort().reverse();
      $("#sel-date").replaceChildren(...dates.map((d) => option(d, d)));
      wire();
      await loadSnapshot(dates[0]);
    } catch (err) {
      document.querySelector("main").insertAdjacentHTML(
        "afterbegin",
        `<div class="panel"><h2>Data failed to load</h2>
         <p class="panel-sub">${String(err)} — if you opened this file directly,
         serve it instead: <code>python3 -m http.server</code></p></div>`
      );
    }
  }

  boot();
})();
