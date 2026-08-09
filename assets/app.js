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
    alliance: ALL,
    rank: ALL,
    furnace: ALL,
  };

  /* ---------- data helpers ---------- */

  const scopedPlayers = () =>
    state.snapshot.players.filter(
      (p) => state.stateFilter === ALL || p.state === state.stateFilter
    );

  const scopedAlliances = () =>
    state.snapshot.alliances.filter(
      (a) => state.stateFilter === ALL || a.state === state.stateFilter
    );

  /* ---------- tiles ---------- */

  function renderTiles() {
    const players = scopedPlayers();
    const alliances = scopedAlliances();
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
    $("#legend").replaceChildren(
      ...RANKS.map((r) => {
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
    t.style.left = evt.clientX + "px";
    t.style.top = evt.clientY + "px";
  }

  function hideTip() {
    tip().classList.remove("on");
  }

  /**
   * Per chart.md: 25M buckets (upper bound), x descending, bars stacked
   * R5..R1 bottom-to-top, one chart per alliance sorted by total power,
   * every bucket position present in every chart, one shared y max.
   */
  function renderCharts() {
    const players = scopedPlayers();
    const alliances = scopedAlliances();
    const host = $("#charts");

    const bucketOf = (p) => Math.ceil(p.power / BUCKET) * BUCKET;
    const maxBucket = players.reduce((m, p) => Math.max(m, bucketOf(p)), BUCKET);
    const buckets = [];
    for (let b = BUCKET; b <= maxBucket; b += BUCKET) buckets.push(b);
    const xOrder = [...buckets].reverse(); // largest -> smallest

    // cell[allianceKey][bucket][rank] = {power, count}
    const cell = new Map();
    for (const a of alliances) cell.set(a.key, new Map());
    for (const p of players) {
      const key = `${p.state}_${p.allianceTag}`;
      if (!cell.has(key)) continue;
      const byBucket = cell.get(key);
      const b = bucketOf(p);
      if (!byBucket.has(b)) byBucket.set(b, {});
      const slot = byBucket.get(b);
      slot[p.rank] = slot[p.rank] || { power: 0, count: 0 };
      slot[p.rank].power += p.power;
      slot[p.rank].count += 1;
    }

    let yMax = 0;
    for (const byBucket of cell.values())
      for (const slot of byBucket.values())
        yMax = Math.max(yMax, RANKS.reduce((s, r) => s + (slot[r]?.power || 0), 0));
    yMax = Math.ceil(yMax / 50_000_000) * 50_000_000 || 50_000_000;

    const scopeLabel = state.stateFilter === ALL ? "All states" : `State ${state.stateFilter}`;
    $("#chart-sub").textContent =
      `${scopeLabel} — power distribution by 25M buckets • shared Y max ${fmtB(yMax)}`;

    const totals = alliances
      .map((a) => ({
        a,
        total: players
          .filter((p) => p.state === a.state && p.allianceTag === a.tag)
          .reduce((s, p) => s + p.power, 0),
      }))
      .sort((x, y) => y.total - x.total);

    // geometry
    const W = 1000, H = 300;
    const M = { top: 12, right: 8, bottom: 62, left: 62 };
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;
    const band = plotW / xOrder.length;
    const barW = band * 0.86;
    const y = (v) => M.top + plotH - (v / yMax) * plotH;

    host.replaceChildren(
      ...totals.map(({ a, total }) => {
        const svg = el("svg", {
          viewBox: `0 0 ${W} ${H}`,
          role: "img",
          "aria-label": `${a.tag} power distribution by 25M bucket, stacked by rank`,
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
          const slot = cell.get(a.key).get(b) || {};
          let acc = 0;
          RANKS.forEach((r) => {
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
              `<span class="t-sub">${a.tag} — ${a.name}</span>`;
            rect.addEventListener("mousemove", (e) => showTip(e, label));
            rect.addEventListener("mouseleave", hideTip);
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
        cap.append(`${a.tag} — ${a.name} · State ${a.state} — Total: `);
        cap.appendChild(el("b", { text: fmtB(total) }));
        return el("figure", { class: "chart" }, [cap, svg]);
      })
    );
  }

  /* ---------- alliance table ---------- */

  function renderAllianceTable() {
    const players = scopedPlayers();
    const rows = scopedAlliances()
      .map((a) => {
        const mine = players.filter((p) => p.state === a.state && p.allianceTag === a.tag);
        const total = mine.reduce((s, p) => s + p.power, 0);
        return { a, mine, total };
      })
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
        for (const r of RANKS) {
          const td = el("td", { class: "num" });
          const n = a.rankCounts[r] || 0;
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
    return scopedPlayers().filter((p) => {
      if (q && !p.chiefName.toLowerCase().includes(q)) return false;
      if (state.alliance !== ALL && `${p.state}_${p.allianceTag}` !== state.alliance) return false;
      if (state.rank !== ALL && p.rank !== state.rank) return false;
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
      `${fmtInt(list.length)} of ${fmtInt(scopedPlayers().length)} chiefs`;

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

  function buildFilters() {
    const stateSel = $("#sel-state");
    stateSel.replaceChildren(
      option(ALL, "All states"),
      ...state.snapshot.states.map((s) => option(s, s))
    );
    stateSel.value = state.stateFilter;

    const aSel = $("#sel-alliance");
    aSel.replaceChildren(
      option(ALL, "All alliances"),
      ...scopedAlliances().map((a) => option(a.key, `[${a.tag}] ${a.name}`))
    );
    aSel.value = ALL;
    state.alliance = ALL;

    $("#sel-rank").replaceChildren(option(ALL, "All ranks"), ...RANKS.map((r) => option(r, r)));
    $("#sel-rank").value = state.rank;

    $("#sel-furnace").replaceChildren(
      option(ALL, "All furnaces"),
      option("fc", "Fire Crystal (fc)"),
      option("f", "Regular (f)")
    );
    $("#sel-furnace").value = state.furnace;
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

    $("#sel-state").addEventListener("change", (e) => {
      state.stateFilter = e.target.value;
      buildFilters();
      renderAll();
    });

    $("#q").addEventListener("input", (e) => {
      state.q = e.target.value;
      renderPlayerTable();
    });

    for (const [sel, key] of [["#sel-alliance", "alliance"], ["#sel-rank", "rank"], ["#sel-furnace", "furnace"]]) {
      $(sel).addEventListener("change", (e) => {
        state[key] = e.target.value;
        renderPlayerTable();
      });
    }

    $("#reset").addEventListener("click", () => {
      state.q = "";
      state.alliance = state.rank = state.furnace = ALL;
      $("#q").value = "";
      buildFilters();
      renderPlayerTable();
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
  }

  /* ---------- boot ---------- */

  async function loadSnapshot(date) {
    const entry = state.index.snapshots.find((s) => s.date === date);
    const res = await fetch("data/" + entry.file);
    state.snapshot = await res.json();
    if (!state.snapshot.states.includes(state.stateFilter)) state.stateFilter = ALL;
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
