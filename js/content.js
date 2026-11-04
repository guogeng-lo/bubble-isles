/*
 * 五步島的所有內容都在這一個檔案。
 * 要改島名、角色、怪獸、欄位、過關條件，只改這裡，不用動 app.js。
 * 內容出自 I3840 115-1 W7 課程設計（五步流程、守門人、交接物、設計開發報告八章）。
 */
window.ISLE = {
  worldName: "泡泡漂流島",
  opening: "一場從洗衣服開始的設計冒險：去問、說清楚、想辦法、做出來、給他用，再回頭修改。",
  missionTitle: "這一趟的任務：把你在課堂上選的這台家電設計出來",
  // 免費額度（2026-10-29 Kevin 帳號 AI Studio 額度頁）：3.6 Flash 每天 20 次、每分鐘 5 次，走不完一輪；
  // 3.5 Flash Lite 每天 500 次、每分鐘 15 次。額度是每個專案算，學生各用自己的金鑰
  model: "gemini-3.5-flash-lite",
  fallbackModel: "",

  // 主角的樣子：身體、帽子、背包的顏色（畫成低多邊形小人）
  players: [
    { id: "forest", name: "森林嚮導", desc: "尖帽＋背包", body: 0x3f7f5f, hat: "cone", hatColor: 0xd9822b, pack: 0x7a5236, emoji: "🧭" },
    { id: "sunset", name: "夕陽工匠", desc: "圓帽＋工具袋", body: 0xc0563a, hat: "dome", hatColor: 0x34444c, pack: 0x5d4330, emoji: "🔧" },
    { id: "deep", name: "深海水手", desc: "水手帽", body: 0x3f6f9f, hat: "cap", hatColor: 0xf3eee2, emoji: "⚓" },
    { id: "night", name: "星夜旅人", desc: "尖帽＋斗篷", body: 0x6b5aa6, hat: "cone", hatColor: 0x2d2a4a, pack: 0x9b8bd6, emoji: "✨" }
  ],

  levels: ["見習旅人", "提問者", "觀察家", "原型師", "說服者", "島嶼嚮導", "群島大師"],

  islands: [
    {
      id: "ask",
      accent: "#d2694a",
      monsterColor: 0x8a63c9,
      keeperStyle: { kind: "an", body: 0xf6f3fb, hat: "dome", hatColor: 0x7f9db3 },
      no: 1,
      name: "去問島",
      color: "#f2b866",
      chapter: "一、使用者與處境",
      doing: "弄清楚用你這台家電的人是誰、那個人遇到什麼困難。不是猜，是去問。",
      keeper: { name: "小安", title: "你這台家電的使用者", face: "👧" },
      monster: { name: "想當然怪", face: "👻", habit: "把「我覺得」當成使用者的心聲" },
      item: { icon: "📝", name: "訪談紀錄" },
      cards: [
        { id: "story", title: "一次具體的經歷" },
        { id: "workaround", title: "自己的變通辦法" },
        { id: "worry", title: "沒說出口的擔心" }
      ],
      fields: [
        { id: "assumed", label: "主管原本以為的", help: "從你身為主管在課堂上完成的那一份報告，把「我想清楚的判斷，還沒問過人」那一段複製貼過來", rows: 3 },
        { id: "story", label: "我問到的：小安那一次的經過", help: "哪一天、在哪裡、發生什麼事，越具體越好", rows: 4 },
        { id: "workaround", label: "我問到的：小安自己的變通辦法", help: "小安現在怎麼湊合著解決", rows: 3 },
        { id: "worry", label: "我問到的：小安沒說出口的擔心", help: "", rows: 3 },
        { id: "diff", label: "跟主管原本以為的不一樣的地方", help: "至少一處", rows: 3 }
      ],
      pass: [
        "寫出小安一次具體的經歷（有時間、地點或一件真的發生的事，不是「平常都會」）",
        "寫出小安自己的變通辦法",
        "至少一處明確寫出跟主管原本以為的不一樣"
      ]
    },
    {
      id: "define",
      accent: "#c94a44",
      monsterColor: 0x9aa7b0,
      keeperStyle: { body: 0x34495e, hat: "cap", hatColor: 0xd6b97c, tool: 0xffffff },
      no: 2,
      name: "說清楚島",
      color: "#8fd0c6",
      chapter: "二、問題定義",
      doing: "把困難寫成一句話：誰，需要什麼，因為什麼。",
      keeper: { name: "阿追", title: "一句話編輯", face: "🧐" },
      monster: { name: "模糊怪", face: "🌫️", habit: "每句話都說不清楚" },
      item: { icon: "🎯", name: "那一句問題" },
      fields: [
        { id: "sentence", label: "一句話：誰，需要什麼，因為什麼", help: "例如：趕著出門的上班族，需要＿＿，因為＿＿", rows: 3 },
        { id: "source", label: "這個「因為」來自去問島的哪一句", help: "把訪談紀錄裡那一句抄過來", rows: 2 }
      ],
      pass: [
        "有一個具體的人（不是「大家」「使用者」）",
        "有那個人需要的事（寫的是那個人需要的狀態，不是一個功能或產品）",
        "原因來自去問島問到的內容，不是主管自己想的"
      ]
    },
    {
      id: "ideate",
      accent: "#7a5fb5",
      monsterColor: 0x3f9a63,
      keeperStyle: { body: 0xf7f1e6, legs: 0x34495e, hat: "dome", hatColor: 0x5f7489, pack: 0xef8577 },
      no: 3,
      name: "想辦法島",
      color: "#b9a3e3",
      chapter: "三、方案與取捨",
      doing: "先提很多方案，再挑一個。",
      keeper: { name: "匠叔", title: "工匠", face: "🧔" },
      monster: { name: "單線怪", face: "🐍", habit: "眼裡只有第一個方案" },
      item: { icon: "🗺️", name: "方案草圖" },
      fields: [
        { id: "options", label: "想過的方案（至少三個，一行一個）", help: "要真的不一樣，不是同一個方案換顏色", rows: 5 },
        { id: "chosen", label: "選了哪一個、為什麼", help: "理由要對回說清楚島那一句問題", rows: 3 },
        { id: "dropped", label: "丟掉的為什麼丟", help: "", rows: 3 }
      ],
      pass: [
        "至少三個真的不一樣的方案",
        "選擇的理由對回那一句問題",
        "寫出丟掉其他方案的原因"
      ]
    },
    {
      id: "build",
      accent: "#b8643f",
      monsterColor: 0x3a4a5a,
      keeperStyle: { body: 0xf7f1e6, legs: 0x34495e, hat: "dome", hatColor: 0x5f7489, pack: 0xef8577 },
      no: 4,
      name: "做出來島",
      color: "#f39c8f",
      chapter: "四、原型與 AI 的設計",
      doing: "說清楚你的原型：家電維持原本的樣子，只是裡面多了 AI。它怎麼讓人知道它在想什麼，猜錯了怎麼辦。",
      keeper: { name: "匠叔", title: "工匠", face: "🧔" },
      monster: { name: "螢幕怪", face: "📺", habit: "以為畫面就是全部" },
      item: { icon: "🧩", name: "原型" },
      fields: [
        { id: "how", label: "原型長什麼樣子", help: "這一輪不用真的做出來：說清楚家電原本的樣子，以及 AI 住進去之後多了什麼。想畫草圖或拍照也可以", rows: 3 },
        { id: "signal", label: "它怎麼讓人知道它在想什麼", help: "用這台家電原本就有的方式，例如按鈕、聲音、燈、震動、原本的面板，不讓它變成不是原來的樣子", rows: 3 },
        { id: "correct", label: "使用者怎麼糾正它", help: "", rows: 2 },
        { id: "wrong", label: "它猜錯的時候怎麼辦", help: "", rows: 2 }
      ],
      pass: [
        "家電維持原本的樣子，沒有為了 AI 變成不是原來的樣子（原本沒有的螢幕不加，原本就有的面板可以用）",
        "AI 用家電原本就有的方式回應使用者",
        "寫出使用者怎麼糾正它，以及它猜錯時怎麼辦"
      ]
    },
    {
      id: "test",
      accent: "#3f7fb8",
      monsterColor: 0xd9b44a,
      keeperStyle: { body: 0x5aaed0, hat: "cap", hatColor: 0xef8577, tool: 0xf7f1e6 },
      no: 5,
      name: "給他用島",
      color: "#9cc7f0",
      chapter: "五、測試與發現",
      doing: "把原型交給小安試，不說明怎麼用，看小安卡在哪一刻。",
      keeper: { name: "阿看", title: "測試觀察員", face: "🕵️" },
      monster: { name: "說明書怪", face: "📜", habit: "別人一卡住就想塞說明書" },
      item: { icon: "🔍", name: "測試紀錄" },
      partner: { name: "小安", title: "來試你原型的人", face: "👧" },
      chatHint: "請小安做一件事，或說家電這時候做了什麼",
      cards: [
        { id: "first", title: "第一個動作" },
        { id: "stuck", title: "卡住的那一刻" },
        { id: "guess", title: "小安以為它在做什麼" }
      ],
      fields: [
        { id: "who", label: "你請小安做什麼", help: "一件小安平常會用這台家電做的事，例如煮一次飯。不先說明原型怎麼用", rows: 3 },
        { id: "stuck", label: "小安卡在哪一刻", help: "那一刻家電做了什麼、小安做了什麼、說了什麼", rows: 3 },
        { id: "gap", label: "跟原本以為的差在哪", help: "", rows: 3 }
      ],
      pass: [
        "請小安做的是一件具體的事，而且沒有先說明原型怎麼用",
        "寫出小安卡住的那一刻",
        "寫出結果跟原本以為的落差"
      ]
    }
  ],

  center: {
    name: "回頭修改島",
    accent: "#3f6d7a",
    keeperStyle: { body: 0x34495e, hat: "cone", hatColor: 0xd6b97c },
    keeper: { name: "鐘塔", title: "回頭修改的守塔人", face: "🗼" },
    doing: "五座島都過了，回來看自己寫的哪裡要改，再出發一圈。",
    fields: [
      { id: "revise", label: "第六章　回頭修改：改了哪一章、為什麼", help: "", rows: 4 },
      { id: "meaning", label: "第七章　這代表什麼：這一輪代表什麼", help: "", rows: 4 }
    ]
  },

  reportTitle: "設計開發報告",
  chapter0: "〇、主管的決定"
};
