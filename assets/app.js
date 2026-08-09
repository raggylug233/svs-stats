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

    if (!players.length) {
      $("#chart-sub").textContent = "";
      host.replaceChildren(
        el("p", {
          class: "empty",
          text: alliances.length
            ? "No ranks selected — pick at least one rank."
            : "No alliances selected — pick at least one alliance.",
        })
      );
      return;
    }

    const bucketOf = (p) => Math.ceil(p.power / BUCKET) * BUCKET;
    const maxBucket = players.reduce((m, p) => Math.max(m, bucketOf(p)), BUCKET);
    const buckets = [];
    for (let b = BUCKET; b <= maxBucket; b += BUCKET) buckets.push(b);
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
          title: byState ? `State ${a.state}` : `${a.tag} — ${a.name}`,
          sub: byState ? [] : `State ${a.state}`,
          cells: new Map(),
          total: 0,
        });
      if (byState) units.get(id).sub.push(a.tag);
    }

    for (const p of players) {
      const u = units.get(unitOf(p));
      if (!u) continue;
      const b = bucketOf(p);
      if (!u.cells.has(b)) u.cells.set(b, {});
      const slot = u.cells.get(b);
      slot[p.rank] = slot[p.rank] || { power: 0, count: 0 };
      slot[p.rank].power += p.power;
      slot[p.rank].count += 1;
      u.total += p.power;
    }

    // chart.md: one shared Y max across every chart on screen, rounded up to
    // the next 50M. Aggregating by state raises it, which is why it is
    // recomputed per view rather than baked in.
    let yMax = 0;
    for (const u of units.values())
      for (const slot of u.cells.values())
        yMax = Math.max(yMax, drawnRanks.reduce((s, r) => s + (slot[r]?.power || 0), 0));
    yMax = Math.ceil(yMax / 50_000_000) * 50_000_000 || 50_000_000;

    const scopeLabel = state.stateFilter === ALL ? "All states" : `State ${state.stateFilter}`;
    $("#chart-sub").textContent =
      `${scopeLabel} — ${byState ? "one chart per state" : "one chart per alliance"}, ` +
      `25M buckets • shared Y max ${fmtB(yMax)}`;

    const ordered = [...units.values()].sort((x, y) => y.total - x.total);

    // geometry
    const W = 1000, H = 300;
    const M = { top: 12, right: 8, bottom: 62, left: 62 };
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;
    const band = plotW / xOrder.length;
    const barW = band * 0.86;
    const y = (v) => M.top + plotH - (v / yMax) * plotH;

    const drawUnit = (u) => {
      {
        const svg = el("svg", {
          viewBox: `0 0 ${W} ${H}`,
          role: "img",
          "aria-label": `${u.title} power distribution by 25M bucket, stacked by rank`,
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
              fill: "#b9c0d4", "font-size": "12", text: fmtB(v),
            })
          );
        }

        // bars
        xOrder.forEach((b, i) => {
          const slot = u.cells.get(b) || {};
          let acc = 0;
          drawnRanks.forEach((r) => {
            const d = slot[r];
            if (!d || d.power <= 0) return;
            const yTop = y(acc + d.power);
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
            const label =
              `<span class="t-rank" style="color:${COLORS[r]}">${r}</span> · ${fmtM(b)} bucket<br>` +
              `${fmtPower(d.power)} from ${d.count} chief${d.count === 1 ? "" : "s"}<br>` +
              `<span class="t-sub">${u.title}</span>`;
            bindTip(rect, label);
            rect.appendChild(el("title", { text: `${r} ${fmtM(b)}: ${fmtPower(d.power)} (${d.count})` }));
            svg.appendChild(rect);
            acc += d.power;
          });
        });

        // x labels
        xOrder.forEach((b, i) => {
          const cx = M.left + i * band + band / 2;
          svg.appendChild(
            el("text", {
              x: cx, y: H - M.bottom + 18,
              "text-anchor": "end", fill: "#b9c0d4", "font-size": "12",
              transform: `rotate(-45 ${cx} ${H - M.bottom + 18})`,
              text: fmtM(b),
            })
          );
        });

        const cap = el("figcaption");
        const detail = Array.isArray(u.sub)
          ? `${u.sub.length} alliance${u.sub.length === 1 ? "" : "s"}: ${u.sub.join(", ")}`
          : u.sub;
        cap.append(`${u.title} — Total: `);
        cap.appendChild(el("b", { text: fmtB(u.total) }));
        cap.appendChild(el("span", { class: "cap-sub", text: detail }));

        // A phone can't show 27 buckets legibly at viewport width, so the plot
        // gets its own horizontal scroller with a floor on how narrow a bucket
        // may become. On desktop it simply fills the panel.
        const scroller = el("div", { class: "chart-scroll" });
        svg.style.minWidth = Math.max(560, xOrder.length * 32 + M.left + M.right) + "px";
        scroller.appendChild(svg);
        return el("figure", { class: "chart" }, [cap, scroller]);
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
        tr.appendChild(el("td", { text: `[${a.tag}] ${a.name}` }));
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
        if (p.nameUncertain) {
          const f = el("span", { class: "flag", title: "Decorative glyphs — verify spelling", text: " ⚠" });
          nameTd.appendChild(f);
        }
        tr.appendChild(nameTd);

        tr.appendChild(el("td", { class: "num", text: fmtPower(p.power) }));

        const rankTd = el("td");
        const pill = el("span", { class: "pill", text: p.rank });
        pill.style.background = COLORS[p.rank];
        rankTd.appendChild(pill);
        tr.appendChild(rankTd);

        tr.appendChild(
          el("td", { class: p.furnace.startsWith("fc") ? "fc" : "f", text: p.furnace })
        );
        tr.appendChild(el("td", { text: `[${p.allianceTag}] ${p.alliance}` }));
        tr.appendChild(el("td", { class: "num", text: p.state }));
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
          row.appendChild(el("span", { text: a.name }));
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

  function renderAll() {
    renderTiles();
    renderLegend();
    renderCharts();
    renderAllianceTable();
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
          state.sortDir = key === "power" ? -1 : 1;
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
