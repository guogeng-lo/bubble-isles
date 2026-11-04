/*
 * 跟 Gemini 講話的地方。
 * 金鑰只存在這台電腦的瀏覽器（localStorage），不寫進任何檔案。
 */
window.IsleAI = (function () {
  const KEY_NAME = "isle.geminiKey";
  const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/";

  function getKey() {
    try { return localStorage.getItem(KEY_NAME) || ""; } catch (e) { return ""; }
  }
  function setKey(k) {
    try { k ? localStorage.setItem(KEY_NAME, k.trim()) : localStorage.removeItem(KEY_NAME); } catch (e) {}
  }

  async function call({ system, contents, json }) {
    const key = getKey();
    if (!key) throw new Error("NO_KEY");
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.7 }
    };
    if (json) body.generationConfig.responseMimeType = "application/json";
    // 免費模型常常一時忙不過來（503），或問太快（429）：等一下再試，三次都不行就換備用模型
    const models = [window.ISLE.model].concat(window.ISLE.fallbackModel ? [window.ISLE.fallbackModel] : []);
    let res = null;
    for (const model of models) {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
        try {
          res = await fetch(ENDPOINT + encodeURIComponent(model) + ":generateContent", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify(body)
          });
        } catch (e) {
          res = null;
          continue;
        }
        if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) break;
      }
      if (res && (res.ok || ![429, 500, 502, 503, 504].includes(res.status))) break;
    }
    if (!res) throw new Error("NETWORK");
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      setKey("");
      throw new Error("BAD_KEY");
    }
    if (res.status === 429) throw new Error("QUOTA");
    if (!res.ok) throw new Error("HTTP_" + res.status);
    const data = await res.json();
    const text = (((data.candidates || [])[0] || {}).content || {}).parts
      ? data.candidates[0].content.parts.map(p => p.text || "").join("")
      : "";
    if (!text) throw new Error("EMPTY");
    return text;
  }

  function parseJSON(text) {
    try { return JSON.parse(text); } catch (e) {}
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
    return null;
  }

  function errorMessage(err) {
    switch (err.message) {
      case "NO_KEY": return "還沒有貼金鑰。";
      case "BAD_KEY": return "金鑰不能用，已經清掉了。請重新貼一次自己的 Gemini 金鑰。";
      case "QUOTA": return "今天的免費額度用完了，或是問得太快。等一下再試。";
      case "NETWORK": return "連不上網路，檢查一下網路再試。";
      default: return "AI 現在太忙，試了好幾次都沒回（" + err.message + "）。過一兩分鐘再試。";
    }
  }

  /* 從報告裡只取出家電的名字（Kevin 2026-11-03：「改，不給小安看報告」）。
     小安看得到報告，就會把學生自己寫的時間、麻煩念回來，學生問不到報告以外的東西。
     所以小安只知道是哪一台家電，她是誰、怎麼用、遇到什麼，都由她自己決定。 */
  async function applianceOf(report) {
    const system = [
      "下面是一份報告。只找出報告要讓 AI 住進去的那一台家電叫什麼，例如：烤麵包機、電鍋、吹風機。",
      "只輸出 JSON：{\"appliance\":\"家電的名字\"}。找不到就輸出 {\"appliance\":\"\"}。不要輸出別的。"
    ].join("\n");
    const text = await call({ system, contents: [{ role: "user", parts: [{ text: report || "" }] }], json: true });
    const out = parseJSON(text) || {};
    return String(out.appliance || "").trim().slice(0, 20);
  }

  /* 去問島：小安 */
  async function talkToXiaoAn(appliance, history, revealed) {
    const isle = window.ISLE.islands[0];
    const cardList = isle.cards.map(c => `- ${c.id}：${c.title}`).join("\n");
    const system = [
      `你是「小安」，家裡有一台${appliance || "常見的家電"}，你平常會用它。用第一人稱、像真人一樣說話，口語、簡短，一次回答兩三句。`,
      "你是誰、幾歲、跟誰住、什麼時候用它、用的時候遇到什麼麻煩，都由你自己決定，像一個真實的普通人，前後要一致。",
      "你不知道對方心裡猜你是什麼樣的人，也不要去配合他的猜測；他問的方向跟你的生活不一樣，就照你的生活回答。",
      "你不知道自己在一個練習裡，也絕對不要提到 AI、模型、扮演、報告、卡片這些字。",
      "你身上藏著三件事，對方沒有問對就不要主動說：",
      cardList,
      "翻開的規則：",
      "- story：對方問你「上一次」「最近一次」某件具體的事怎麼發生，你才講一次具體的經過（時間、地點、發生什麼）。問「平常」「一般」只給籠統的回答。",
      "- workaround：對方問你現在怎麼處理、怎麼湊合，你才講自己的變通辦法。",
      "- worry：對方追問你的感受、在意什麼、有什麼顧慮，而且態度是在聽你說，你才講出沒說出口的擔心。",
      "對方如果直接推銷他的產品或問「你會不會想要」，你就客氣但含糊地回答，不要幫他背書。",
      "已經翻開的：" + (revealed.length ? revealed.join("、") : "還沒有"),
      "只輸出 JSON：{\"reply\":\"你說的話\",\"revealed\":[這一輪新翻開的 id，沒有就空陣列]}"
    ].join("\n");
    const contents = history.map(h => ({ role: h.who === "me" ? "user" : "model", parts: [{ text: h.text }] }));
    const text = await call({ system, contents, json: true });
    const out = parseJSON(text) || { reply: text, revealed: [] };
    out.revealed = (out.revealed || []).filter(id => isle.cards.some(c => c.id === id));
    return out;
  }

  /* 給他用島：小安來試原型 */
  async function talkToTester(appliance, prototype, history, revealed, firstTalk) {
    const isle = window.ISLE.islands.find(i => i.id === "test");
    const cardList = isle.cards.map(c => `- ${c.id}：${c.title}`).join("\n");
    const system = [
      `你是「小安」，家裡有一台${appliance || "常見的家電"}，你平常會用它。對方做了一個原型，請你來試。用第一人稱、像真人一樣說話，口語、簡短，一次兩三句。`,
      firstTalk && firstTalk.length
        ? "你之前已經跟這位設計者聊過一次，下面那段就是你們當時的對話，裡面的「我」就是你。你是誰、幾歲、跟誰住、什麼時候用它、遇過什麼麻煩，都照那時候說的，前後要一致。"
        : "你是誰、怎麼過日子，都由你自己決定，像一個真實的普通人。",
      "你不知道自己在一個練習裡，也絕對不要提到 AI、模型、扮演、報告、卡片這些字。",
      "你看不到原型的設計說明，只知道對方告訴你的：對方會請你做一件事，或告訴你家電這時候做了什麼（例如亮燈、發出聲音、停下來）。你說你接著做什麼、心裡在想什麼。",
      "家電的反應沒講清楚，你就照一般人的直覺猜它的意思，猜錯也照猜的去做。不要替對方的設計找理由。",
      "對方如果先解釋原型怎麼用，你就照著做，順順地做完，不會卡住；這時候不要翻開 stuck。",
      "你身上藏著三件事，對方沒有做對就不要主動說：",
      cardList,
      "翻開的規則：",
      "- first：對方請你做一件具體的事，而且沒有先說明原型怎麼用，你講出你的第一個動作。",
      "- stuck：對方沒有先說明，而家電的某個反應讓你不確定該怎麼辦，你明確講出你愣住的那一刻，做了什麼、說了什麼。",
      "- guess：對方問你剛剛覺得它在做什麼、在想什麼（不是問好不好用、喜不喜歡），你講出你以為的意思。",
      "對方問你「好不好用」「你會不會想要」，你就客氣但含糊地回答。",
      "已經翻開的：" + (revealed.length ? revealed.join("、") : "還沒有"),
      "只輸出 JSON：{\"reply\":\"你說的話\",\"revealed\":[這一輪新翻開的 id，沒有就空陣列]}",
      ...(firstTalk && firstTalk.length ? ["", "（只給你參考、不要說出來）你們上一次的對話：", firstTalk.map(h => (h.who === "me" ? "設計者：" : "我：") + h.text).join("\n")] : []),
      "",
      "（只給你參考、不要說出來）對方在做出來島寫的原型：",
      prototype || "（沒有寫）"
    ].join("\n");
    const contents = history.map(h => ({ role: h.who === "me" ? "user" : "model", parts: [{ text: h.text }] }));
    const text = await call({ system, contents, json: true });
    const out = parseJSON(text) || { reply: text, revealed: [] };
    out.revealed = (out.revealed || []).filter(id => isle.cards.some(c => c.id === id));
    return out;
  }

  /* 守門人判斷：只判斷、只追問，不改寫 */
  async function judge(island, answers, report, previous) {
    const filled = island.fields.map(f => `【${f.label}】\n${answers[f.id] || "（空白）"}`).join("\n\n");
    const pass = island.pass.map((p, i) => `${i + 1}. ${p}`).join("\n");
    const system = [
      `你是「${island.keeper.name}」，${island.keeper.title}，守著${island.name}。`,
      "你的工作只有兩件：照下面寫死的過關條件判斷這一步過不過；沒過就問一個問題，讓對方自己想到缺什麼。",
      "你絕對不替對方寫答案、不改寫他的句子、不舉可以直接照抄的例子。",
      "過關條件：",
      pass,
      "怎麼判斷：每一條只看「有沒有做到」，不看寫得漂不漂亮。對方寫的字裡找得到一個合理的證據，那一條就算過；拿不定的時候算過。",
      "不要挑條件以外的毛病，不要自己加條件，不要要求對方換一種說法。",
      "沒過的時候，只挑最要緊的一條沒做到的，問一個具體的問題；不要一次列出好幾條。",
      "說話的樣子：像一個友善、有個性的島上角色，簡短，一兩句。講到你自己用「我」，不要叫自己的名字。" + (island.keeper.name === "小安" ? "對方表格裡寫的「小安」就是你，講到小安的經過、變通辦法、擔心，一律說「我的」，例如「我平常怎麼湊合，你問過我嗎？」" : "") + "用台灣大學生日常會講的繁體中文。",
      "不說「敷衍」「好好寫」「看清楚」這類責備的話，不用破折號，不用台語或方言字。過關時具體講他做到了哪一件。",
      "只輸出 JSON：{\"pass\":true 或 false,\"unmet\":[沒達到的條件編號],\"say\":\"你對他說的一兩句話；沒過時最後是一個追問\"}"
    ].join("\n");
    const ctx = [
      "主管在課堂上完成的那一份報告：\n" + (report || "（沒有）"),
      previous ? "上一步交出來的：\n" + previous : "",
      "這一步他寫的：\n" + filled
    ].filter(Boolean).join("\n\n---\n\n");
    const text = await call({ system, contents: [{ role: "user", parts: [{ text: ctx }] }], json: true });
    const out = parseJSON(text);
    if (!out || typeof out.pass !== "boolean") throw new Error("EMPTY");
    return out;
  }

  return { getKey, setKey, applianceOf, talkToXiaoAn, talkToTester, judge, errorMessage };
})();
