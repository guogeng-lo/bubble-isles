/* 本機向量圖示：只繪製介面，不讀寫進度或呼叫網路。 */
window.IsleArt = (function () {
  const ink = "#34495e", white = "#f7f1e6", gold = "#d6b97c", coral = "#ef8577", blue = "#8fd3ea", skin = "#f3cfb0";
  const poly = (p,c) => `<polygon points="${p}" fill="${c}"/>`;
  const rect = (x,y,w,h,c,r=0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c}"/>`;
  const circle = (x,y,r,c) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`;
  const line = d => `<path d="${d}" fill="none"/>`;
  const wrap = (name,body) => `<svg class="art-icon" data-art="${name}" viewBox="0 0 64 64" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  const eyes = (y=31) => circle(26,y,1.5,ink)+circle(39,y,1.5,ink)+line(`M30 ${y+7}q3 2 6 0`);
  const head = () => poly("19,22 26,17 40,17 47,24 44,38 36,44 27,43 20,36",skin);
  const shirt = color => poly("13,62 16,48 26,42 38,42 49,48 53,62",color);
  const portraits = {
    an: () => poly("17,25 19,15 44,15 48,28 46,46 18,46","#caa98a")+shirt(white)+head()+
      poly("17,24 16,13 21,5 28,12 39,12 45,5 49,14 48,24","#7f9db3")+rect(17,20,31,6,"#6d8aa1",2)+
      poly("20,27 22,24 31,26 27,30","#caa98a")+poly("44,27 40,24 34,26 39,30","#caa98a")+
      poly("20,34 16,39 18,44 16,49 21,53 24,47 22,42 24,38","#caa98a")+
      poly("44,34 48,39 46,44 48,49 43,53 40,47 42,42 40,38","#caa98a")+
      eyes(32)+circle(24,36,2,coral)+circle(41,36,2,coral)+line("M30 48v7m7-7v7")+
      rect(23,53,19,9,blue,1)+line("M27 56v4m5-4v4m5-4v4"),
    editor: () => shirt(ink)+head()+eyes()+poly("16,23 19,12 27,9 42,11 47,21",gold)+rect(17,19,33,6,ink,2)+
      `<circle cx="39" cy="31" r="6" stroke="${gold}" stroke-width="3"/>`+line("M45 34l4 10")+circle(49,46,1.5,gold)+poly("20,48 27,44 32,53 23,58",blue),
    maker: () => shirt(white)+head()+eyes(30)+poly("21,34 26,36 32,34 38,36 44,34 42,44 33,49 23,44",ink)+
      poly("16,22 18,15 25,9 40,9 47,16 48,23","#5f7489")+rect(15,20,35,6,ink,2)+
      poly("19,48 24,45 29,62 24,62",coral)+line("M43 49v10m-4-4h8")+rect(37,52,13,9,gold,2),
    observer: () => shirt("#5aaed0")+head()+eyes()+poly("16,23 18,14 26,10 42,11 47,21",coral)+rect(17,20,34,5,coral,1)+
      rect(33,43,23,19,ink,2)+rect(36,47,17,13,white,1)+rect(40,41,10,6,gold,1)+line("M39 51h9m-9 5h6"),
    core: () => circle(32,33,25,ink)+circle(32,33,21,gold)+circle(32,33,17,white)+
      line("M32 13v4m-14 2 3 3m-10 11h5m34 0h4m-9-14-3 3")+poly("30,19 34,19 35,29 29,29",coral)+
      circle(26,35,2,ink)+circle(38,35,2,ink)+line("M27 43q5 4 10 0")
  };
  const faceInk='#496273';
  const beastFaces={
    ask:[['ellipse',32,19,8.6,10,'#f4efe1'],['ellipse',33,20,3.5,4.8,faceInk],['path','M24 5Q32 2 40 5',faceInk,1.7],['path','M27 37Q33 39 39 35',faceInk,1.8]],
    define:[['path','M14 23Q19 19 24 23M40 23Q45 19 50 23',faceInk,1.9],['ellipse',32,35,1.7,2.2,faceInk]],
    ideate:[['ellipse',20,18,2.6,3.4,faceInk],['ellipse',44,18,2.6,3.4,faceInk],['path','M26 32Q34 36 42 31',faceInk,1.8]],
    build:[['rect',18,15,4.5,8,2.2,faceInk],['rect',42,15,4.5,8,2.2,faceInk],['path','M27 33H37',faceInk,1.8]],
    test:[['ellipse',22,24,2.5,3.3,faceInk],['ellipse',42,24,2.5,3.3,faceInk],['path','M18 14Q22 12 26 14M38 14Q42 12 46 14','#9a896a',1.5],['path','M27 36Q32 32 37 36',faceInk,1.7]]
  };
  function beastFaceSVG(id,transform){
    return `<g transform="${transform}">${(beastFaces[id]||beastFaces.ask).map(c=>c[0]==='ellipse'?`<ellipse cx="${c[1]}" cy="${c[2]}" rx="${c[3]}" ry="${c[4]}" fill="${c[5]}"/>`:c[0]==='rect'?`<rect x="${c[1]}" y="${c[2]}" width="${c[3]}" height="${c[4]}" rx="${c[5]}" fill="${c[6]}"/>`:`<path d="${c[1]}" stroke="${c[2]}" stroke-width="${c[3]}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`).join('')}</g>`;
  }
  function paintMonsterFace(ctx,id){
    ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.save();ctx.scale(ctx.canvas.width/64,ctx.canvas.height/48);ctx.lineCap=ctx.lineJoin='round';
    for(const c of beastFaces[id]||beastFaces.ask){ctx.beginPath();if(c[0]==='ellipse'){ctx.ellipse(c[1],c[2],c[3],c[4],0,0,Math.PI*2);ctx.fillStyle=c[5];ctx.fill();}else if(c[0]==='rect'){const [_,x,y,w,h,r,col]=c;ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.fillStyle=col;ctx.fill();}else{ctx.strokeStyle=c[2];ctx.lineWidth=c[3];ctx.stroke(new Path2D(c[1]));}}ctx.restore();
  }
  let beastSerial=0;
  const beastDefs=(p,a,b)=>`<defs><linearGradient id="${p}-body" x1="0" y1="0" x2=".65" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;
  const monsters={
    ask:p=>beastDefs(p,'#b59bcd','#947db4')+`<ellipse cx="48" cy="86" rx="24" ry="3" fill="#776594" opacity=".10"/><path d="M26 34C23 26 24 18 29 15L40 27Q48 24 58 27L69 17C75 21 75 28 72 36C80 49 80 65 72 76C64 87 32 87 24 76C16 64 18 46 26 34Z" fill="url(#${p}-body)"/><ellipse cx="23" cy="64" rx="6" ry="4.5" fill="#a88dc4"/><ellipse cx="74" cy="64" rx="6" ry="4.5" fill="#a088bc"/><ellipse cx="36" cy="82" rx="8" ry="4" fill="#9078ab"/><ellipse cx="61" cy="82" rx="8" ry="4" fill="#9078ab"/>`+beastFaceSVG('ask','translate(22.4 27) scale(.8)'),
    define:p=>beastDefs(p,'#d9e4e3','#aec5ca')+`<ellipse cx="29" cy="72" rx="7" ry="4" fill="#bdd2d5"/><ellipse cx="64" cy="76" rx="5" ry="3" fill="#bdd2d5"/><path d="M23 67C9 67 7 47 20 41C18 27 32 21 41 28C45 12 68 14 71 33C88 31 94 52 80 63C69 73 37 74 23 67Z" fill="url(#${p}-body)"/>`+beastFaceSVG('define','translate(19.8 29) scale(.88)'),
    ideate:p=>beastDefs(p,'#9abd9d','#6e9e84')+`<ellipse cx="49" cy="76" rx="27" ry="11" fill="#739d83"/><path d="M23 74C41 84 72 79 73 70C74 62 57 59 42 63C29 64 27 51 33 42C38 33 45 29 53 29" stroke="url(#${p}-body)" stroke-width="16" stroke-linecap="round" fill="none"/><path d="M26 76C42 82 67 77 67 70C66 66 54 66 44 68" stroke="#b5c4a2" stroke-width="4" stroke-linecap="round" fill="none"/><ellipse cx="60" cy="29" rx="21" ry="15" fill="url(#${p}-body)"/>`+beastFaceSVG('ideate','translate(40 16) scale(.62)'),
    build:p=>beastDefs(p,'#6b8597','#4a667d')+`<ellipse cx="48" cy="86" rx="27" ry="3" fill="#34495e" opacity=".10"/><path d="M34 29L28 17M62 29L69 16" stroke="#c9b17c" stroke-width="3" stroke-linecap="round"/><circle cx="27" cy="16" r="3.4" fill="#d69d88"/><circle cx="70" cy="15" r="3.4" fill="#d69d88"/><rect x="28" y="69" width="12" height="13" rx="4" fill="#d69d88"/><rect x="56" y="69" width="12" height="13" rx="4" fill="#d69d88"/><rect x="16" y="26" width="65" height="49" rx="12" fill="url(#${p}-body)"/><rect x="23" y="33" width="51" height="33" rx="7" fill="#a8cfd0"/><circle cx="75" cy="68" r="2" fill="#c9b17c"/>`+beastFaceSVG('build','translate(25 34) scale(.75)'),
    test:p=>beastDefs(p,'#f7f0df','#e8dfc8')+`<ellipse cx="48" cy="87" rx="26" ry="3" fill="#9a8867" opacity=".09"/><path d="M27 25Q23 47 28 74H71Q66 50 72 25Z" fill="url(#${p}-body)"/><path d="M28 30Q27 48 30 67" stroke="#fffaea" stroke-width="2" fill="none"/><rect x="18" y="17" width="61" height="15" rx="7.5" fill="#c9b17c"/><rect x="18" y="71" width="61" height="15" rx="7.5" fill="#c9b17c"/><ellipse cx="24" cy="24.5" rx="5" ry="5.4" fill="#e8dbb6"/><ellipse cx="24" cy="78.5" rx="5" ry="5.4" fill="#e8dbb6"/><path d="M23 22Q27 24 23 27M23 76Q27 79 23 81" stroke="#aa9469" stroke-width="1.3" fill="none" stroke-linecap="round"/>`+beastFaceSVG('test','translate(24 32) scale(.8)')
  };
  const items = {
    interview: () => rect(14,8,38,49,white,3)+rect(14,8,7,49,coral,2)+line("M27 21h17m-17 9h17m-17 9h11")+circle(43,49,5,gold),
    problem: () => `<path d="M9 12h46v31H33L22 54V43H9Z" fill="${white}"/>`+circle(32,27,11,blue)+circle(32,27,5,coral)+line("M32 12v5m0 20v5m-15-15h5m20 0h5"),
    plan: () => rect(10,9,44,46,blue,2)+poly("16,42 26,25 36,42",white)+rect(39,20,9,12,gold,1)+circle(43,43,5,coral)+line("M16 16h22m-22 33h16"),
    prototype: () => poly("14,16 25,8 52,13 43,22",gold)+poly("14,16 43,22 43,57 14,51",white)+poly("43,22 52,13 52,49 43,57","#bfd7dd")+rect(19,23,19,8,ink,1)+circle(24,27,2,coral)+line("M30 27h4M19 38h19m-19 6h19")+rect(22,11,14,4,white,1),
    observation: () => rect(14,10,34,43,white,2)+rect(24,7,14,8,gold,2)+line("M21 23h17m-17 8h11")+`<circle cx="43" cy="42" r="10" fill="${blue}"/>`+line("M50 50l8 8M39 42l3 3 5-6")
  };
  const symbols = {
    bag: () => rect(13,17,38,40,ink,7)+`<path d="M23 17v-6h18v6"/>`+rect(16,33,32,20,white,4)+rect(28,29,9,10,gold,1)+line("M20 24h24M19 46h7m13 0h6"),
    report: items.interview,
    key: () => `<circle cx="23" cy="22" r="12" fill="${gold}"/>`+circle(23,22,4,white)+poly("30,31 36,27 56,47 50,53 44,47 39,51 34,46 38,42",gold),
    settings: () => circle(32,32,22,white)+line("M32 5v10m0 34v10M5 32h10m34 0h10M13 13l8 8m22 22 8 8M13 51l8-8m22-22 8-8")+circle(32,32,10,gold),
    overview: () => poly("8,21 22,13 41,20 56,12 56,47 41,55 22,48 8,56",white)+line("M22 13v35m19-28v35M13 37l5-6m10 2 8 4m10-6 5-7")+circle(31,24,5,coral),
    follow: () => circle(32,24,9,gold)+`<path d="M17 52V42l8-7h14l8 7v10" fill="${white}"/>`+line("M6 25v-9h9m34 0h9v9M6 43v9h9m34 0h9v-9"),
    lock: () => `<path d="M20 28V18a12 12 0 0 1 24 0v10" stroke-width="5"/>`+rect(13,26,38,30,gold,5)+circle(32,39,4,ink)+line("M32 42v5"),
    stamp: () => poly("18,42 14,60 31,51 48,60 44,41",coral)+circle(32,27,21,gold)+circle(32,27,15,white)+line("M23 27l6 6 12-13"),
    close: () => line("M19 19l26 26m0-26L19 45"),
    up: () => poly("14,42 32,20 50,42",ink),
    down: () => poly("14,22 32,44 50,22",ink),
    left: () => poly("42,14 20,32 42,50",ink),
    right: () => poly("22,14 44,32 22,50",ink),
    star: () => poly("32,8 39,23 56,25 44,37 47,55 32,47 17,55 20,37 8,25 25,23",gold)
  };
  const faceNames = {"小安":"an","阿追":"editor","匠叔":"maker","阿看":"observer","鐘塔":"core"};
  const monsterNames = {"想當然怪":"ask","模糊怪":"define","單線怪":"ideate","螢幕怪":"build","說明書怪":"test"};
  const itemNames = {"訪談紀錄":"interview","那一句問題":"problem","方案草圖":"plan","原型":"prototype","測試紀錄":"observation"};
  const icon = name => wrap(name,(symbols[name] || symbols.report)());
  const face = name => { const id=faceNames[name] || "an";return wrap("face-"+id,portraits[id]()); };
  const monster = name => {const id=monsterNames[name] || name,p="beast-"+id+"-"+(++beastSerial);return `<svg class="art-icon" data-art="monster-${id}" viewBox="0 0 96 96" fill="none" stroke="none" aria-hidden="true" focusable="false">${(monsters[id] || monsters.ask)(p)}</svg>`;};
  const item = data => {const id=itemNames[typeof data === "string" ? data : data.name] || "interview";return wrap("item-"+id,items[id]());};
  function player(p) {
    const c = n => "#"+(n || 0).toString(16).padStart(6,"0");
    const hat = p.hat === "cone" ? poly("17,24 31,4 47,24",c(p.hatColor)) : p.hat === "cap" ? rect(17,13,31,12,c(p.hatColor),2) : `<path d="M17 24a15 15 0 0 1 30 0Z" fill="${c(p.hatColor)}"/>`;
    return wrap("player-"+p.id,shirt(c(p.body))+head()+eyes()+hat+line("M17 24h32"));
  }
  function station(id) {
    let body;
    if(id==="ask") body=poly("6,21 32,9 58,21 58,51 32,61 6,50",white)+poly("6,21 32,30 32,61 6,50","#d8c3a8")+line("M6 21l26 9 26-9M11 30v12m8-9v12m30-12v12");
    else if(id==="define") body=`<path d="M32 4C25 19 9 31 11 44c3 23 40 23 43 0C56 31 39 19 32 4Z" fill="${blue}"/>`+line("M32 12c-9 15-14 25-13 33");
    else if(id==="ideate") body=poly("23,7 41,7 44,15 53,17 58,33 52,45 44,48 40,57 23,57 20,49 11,46 6,31 12,18 20,16",gold)+circle(32,32,17,white);
    else if(id==="build") body=poly("15,13 47,13 58,31 47,54 15,54 6,31",ink)+poly("18,18 44,18 52,31 43,49 19,49 12,31",white)+line("M17 12l-4-7m34 7 4-7");
    else if(id==="test") body=rect(8,11,48,42,white,1)+rect(12,17,40,30,blue,1)+line("M8 42h48M14 38v17m12-17v17m12-17v17m12-17v17");
    else body=portraits.core();
    return wrap("station-"+id,body);
  }
  const escape = s => String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function text(s) {
    const map={"📝":()=>item("訪談紀錄"),"🎯":()=>item("那一句問題"),"🗺️":()=>item("方案草圖"),"🧩":()=>item("原型"),"🔍":()=>item("測試紀錄"),"🏅":()=>icon("stamp"),"🔒":()=>icon("lock")};
    return escape(s).replace(/📝|🎯|🗺️|🧩|🔍|🏅|🔒/gu,t=>map[t]());
  }
  return { paintMonsterFace, icon, face, monster, item, player, station, text };
})();
