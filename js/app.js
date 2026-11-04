/*
 * 五步島的遊戲邏輯。內容在 content.js，跟 AI 講話在 ai.js。
 * 進度存在這台電腦的瀏覽器（localStorage），不用註冊。
 */
(function () {
  const C = window.ISLE;
  const AI = window.IsleAI;
  const ISLES = C.islands;
  const SAVE = "isle.state.v1";
  const $ = (s) => document.querySelector(s);

  /* ---------- 存檔 ---------- */
  function fresh() {
    const isles = {};
    ISLES.forEach(i => { isles[i.id] = { answers: {}, tries: 0, passed: false, mode: "", handed: false, say: "", sayGood: false, self: false }; });
    return { v: 1, name: "", avatar: C.players[0].id, mood: "dawn", xp: 0, visited: {}, report: "", isles, chat: [], revealed: [], chats: {}, center: { handed: false, answers: {} }, current: null, calm: false };
  }
  let S = load();
  function load() {
    try {
      const raw = localStorage.getItem(SAVE);
      if (raw) return Object.assign(fresh(), JSON.parse(raw));
    } catch (e) {}
    return fresh();
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(SAVE, JSON.stringify(S)); } catch (e) {} }, 150);
  }

  /* ---------- 小工具 ---------- */
  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function toast(msg) {
    const t = $("#toast");
    t.innerHTML = window.IsleArt.text(msg); t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  const idx = (id) => ISLES.findIndex(i => i.id === id);
  const isUnlocked = (i) => i === 0 || S.isles[ISLES[i - 1].id].passed;
  const allPassed = () => ISLES.every(i => S.isles[i.id].passed);
  const stampCount = () => ISLES.filter(i => S.isles[i.id].passed).length;
  function levelName() {
    return C.levels[Math.min(C.levels.length - 1, Math.floor(S.xp / 12))];
  }
  function missionLine() {
    const m = S.report.match(/我選的是[^。\n]*。?/);
    if (m) return m[0];
    const first = S.report.split("\n").map(s => s.trim()).find(Boolean);
    return first || "";
  }
  function playerOf() { return C.players.find(p => p.id === S.avatar) || C.players[0]; }
  const hex = (n) => "#" + n.toString(16).padStart(6, "0");
  function miniFig(p) { return window.IsleArt.player(p); }
  function answersText(island) {
    return island.fields.map(f => `【${f.label}】\n${S.isles[island.id].answers[f.id] || "（沒寫）"}`).join("\n\n");
  }

  /* ---------- 地圖 ---------- */
  function pos(i) {
    if (i === "center") return { x: 50, y: 50 };
    if (i === 0) return { x: 25, y: 6 };
    if (i === 1) return { x: 67, y: 17 };
    const a = (-90 + i * 72) * Math.PI / 180;
    return { x: 50 + 34 * Math.cos(a), y: 50 + 34 * Math.sin(a) };
  }
  function blob(seed, color) {
    // 每座島不一樣的形狀：用幾個點繞一圈，畫成圓滑的島
    const pts = [];
    const n = 9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const r = 38 + 7 * Math.sin(seed * 1.7 + k * 2.3) + 4 * Math.cos(seed + k * 1.1);
      pts.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
    }
    const path = (scale) => {
      const p = pts.map(([x, y]) => [50 + (x - 50) * scale, 50 + (y - 50) * scale]);
      let d = `M ${(p[0][0] + p[1][0]) / 2} ${(p[0][1] + p[1][1]) / 2}`;
      for (let k = 1; k <= n; k++) {
        const cur = p[k % n], nxt = p[(k + 1) % n];
        d += ` Q ${cur[0]} ${cur[1]} ${(cur[0] + nxt[0]) / 2} ${(cur[1] + nxt[1]) / 2}`;
      }
      return d + " Z";
    };
    return `<svg viewBox="0 0 100 100" aria-hidden="true"><path class="sand" d="${path(1.12)}"/><path d="${path(0.95)}" fill="${color}"/></svg>`;
  }
  /* 2.5D 世界；沒有 WebGL 就用平面地圖 */
  let world3d = false;
  function initWorld() {
    try {
      const toWorld = (p) => ({ x: (p.x - 50) * 0.78, z: (p.y - 50) * 0.78 });
      const spec = {
        islands: ISLES.map((isle, i) => Object.assign({ id: isle.id, r: 7, accent: isle.accent, landmark: isle.id, keeperStyle: isle.keeperStyle, monsterColor: isle.monsterColor,
          // 小安是玩家的使用者：去問島過關後，她離開去問島，到給他用島等著試原型（Kevin 2026-11-03）
          partnerStyle: isle.partner ? (ISLES.find(o => o.keeper.name === isle.partner.name) || {}).keeperStyle : null,
          partnerFrom: isle.partner ? (ISLES.find(o => o.keeper.name === isle.partner.name) || {}).id : null }, toWorld(pos(i)))),
        center: Object.assign({ id: "center", r: 7.5, accent: C.center.accent, landmark: "center", keeperStyle: C.center.keeperStyle }, toWorld(pos("center"))),
        player: playerOf(),
        start: S.current || ISLES[0].id,
        // 點島名只把鏡頭移過去；要走到守門人身邊才開始
        onPick: (id) => {
          if (window.IsleWorld.isNear(id)) return openPlace(id);
          window.IsleWorld.focus(id);
          const k = id === "center" ? C.center.keeper : ISLES[idx(id)].keeper;
          toast(placeLocked(id) ? "這座島的門還沒開，先把前一座島過關" : `用方向鍵走過去，走到${k.name}身邊就會開始`);
        },
        onNear: (id) => { if (!placeLocked(id)) openPlace(id); else toast("這座島的門還沒開，先把前一座島過關"); },
        onLeave: (id) => { if (S.current === id && !$("#panel").hidden) closePanel(); }
      };
      world3d = window.IsleWorld && window.IsleWorld.init($("#world"), spec);
    } catch (e) { world3d = false; }
    $("#map").hidden = !!world3d;
    $("#world").hidden = !world3d;
    $("#hint").hidden = !world3d;
    $("#btn-overview").hidden = !world3d;
    $("#btn-follow").hidden = !world3d;
    $("#mood").hidden = !world3d;
  }
  function drawWorld() {
    const locked = {}, passed = {}, labels = {};
    const stepName = ["第一步", "第二步", "第三步", "第四步", "第五步"];
    ISLES.forEach((isle, i) => {
      locked[isle.id] = !isUnlocked(i);
      passed[isle.id] = S.isles[isle.id].passed;
      const state = passed[isle.id] ? "已過關" : locked[isle.id] ? "還沒開" : S.visited[isle.id] ? "已登島" : "可以登島";
      labels[isle.id] = { num: isle.no, title: esc(isle.name), sub: `${stepName[i]}・${state}`, aria: `${isle.no} ${isle.name}，${state}` };
    });
    locked.center = !allPassed();
    labels.center = { num: "★", title: esc(C.center.name), sub: locked.center ? `要五枚島章（${stampCount()}/5）` : "可以進入", aria: C.center.name };
    window.IsleWorld.update({ locked, passed, labels, current: S.current, player: playerOf(), calm: S.calm, mood: S.mood || "dawn", panelOpen: !$("#panel").hidden });
  }

  function drawMap() {
    if (world3d) return drawWorld();
    const box = $("#islands");
    let html = "";
    ISLES.forEach((isle, i) => {
      const p = pos(i);
      const st = S.isles[isle.id];
      const locked = !isUnlocked(i);
      const badge = st.passed ? window.IsleArt.icon("stamp") : locked ? window.IsleArt.icon("lock") : "";
      html += `<button class="isle${locked ? " locked" : ""}${S.current === isle.id ? " current" : ""}" style="left:${p.x}%;top:${p.y}%" data-id="${isle.id}" aria-label="${isle.no} ${esc(isle.name)}${locked ? "（還沒開）" : ""}">
        ${window.IsleArt.station(isle.id)}
        <span class="isle-badge">${badge}</span>
        <span class="isle-inner"><span class="isle-keeper">${window.IsleArt.face(isle.keeper.name)}</span><br><span class="isle-name">${isle.no} ${esc(isle.name)}</span></span>
      </button>`;
    });
    const cp = pos("center"), cLocked = !allPassed();
    html += `<button class="isle center${cLocked ? " locked" : ""}${S.current === "center" ? " current" : ""}" style="left:${cp.x}%;top:${cp.y}%" data-id="center" aria-label="${esc(C.center.name)}${cLocked ? "（還沒開）" : ""}">
      ${window.IsleArt.station("center")}
      <span class="isle-badge">${cLocked ? window.IsleArt.icon("lock") : ""}</span>
      <span class="isle-inner"><span class="isle-keeper">${window.IsleArt.face(C.center.keeper.name)}</span><br><span class="isle-name">${esc(C.center.name)}</span></span>
    </button>`;
    box.innerHTML = html;
    box.querySelectorAll(".isle").forEach(b => b.addEventListener("click", () => openPlace(b.dataset.id)));

    // 航線
    let r = "";
    for (let i = 0; i < ISLES.length; i++) {
      const a = pos(i), b = i < ISLES.length - 1 ? pos(i + 1) : pos("center");
      const done = S.isles[ISLES[i].id].passed;
      const mx = (a.x + b.x) / 2, my = i === 0 ? Math.min(a.y, b.y) - 8 : (a.y + b.y) / 2;
      r += `<path class="${done ? "done" : ""}" d="M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}"/>`;
    }
    $("#routes").innerHTML = r;

    // 主角
    const at = S.current ? pos(S.current === "center" ? "center" : idx(S.current)) : pos(0);
    const av = $("#avatar");
    av.innerHTML = window.IsleArt.player(playerOf());
    av.style.left = at.x + "%";
    av.style.top = at.y + "%";
  }

  function drawHeader() {
    $("#world-name").textContent = C.worldName;
    $("#world-sub").textContent = C.opening;
    const has = !!S.name;
    $("#me-badge").hidden = !has;
    const n = stampCount();
    $("#progress-num").textContent = `${n} / ${ISLES.length}`;
    $("#progress-bar").style.width = (n / ISLES.length * 100) + "%";
    $("#bag-count").textContent = n;
    document.querySelectorAll("#mood [data-mood]").forEach(b => b.classList.toggle("on", b.dataset.mood === (S.mood || "dawn")));
    if (has) {
      $("#me-avatar").innerHTML = miniFig(playerOf());
      $("#me-name").textContent = S.name;
      $("#me-level").textContent = `${levelName()}・${S.xp} 經驗`;
    }
    const showMission = !!S.report;
    $("#mission").hidden = !showMission;
    if (showMission) {
      $("#mission-title").textContent = C.missionTitle;
      $("#mission-line").textContent = missionLine();
    }
    document.body.classList.toggle("calm", !!S.calm);
  }

  function refresh() { drawHeader(); drawMap(); save(); }

  /* ---------- 面板 ---------- */
  function placeLocked(id) { return id === "center" ? !allPassed() : !isUnlocked(idx(id)); }
  function openPlace(id) {
    S.current = id;
    if (!S.visited[id]) { S.visited[id] = true; S.xp += 5; }
    $("#panel").hidden = false;
    renderPanel();
    refresh();
    if (world3d) window.IsleWorld.focus(id);
  }
  function closePanel() { $("#panel").hidden = true; drawMap(); }
  function renderPanel() {
    if (!S.current) return;
    if (S.current === "center") renderCenter(); else renderIsland(S.current);
  }

  function whoBox(k) {
    return `<div class="who"><span class="face">${window.IsleArt.face(k.name)}</span><div><b>${esc(k.name)}</b><small>${esc(k.title)}</small></div></div>`;
  }

  function renderIsland(id) {
    const i = idx(id), isle = ISLES[i], st = S.isles[id];
    const prev = i > 0 ? ISLES[i - 1] : null;
    const stepName = ["第一步", "第二步", "第三步", "第四步", "第五步"][i];
    let h = `<div class="eyebrow">${stepName}・報告${esc(isle.chapter.split("、")[0])}章</div>
      <h2>${esc(isle.name)}</h2><p class="doing">${esc(isle.doing)}</p>
      <div class="sec">守門人</div>${whoBox(isle.keeper)}
      <div class="sec">島上的怪獸</div>
      <div class="who monster"><span class="face">${window.IsleArt.monster(isle.monster.name)}</span><div><b>${esc(isle.monster.name)}</b><small>${esc(isle.monster.habit)}</small></div></div>`;

    if (!isUnlocked(i)) {
      h += `<div class="box">要等你在<b>${esc(prev.name)}</b>過關，這座島才會打開。</div>`;
      return put(h);
    }
    if (!S.report) {
      h += `<div class="box"><h3>先貼上你的報告</h3><p class="note">把你身為主管在課堂上完成的那一份報告整份複製貼過來，島上的人都會照這份報告陪你。</p>
        <div class="btns"><button class="btn primary" data-act="report">貼上報告</button></div></div>`;
      return put(h);
    }
    if (prev && !st.handed) {
      h += `<div class="box"><h3>交接</h3><p>你帶著上一座島拿到的 <b>${window.IsleArt.item(prev.item)} ${esc(prev.item.name)}</b>。</p>
        <details><summary>打開看看</summary><div class="answer">${esc(answersText(prev))}</div></details>
        <div class="btns"><button class="btn primary" data-act="handover">把 ${window.IsleArt.item(prev.item)} ${esc(prev.item.name)} 交給${esc(isle.keeper.name)}</button></div></div>`;
      return put(h);
    }
    if (prev) {
      h += `<details class="box prev"><summary>上一步交出來的：${window.IsleArt.item(prev.item)} ${esc(prev.item.name)}</summary><pre>${esc(answersText(prev))}</pre></details>`;
    }
    if (isle.cards) h += chatBox(isle);

    if (st.passed) {
      h += `<div class="box"><div class="stamp-big">${window.IsleArt.icon("stamp")}</div>
        <p style="text-align:center">拿到 <b>${window.IsleArt.item(isle.item)} ${esc(isle.item.name)}</b>${st.mode === "flagged" ? `<br><span class="flag">這一步還可以再想</span>` : ""}${st.mode === "self" ? `<br><span class="note">用自我檢查過關</span>` : ""}</p>
        ${st.say ? `<div class="say good">${esc(isle.keeper.name)}：${esc(st.say)}</div>` : ""}
        ${isle.fields.map(f => `<div class="field"><label>${esc(f.label)}</label><div class="answer">${esc(st.answers[f.id] || "")}</div></div>`).join("")}
        <p class="note">要改的話，五座島都過了以後，到${esc(C.center.name)}改。</p>
        ${nextHint(i)}</div>`;
      return put(h);
    }

    h += `<div class="box"><h3>做這一步</h3>
      ${isle.fields.map(f => `<div class="field"><label for="f-${f.id}">${esc(f.label)}</label>${f.help ? `<span class="help">${esc(f.help)}</span>` : ""}<textarea id="f-${f.id}" data-field="${f.id}" rows="${f.rows || 3}">${esc(st.answers[f.id] || "")}</textarea></div>`).join("")}
      ${st.say ? `<div class="say bad">${st.tries > 0 ? `<b>${window.IsleArt.monster(isle.monster.name)} ${esc(isle.monster.name)}出現了！</b><br>` : ""}${esc(isle.keeper.name)}：${esc(st.say)}</div>` : ""}
      <p class="note">已經交給${esc(isle.keeper.name)} ${st.tries} 次，最多 3 次。第 3 次沒過也會放行，報告上會標「這一步還可以再想」。</p>
      <div class="btns">
        <button class="btn primary" data-act="judge">交給${esc(isle.keeper.name)}</button>
      </div>
      <details class="box"${(st.fails || 0) >= 2 ? " open" : ""}><summary>做不完要先交？</summary><p class="note">${(st.fails || 0) >= 2 ? "守門人連續兩次都叫不到（額度用完、太忙或網路斷了）。可以過一陣子再試；真的一直不行，" : "時間不夠或卡住了，"}在下面寫卡在哪、為什麼，再印出寫到這裡的報告，做到的部分照樣交，這樣也算有交。</p><div class="field"><label for="stuck">卡在哪、為什麼</label><textarea id="stuck" rows="3">${esc(S.stuck || "")}</textarea></div><div class="btns"><button class="btn" data-act="print">印出寫到這裡的報告</button></div></details></div>`;
    put(h);
  }

  function nextHint(i) {
    if (i < ISLES.length - 1) {
      const n = ISLES[i + 1];
      return `<p><b>下一站：</b>${esc(n.name)}，把 ${window.IsleArt.item(ISLES[i].item)} ${esc(ISLES[i].item.name)} 交給${esc(n.keeper.name)}。</p><div class="btns"><button class="btn primary" data-act="goto" data-to="${n.id}">看看去${esc(n.name)}的路</button></div>`;
    }
    return `<p><b>下一站：</b>中央的${esc(C.center.name)}，把 ${window.IsleArt.item(ISLES[i].item)} ${esc(ISLES[i].item.name)} 交給${esc(C.center.keeper.name)}。</p><div class="btns"><button class="btn primary" data-act="goto" data-to="center">看看去${esc(C.center.name)}的路</button></div>`;
  }

  function conv(isle) {
    if (isle.id === ISLES[0].id) return { chat: S.chat, revealed: S.revealed };
    if (!S.chats) S.chats = {};
    if (!S.chats[isle.id]) S.chats[isle.id] = { chat: [], revealed: [] };
    return S.chats[isle.id];
  }

  function chatBox(isle) {
    const who = isle.partner || isle.keeper;
    const cv = conv(isle);
    const opened = cv.revealed;
    const cards = isle.cards.map(c => `<div class="card${opened.includes(c.id) ? " open" : ""}">${opened.includes(c.id) ? esc(c.title) : "？"}</div>`).join("");
    const has = !!AI.getKey();
    const msgs = cv.chat.map(m => `<div class="msg ${m.who === "me" ? "me" : "her"}">${m.who === "her" ? `<span class="msg-avatar">${window.IsleArt.face(who.name)}</span>` : ""}<span class="msg-copy">${esc(m.text)}</span></div>`).join("");
    return `<div class="box"><h3>跟${esc(who.name)}聊聊</h3>
      <p class="note">${esc(who.name)}身上藏著三件事，問對了才會說。已經翻開 ${opened.length}／${isle.cards.length}。</p>
      <div class="cards">${cards}</div>
      ${has ? `<div class="chat" id="chat">${msgs || `<div class="note">先打個招呼吧。</div>`}</div>
        <div class="chat-input"><input type="text" id="chat-in" placeholder="${esc(isle.chatHint || "想問" + who.name + "什麼？")}" autocomplete="off"><button class="btn primary" data-act="send">送出</button></div>`
      : `<p class="note">跟${esc(who.name)}聊天要用你自己的 Gemini 金鑰。${isle.partner ? "貼上之後才能開始。" : "貼上之後才能開始。"}</p>
         <div class="btns"><button class="btn" data-act="key">貼上金鑰</button></div>`}
    </div>`;
  }

  function renderCenter() {
    const c = C.center;
    let h = `<div class="eyebrow">中央・回頭修改</div><h2>${esc(c.name)}</h2><p class="doing">${esc(c.doing)}</p><div class="sec">守塔人</div>${whoBox(c.keeper)}`;
    if (!allPassed()) {
      h += `<div class="box">五枚島章都到手，${esc(c.keeper.name)}才會打開這座島。你現在有 ${stampCount()} 枚。</div>`;
      return put(h);
    }
    const last = ISLES[ISLES.length - 1];
    if (!S.center.handed) {
      h += `<div class="box"><h3>交接</h3><p>你帶著 <b>${window.IsleArt.item(last.item)} ${esc(last.item.name)}</b>，還有一路拿到的五枚島章。</p>
        <div class="btns"><button class="btn primary" data-act="handover-center">把 ${window.IsleArt.item(last.item)} ${esc(last.item.name)} 交給${esc(c.keeper.name)}</button></div></div>`;
      return put(h);
    }
    h += `<div class="box"><h3>${esc(C.chapter0)}</h3><div class="answer">${esc(S.report)}</div>
      <div class="btns"><button class="btn" data-act="report">改我的報告</button></div></div>`;
    ISLES.forEach(isle => {
      const st = S.isles[isle.id];
      h += `<details class="box"><summary><b>${esc(isle.chapter)}</b>（${esc(isle.name)}）${st.mode === "flagged" ? ` <span class="flag">還可以再想</span>` : ""}</summary>
        ${isle.fields.map(f => `<div class="field"><label>${esc(f.label)}</label><textarea data-isle="${isle.id}" data-field="${f.id}" rows="${f.rows || 3}">${esc(st.answers[f.id] || "")}</textarea></div>`).join("")}</details>`;
    });
    h += `<div class="box">${c.fields.map(f => `<div class="field"><label for="c-${f.id}">${esc(f.label)}</label><textarea id="c-${f.id}" data-center="${f.id}" rows="${f.rows || 4}">${esc(S.center.answers[f.id] || "")}</textarea></div>`).join("")}
      <div class="btns"><button class="btn ok" data-act="print">印成 PDF</button></div>
      <p class="note">按下去會跳出列印視窗，目的地選「另存為 PDF」，就是要交的${esc(C.reportTitle)}。</p></div>`;
    put(h);
  }

  function put(h) {
    const body = $("#panel-body");
    body.innerHTML = h;
    body.querySelectorAll("textarea[data-field]").forEach(t => t.addEventListener("input", () => {
      const isleId = t.dataset.isle || S.current;
      S.isles[isleId].answers[t.dataset.field] = t.value; save();
    }));
    body.querySelectorAll("textarea[data-center]").forEach(t => t.addEventListener("input", () => {
      S.center.answers[t.dataset.center] = t.value; save();
    }));
    const stuck = body.querySelector("#stuck");
    if (stuck) stuck.addEventListener("input", () => { S.stuck = stuck.value; save(); });
    body.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => act(b.dataset.act, b)));
    const inp = $("#chat-in");
    if (inp) inp.addEventListener("keydown", e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); act("send"); } });
    const chat = $("#chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  /* ---------- 動作 ---------- */
  async function act(a, btn) {
    const id = S.current;
    if (a === "goto") {
      if (!world3d) return openPlace(btn.dataset.to);
      closePanel(); window.IsleWorld.focus(btn.dataset.to);
      return toast("橋頭的門打開了。用方向鍵走過橋，走到守門人身邊就會開始");
    }
    if (a === "report") return reportModal();
    if (a === "key") return keyModal();
    if (a === "handover") { S.isles[id].handed = true; toast("交接完成，開始這一步"); renderPanel(); return refresh(); }
    if (a === "handover-center") { S.center.handed = true; toast(`${C.center.keeper.name}打開了${C.center.name}`); renderPanel(); return refresh(); }
    if (a === "print") return printReport();
    if (a === "send") return sendChat();
    if (a === "judge") return doJudge(btn);
  }

  function missing(isle) {
    return isle.fields.filter(f => !(S.isles[isle.id].answers[f.id] || "").trim());
  }

  async function doJudge(btn) {
    const isle = ISLES[idx(S.current)], st = S.isles[isle.id];
    const miss = missing(isle);
    if (miss.length) return toast(`還有欄位是空的：${miss[0].label}`);
    if (!AI.getKey()) { toast("要先貼上自己的 Gemini 金鑰，守門人才會判"); return keyModal(); }
    btn.disabled = true; btn.textContent = `${isle.keeper.name}看一下⋯`;
    const i = idx(isle.id);
    const prev = i > 0 ? answersText(ISLES[i - 1]) : "";
    try {
      const r = await AI.judge(isle, st.answers, S.report, prev);
      st.tries += 1;
      st.say = r.say || "";
      st.fails = 0;
      if (r.pass) return passIsland(isle, "ai");
      if (st.tries >= 3) return passIsland(isle, "flagged");
      renderPanel(); save();
    } catch (e) {
      toast(AI.errorMessage(e));
      // 金鑰的問題不算叫不到；額度、太忙、網路才算（Kevin 2026-11-02：拿掉自我檢查，叫不到就寫原因交）
      if (!["NO_KEY", "BAD_KEY"].includes(e.message)) { st.fails = (st.fails || 0) + 1; save(); renderPanel(); return; }
      btn.disabled = false; btn.textContent = `交給${isle.keeper.name}`;
    }
  }


  function passIsland(isle, mode) {
    const st = S.isles[isle.id];
    st.passed = true; st.mode = mode;
    S.xp += 10;
    toast(`拿到島章和 ${isle.item.icon} ${isle.item.name}`);
    renderPanel(); refresh();
  }

  async function sendChat() {
    const inp = $("#chat-in");
    const text = (inp.value || "").trim();
    if (!text) return;
    const isle = ISLES[idx(S.current)];
    const cv = conv(isle);
    cv.chat.push({ who: "me", text });
    inp.value = "";
    renderPanel(); save();
    const chat = $("#chat");
    chat.insertAdjacentHTML("beforeend", `<div class="msg her" id="typing">⋯</div>`);
    chat.scrollTop = chat.scrollHeight;
    try {
      // 小安不看報告，只知道是哪一台家電（Kevin 2026-11-03）
      if (!S.appliance && S.report) S.appliance = await AI.applianceOf(S.report);
      const r = isle.id === ISLES[0].id
        ? await AI.talkToXiaoAn(S.appliance, cv.chat, cv.revealed)
        : await AI.talkToTester(S.appliance, answersText(ISLES[idx("build")]), cv.chat, cv.revealed, conv(ISLES[0]).chat);
      cv.chat.push({ who: "her", text: r.reply || "嗯⋯" });
      const fresh = (r.revealed || []).filter(id => !cv.revealed.includes(id));
      fresh.forEach(id => cv.revealed.push(id));
      if (fresh.length) toast(`翻開一張卡：${fresh.map(id => isle.cards.find(c => c.id === id).title).join("、")}`);
    } catch (e) {
      toast(AI.errorMessage(e));
    }
    renderPanel(); save();
    const again = $("#chat-in"); if (again) again.focus();
  }

  /* ---------- 對話框 ---------- */
  function modal(h, onMount) {
    $("#modal").innerHTML = h;
    $("#modal-back").hidden = false;
    $("#modal").querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeModal));
    if (onMount) onMount($("#modal"));
  }
  function closeModal() { $("#modal-back").hidden = true; }

  function startModal() {
    let pick = playerOf().id;
    modal(`<div class="hero"><small>五座島・一條路・一份報告</small><h1>${esc(C.worldName)}</h1><p>${esc(C.opening)}</p></div>
      <div class="field"><label for="m-name">冒險者代號（不用真名）</label><input type="text" id="m-name" maxlength="12" placeholder="例如：晨霧小隊"><span class="help">代號只用來區分同一台電腦上的不同存檔。</span></div>
      <label class="field"><b>選一個樣子</b></label>
      <div class="players">${C.players.map(p => `<button data-av="${p.id}" class="${p.id === pick ? "on" : ""}">${miniFig(p)}<b>${esc(p.name)}</b><small>${esc(p.desc)}</small></button>`).join("")}</div>
      <div class="btns"><button class="btn primary big" id="m-go">開始冒險</button></div>
      <p class="note">進度存在這台電腦的瀏覽器，換電腦可以用接關碼接著玩。不用註冊，也不收集個人資料。</p>
      <details style="margin-top:14px"><summary class="note">換了電腦？貼上接關碼接著玩</summary>
        <textarea id="m-code" rows="3" style="width:100%;margin-top:6px"></textarea>
        <div class="btns"><button class="btn" id="m-load">接著玩</button></div></details>`, m => {
      m.querySelectorAll("[data-av]").forEach(b => b.addEventListener("click", () => {
        pick = b.dataset.av; m.querySelectorAll("[data-av]").forEach(x => x.classList.toggle("on", x === b));
      }));
      m.querySelector("#m-go").addEventListener("click", () => {
        const n = m.querySelector("#m-name").value.trim();
        if (!n) return toast("取一個代號吧");
        S.name = n; S.avatar = pick; closeModal(); refresh();
        if (!S.report) reportModal();
      });
      m.querySelector("#m-load").addEventListener("click", () => loadCode(m.querySelector("#m-code").value));
      m.querySelector("#m-name").focus();
    });
  }

  function reportModal() {
    modal(`<h2>${window.IsleArt.icon("report")} 我的報告</h2>
      <p>把你身為主管在課堂上完成的那一份報告放進來。島上的人都會照這份報告陪你。</p>
      <div class="field"><label for="m-link">貼上那一份 Google 文件的連結</label>
        <span class="help">文件的共用要先設成「知道連結的任何人」可以檢視</span>
        <div style="display:flex;gap:8px"><input id="m-link" type="url" style="flex:1" placeholder="https://docs.google.com/document/d/⋯"><button class="btn" id="m-fetch">讀進來</button></div></div>
      <p class="note">或是直接把整份複製貼在下面：</p>
      <textarea id="m-report" rows="12">${esc(S.report)}</textarea>
      <div class="btns"><button class="btn primary" id="m-save">存好了</button><button class="btn" data-close>先不要</button></div>`, m => {
      m.querySelector("#m-fetch").addEventListener("click", async () => {
        const link = m.querySelector("#m-link").value.trim();
        const id = (link.match(/\/document\/d\/([\w-]+)/) || [])[1];
        if (!id) return toast("這不是 Google 文件的連結");
        const btn = m.querySelector("#m-fetch"); btn.disabled = true; btn.textContent = "讀取中⋯";
        try {
          const r = await fetch(`https://docs.google.com/document/d/${id}/export?format=txt`);
          const t = r.ok ? (await r.text()).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim() : "";
          if (!t || /^<!DOCTYPE/i.test(t)) throw new Error("讀不到");
          m.querySelector("#m-report").value = t;
          toast("讀進來了，看一下內容對不對，再按「存好了」");
        } catch (e) {
          toast("讀不到。檢查文件的共用是不是「知道連結的任何人」，或改用複製貼上");
        } finally { btn.disabled = false; btn.textContent = "讀進來"; }
      });
      m.querySelector("#m-save").addEventListener("click", () => {
        const v = m.querySelector("#m-report").value.trim();
        if (!v) return toast("報告是空的");
        S.report = v; S.appliance = ""; closeModal(); renderPanel(); refresh();
        toast("報告存好了，左上角是這一趟的任務");
      });
    });
  }

  function keyModal() {
    const has = !!AI.getKey();
    modal(`<h2>${window.IsleArt.icon("key")} Gemini 金鑰</h2>
      <p>島上的人要用你自己的 Gemini 金鑰才能說話。到 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> 用自己的帳號登入申請。</p>
      <div class="box"><b>守金鑰三件事</b>
        <ol style="margin:6px 0 0;padding-left:20px;line-height:1.7">
          <li>金鑰只存在這台電腦的瀏覽器，不會寫進任何檔案，也不要寫進你的程式或放上 GitHub</li>
          <li>不要開付費。萬一外流，最多就是免費額度被用完</li>
          <li>只貼在自己的島上，不要貼進別人做的網站</li>
        </ol></div>
      <div class="field"><label for="m-key">${has ? "已經存了一把金鑰。要換的話貼上新的" : "貼上金鑰"}</label><input type="password" id="m-key" autocomplete="off"></div>
      <div class="btns"><button class="btn primary" id="m-keysave">存好</button>${has ? `<button class="btn" id="m-keyclear">清掉金鑰</button>` : ""}<button class="btn" data-close>關閉</button></div>`, m => {
      m.querySelector("#m-keysave").addEventListener("click", () => {
        const v = m.querySelector("#m-key").value.trim();
        if (!v) return toast("沒有貼東西");
        AI.setKey(v); closeModal(); renderPanel(); toast("金鑰存在這台電腦的瀏覽器了");
      });
      const clr = m.querySelector("#m-keyclear");
      if (clr) clr.addEventListener("click", () => { AI.setKey(""); closeModal(); renderPanel(); toast("金鑰清掉了"); });
    });
  }

  function bagModal() {
    modal(`<h2>${window.IsleArt.icon("bag")} 背包</h2><p class="note">每座島過關拿到一樣交接物。交出去的東西還留在背包，背包就是你五步走到哪的樣子。</p>
      <div class="bag">${ISLES.map(i => {
        const got = S.isles[i.id].passed;
        return `<div class="slot${got ? "" : " empty"}"><span class="ico">${window.IsleArt.item(i.item)}</span>${esc(i.item.name)}${got ? `<details><summary class="note">打開看看</summary><div class="answer" style="text-align:left">${esc(answersText(i))}</div></details>` : ""}</div>`;
      }).join("")}</div>
      <div class="btns"><button class="btn" data-close>關閉</button></div>`);
  }

  function code() {
    const copy = JSON.parse(JSON.stringify(S)); copy.current = null;
    return btoa(unescape(encodeURIComponent(JSON.stringify(copy))));
  }
  function loadCode(txt) {
    try {
      const obj = JSON.parse(decodeURIComponent(escape(atob((txt || "").trim()))));
      if (!obj || obj.v !== 1) throw 0;
      S = Object.assign(fresh(), obj); closeModal(); closePanel(); refresh(); toast("接上了，歡迎回來");
    } catch (e) { toast("這串接關碼讀不懂，確認有沒有完整複製"); }
  }

  function settingsModal() {
    modal(`<h2>${window.IsleArt.icon("settings")} 設定</h2>
      <label class="check"><input type="checkbox" id="m-calm" ${S.calm ? "checked" : ""}><span>減少動態（停掉動畫，容易暈的人用）</span></label>
      <div class="box"><b>接關碼</b><p class="note">換電腦或手機時，把這一串貼到新電腦的開始畫面，就能接著玩。裡面沒有金鑰。</p>
        <textarea id="m-mycode" rows="3" readonly>${esc(code())}</textarea>
        <div class="btns"><button class="btn" id="m-copy">複製</button></div></div>
      <div class="box"><b>重新開始</b><p class="note">清掉這台電腦上的進度（金鑰不會清）。</p>
        <div class="btns"><button class="btn" id="m-reset">重新開始</button></div><div id="m-reset2"></div></div>
      <div class="btns"><button class="btn" data-close>關閉</button></div>`, m => {
      m.querySelector("#m-calm").addEventListener("change", e => { S.calm = e.target.checked; refresh(); });
      m.querySelector("#m-copy").addEventListener("click", () => {
        const t = m.querySelector("#m-mycode"); t.select();
        (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(() => toast("複製好了"), () => toast("請自己選取複製"));
      });
      m.querySelector("#m-reset").addEventListener("click", () => {
        m.querySelector("#m-reset2").innerHTML = `<p class="flag">真的要清掉嗎？寫過的都會不見。</p><button class="btn primary" id="m-reset-yes">確定清掉</button>`;
        m.querySelector("#m-reset-yes").addEventListener("click", () => { S = fresh(); save(); closeModal(); closePanel(); refresh(); startModal(); });
      });
    });
  }

  /* ---------- 印報告 ---------- */
  function printReport() {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const p = (t) => `<p>${esc(t || "（沒寫）")}</p>`;
    let h = `<h1>${esc(C.reportTitle)}</h1><div class="meta">冒險者代號：${esc(S.name)}　｜　${date}　｜　${esc(missionLine())}</div>`;
    if ((S.stuck || "").trim()) h += `<h2>卡在哪、為什麼</h2><div class="pre">${esc(S.stuck)}</div>`;
    h += `<h2>${esc(C.chapter0)}</h2><div class="pre">${esc(S.report)}</div>`;
    ISLES.forEach(isle => {
      const st = S.isles[isle.id], a = st.answers;
      const flag = st.mode === "flagged" ? `<span class="flag">（這一步還可以再想）</span>` : st.mode === "self" ? `（自我檢查過關）` : "";
      h += `<h2>${esc(isle.chapter)} ${flag}</h2>`;
      if (isle.id === "ask") {
        h += `<table><tr><th>主管原本以為的</th><th>問到的</th></tr><tr><td>${esc(a.assumed)}</td><td>${esc(["經過：" + (a.story || ""), "變通辦法：" + (a.workaround || ""), "沒說出口的擔心：" + (a.worry || "")].join("\n\n"))}</td></tr></table>`;
        h += `<h3>跟原本以為的不一樣的地方</h3>${p(a.diff)}`;
      } else {
        isle.fields.forEach(f => { h += `<h3>${esc(f.label)}</h3>${p(a[f.id])}`; });
      }
    });
    C.center.fields.forEach(f => {
      const [title, sub] = f.label.split("：");
      h += `<h2>${esc(title.replace("第六章　", "六、").replace("第七章　", "七、"))}</h2><h3>${esc(sub || "")}</h3>${p(S.center.answers[f.id])}`;
    });
    $("#print-area").innerHTML = h;
    window.print();
  }

  /* ---------- 開始 ---------- */
  $("#panel-close").addEventListener("click", closePanel);
  $("#btn-report").addEventListener("click", reportModal);
  $("#btn-bag").addEventListener("click", bagModal);
  $("#btn-overview").addEventListener("click", () => { closePanel(); if (world3d) window.IsleWorld.focus(null); });
  $("#btn-follow").addEventListener("click", () => { if (world3d) window.IsleWorld.followPlayer(); });
  document.querySelectorAll("#mood [data-mood]").forEach(b => b.addEventListener("click", () => { S.mood = b.dataset.mood; refresh(); }));
  $("#btn-key").addEventListener("click", keyModal);
  $("#btn-settings").addEventListener("click", settingsModal);
  $("#modal-back").addEventListener("click", e => { if (e.target.id === "modal-back" && S.name) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#modal-back").hidden && S.name) closeModal(); else closePanel(); } });

  initWorld();
  refresh();
  if (!S.name) startModal();
})();
