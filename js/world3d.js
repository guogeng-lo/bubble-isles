/*
 * 泡泡漂流島的 3D 世界：可以拖曳旋轉、滾輪縮放、點島登島的漂浮微縮場景。
 * 用 three.js（MIT 授權，放在 js/vendor/）。沒有 WebGL 的電腦會退回平面地圖。
 * 這個檔案只管「看起來的樣子」，遊戲規則在 app.js。
 */
window.IsleWorld = (function () {
  const T = window.THREE;
  let ok = false;
  let renderer, scene, camera, clock, raycaster, container, labelLayer;
  let hemi, sun, water, waterBase, current;
  let waterEnvironment;
  const waterSurfaces = [];
  const flowTime = { value: 0 };
  const isles = {};
  let order = [];
  let routes = [];
  let player, playerAt = null, playerAnim = null, playerStyle = null;
  const boats = [], walkers = [], lamps = [], bubbles = [];
  let calm = false, panelOpen = false, panelW = 460, mood = "dawn";
  let onPick = () => {};
  let onNear = () => {};
  let onLeave = () => {}, curId = null;
  // 走路：方向鍵或 WASD；橋接起相鄰兩座島，橋頭的門要等前一座島過關才打開
  const keys = new Set();
  const bridges = [];
  let nearId = null, walking = false, placed = false;
  const WALK_SPEED = 6, NEAR = 2.6;
  let hover = null;

  // 顏色：泡泡藍、暖白、香檳金、珊瑚粉、深藍灰
  const SEA = -14;
  const PAL = { bubble: 0x8fd3ea, white: 0xf7f1e6, gold: 0xd6b97c, goldD: 0xb39257, coral: 0xef8577, slate: 0x34495e, slateL: 0x5f7489, skin: 0xf3cfb0, lawn: 0x9ccf8f };

  // 鏡頭：繞著一個目標點轉
  const cam = { target: new T.Vector3(0, 0, 0), theta: Math.PI / 4, phi: 0.95, dist: 95, goal: null };
  const OVERVIEW = { target: new T.Vector3(0, 0, 2), theta: Math.PI / 4, phi: 1.0, dist: 95 };
  function overview() {
    if(!Object.keys(isles).length)return {...OVERVIEW,target:OVERVIEW.target.clone()};
    const bounds=new T.Box3();Object.values(isles).forEach(it=>{
      const p=it.group.position;bounds.expandByPoint(new T.Vector3(p.x-it.r-1,-6,p.z-it.r-1));bounds.expandByPoint(new T.Vector3(p.x+it.r+1,7,p.z+it.r+1));
    });
    routes.forEach(r=>r.points.forEach(p=>bounds.expandByPoint(p.clone().add(new T.Vector3(0,0,-2)))));
    const target=bounds.getCenter(new T.Vector3());target.y=0;
    const theta=0.2,phi=0.93,dir=new T.Vector3(Math.sin(phi)*Math.sin(theta),Math.cos(phi),Math.sin(phi)*Math.cos(theta));
    const right=new T.Vector3(Math.cos(theta),0,-Math.sin(theta)),up=new T.Vector3().crossVectors(dir,right),aspect=container.clientWidth/Math.max(1,container.clientHeight),fov=aspect<0.8?52:38,tan=Math.tan(fov*Math.PI/360);
    let dist=0;
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
      const p=new T.Vector3(x,y,z).sub(target);dist=Math.max(dist,p.dot(dir)+Math.max(Math.abs(p.dot(right))/(tan*aspect),Math.abs(p.dot(up))/tan));
    }
    return {target,theta,phi,dist:dist*1.1};
  }

  /* ---------- 小工具 ---------- */
  function rand(seed) {
    let s = (seed * 9301 + 49297) % 233280;
    return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  }
  function mat(color, extra) {
    return new T.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: 0.9, metalness: 0 }, extra || {}));
  }
  function mesh(geo, m, cast = true) {
    const o = new T.Mesh(geo, m);
    o.castShadow = cast; o.receiveShadow = true;
    return o;
  }
  function box(w, h, d, m, x = 0, y = 0, z = 0, cast = true) {
    const o = mesh(new T.BoxGeometry(w, h, d), m, cast); o.position.set(x, y, z); return o;
  }
  function wobble(geo, seed, amount) {
    const p = geo.attributes.position, r = rand(seed);
    const b = [r() * 6, r() * 6, r() * 6, r() * 6];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z);
      if (d < 0.01) continue;
      const a = Math.atan2(z, x);
      const k = 1 + amount * (Math.sin(a * 2 + b[0]) * 0.45 + Math.sin(a * 3 + b[1]) * 0.35 + Math.sin(a * 5 + b[2]) * 0.2 + Math.sin(a * 7 + b[3]) * 0.1);
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    geo.computeVertexNormals();
    return geo;
  }
  function shade(hex, f) { return new T.Color(hex).multiplyScalar(f); }
  function canvasTex(w, h) {
    const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
    const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace;
    return { cv, ctx: cv.getContext("2d"), tex };
  }

  /* ---------- 小人 ---------- */
  function figure(style, scale = 1, role) {
    if (role === "center") return dialKeeper(scale);
    if (style.kind === "an") return anFigure(scale);
    const g = new T.Group();
    const skin = mat(0xf0c9a0);
    const legs = mesh(new T.CylinderGeometry(0.22, 0.26, 0.6, 6), mat(style.legs || 0x3b4a52)); legs.position.y = 0.3; g.add(legs);
    const body = mesh(new T.CylinderGeometry(0.3, 0.38, 0.75, 7), mat(style.body)); body.position.y = 0.95; g.add(body);
    const head = mesh(new T.IcosahedronGeometry(0.3, 1), skin); head.position.y = 1.55; g.add(head);
    let hat;
    if (style.hat === "cone") { hat = mesh(new T.ConeGeometry(0.36, 0.5, 7), mat(style.hatColor)); hat.position.y = 1.95; }
    else if (style.hat === "cap") { hat = mesh(new T.CylinderGeometry(0.32, 0.33, 0.2, 8), mat(style.hatColor)); hat.position.y = 1.8; }
    else { hat = mesh(new T.SphereGeometry(0.34, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(style.hatColor)); hat.position.y = 1.72; }
    g.add(hat);
    if (style.pack) { const pack = mesh(new T.BoxGeometry(0.4, 0.45, 0.22), mat(style.pack)); pack.position.set(0, 1.0, -0.35); g.add(pack); }
    if (style.tool && !role) { const t = mesh(new T.BoxGeometry(0.42, 0.3, 0.04), mat(style.tool)); t.position.set(0.32, 1.0, 0.3); t.rotation.y = -0.5; g.add(t); }
    if(role) dressKeeper(g,role);
    g.scale.setScalar(scale);
    return g;
  }
  function dressKeeper(g,role) {
    const ink=mat(PAL.slate),gold=mat(PAL.gold);
    [-0.1,0.1].forEach(x=>g.add(box(0.045,0.055,0.025,ink,x,1.57,0.277,false)));
    if(role==="define") {
      const monocle=mesh(new T.TorusGeometry(0.105,0.022,6,16),gold);monocle.position.set(0.12,1.57,0.29);g.add(monocle);
      g.add(box(0.016,0.29,0.018,gold,0.24,1.38,0.28));
      const brim=box(0.6,0.04,0.18,gold,0,1.73,0.24);g.add(brim);
    } else if(role==="ideate" || role==="build") {
      const beard=mesh(new T.ConeGeometry(0.24,0.32,5),ink);beard.rotation.z=Math.PI;beard.position.set(0,1.38,0.16);g.add(beard);
      const strap=box(0.085,0.6,0.04,mat(PAL.coral),-0.14,0.95,0.31);strap.rotation.z=0.2;g.add(strap);
      g.add(box(0.24,0.24,0.11,gold,0.25,0.8,0.35));
      g.add(box(0.04,0.28,0.04,ink,0.27,0.99,0.43));
    } else if(role==="test") {
      g.add(box(0.42,0.52,0.055,ink,0.27,1.05,0.35));
      g.add(box(0.34,0.4,0.025,mat(PAL.white),0.27,1.04,0.39));
      g.add(box(0.15,0.09,0.04,gold,0.27,1.3,0.4));
      [1.12,1.02,0.92].forEach(y=>g.add(box(0.21,0.018,0.015,ink,0.27,y,0.415,false)));
    }
  }
  function dialKeeper(scale) {
    const g=new T.Group(),gold=mat(PAL.gold),ink=mat(PAL.slate),white=mat(PAL.white);
    [-0.18,0.18].forEach(x=>g.add(box(0.22,0.16,0.35,ink,x,0.14,0.07)));
    g.add(box(0.65,0.63,0.42,white,0,0.7,0));
    [-0.42,0.42].forEach(x=>g.add(box(0.13,0.4,0.14,gold,x,0.8,0)));
    const face=mesh(new T.CylinderGeometry(0.47,0.47,0.2,16),gold);face.rotation.x=Math.PI/2;face.position.y=1.48;g.add(face);
    const dial=mesh(new T.CircleGeometry(0.39,20),white);dial.position.set(0,1.48,0.11);g.add(dial);
    [-0.14,0.14].forEach(x=>g.add(box(0.065,0.075,0.025,ink,x,1.45,0.13,false)));
    const mouth=mesh(new T.TorusGeometry(0.13,0.018,5,12,Math.PI*0.7),ink);mouth.rotation.z=Math.PI*1.15;mouth.position.set(0,1.37,0.13);g.add(mouth);
    g.add(box(0.065,0.18,0.025,mat(PAL.coral),0,1.76,0.13));
    [0,1,2,3,4].forEach(i=>{const a=(i-2)*Math.PI/4;const tick=box(0.025,0.065,0.025,ink,Math.sin(a)*0.36,1.48+Math.cos(a)*0.36,0.13,false);tick.rotation.z=-a;g.add(tick);});
    g.scale.setScalar(scale);return g;
  }
  // 小安：貓耳毛帽、寬大的白帽T、短褲、拖鞋，抱著洗衣籃
  function anFigure(scale = 1) {
    const g = new T.Group();
    const skin = mat(PAL.skin), hoodie = mat(0xf6f3fb), hair = mat(0xcaa98a), beanie = mat(0x7f9db3);
    const legs = [];
    [-0.12, 0.12].forEach(x => {
      const leg = new T.Group(); leg.position.set(x, 0.55, 0); g.add(leg); legs.push(leg);
      const shin = mesh(new T.CylinderGeometry(0.075, 0.068, 0.46, 6), skin); shin.position.y = -0.25; leg.add(shin);
      const sock = mesh(new T.CylinderGeometry(0.08, 0.08, 0.12, 6), mat(0xffffff)); sock.position.y = -0.46; leg.add(sock);
      const slipper = box(0.17, 0.05, 0.3, mat(PAL.coral), 0, -0.53, 0.05); leg.add(slipper);
    });
    const shorts = mesh(new T.CylinderGeometry(0.24, 0.27, 0.2, 8), mat(PAL.slate)); shorts.position.y = 0.6; g.add(shorts);
    const body = mesh(new T.CylinderGeometry(0.26, 0.37, 0.64, 8), hoodie); body.position.y = 0.97; g.add(body);
    const pocket = box(0.3, 0.12, 0.05, mat(0xe7e1f0), 0, 0.84, 0.33); pocket.rotation.x = -0.2; g.add(pocket);
    [-0.06, 0.06].forEach(x => { const s = box(0.025, 0.22, 0.02, mat(PAL.coral), x, 1.12, 0.27, false); g.add(s); });
    const hood = mesh(new T.TorusGeometry(0.19, 0.08, 6, 10), hoodie); hood.position.set(0, 1.27, -0.08); hood.rotation.x = Math.PI / 2 + 0.35; g.add(hood);
    // 手臂：抱著籃子，動畫時會用到
    const arms = new T.Group(); arms.position.y = 1.18; g.add(arms);
    [-1, 1].forEach(s => {
      const arm = mesh(new T.CylinderGeometry(0.07, 0.09, 0.48, 6), hoodie);
      arm.position.set(s * 0.31, -0.16, 0.13); arm.rotation.x = -0.95; arm.rotation.z = s * 0.1; arms.add(arm);
      const hand = mesh(new T.SphereGeometry(0.06, 6, 5), skin); hand.position.set(s * 0.27, -0.32, 0.34); arms.add(hand);
    });
    const basket = laundryBasket(0.52); basket.position.set(0, 0.72, 0.44); g.add(basket);
    // 頭
    const head = new T.Group(); head.position.y = 1.52; g.add(head);
    head.add(mesh(new T.IcosahedronGeometry(0.27, 1), skin));
    const hairBack = mesh(new T.SphereGeometry(0.29, 10, 8), hair); hairBack.position.set(0, 0.04, -0.07); head.add(hairBack);
    head.add(box(0.5, 0.48, 0.12, hair, 0, -0.28, -0.2));
    head.add(box(0.46, 0.1, 0.1, hair, 0, 0.15, 0.2));
    [-1, 1].forEach(s => {
      const braid = mesh(new T.CylinderGeometry(0.05, 0.035, 0.42, 6), hair); braid.position.set(s * 0.25, -0.3, 0.04); head.add(braid);
      const eye = mesh(new T.SphereGeometry(0.036, 6, 5), mat(0x3a4458), false); eye.position.set(s * 0.1, 0.0, 0.25); head.add(eye);
      const blush = mesh(new T.SphereGeometry(0.035, 6, 4), mat(0xf4a7a0), false); blush.position.set(s * 0.16, -0.07, 0.22); blush.scale.z = 0.4; head.add(blush);
      const ear = mesh(new T.ConeGeometry(0.09, 0.18, 4), beanie); ear.position.set(s * 0.17, 0.37, -0.02); ear.rotation.z = -s * 0.35; head.add(ear);
    });
    const hat = mesh(new T.SphereGeometry(0.31, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), beanie); hat.position.y = 0.09; hat.scale.y = 0.85; head.add(hat);
    const cuff = mesh(new T.TorusGeometry(0.29, 0.055, 6, 16), mat(0x6d8aa1)); cuff.rotation.x = Math.PI / 2; cuff.position.y = 0.1; head.add(cuff);
    [0.6, -0.6].forEach(a => { const x = box(0.11, 0.022, 0.02, mat(0xffffff), 0, 0.1, 0.34, false); x.rotation.z = a; head.add(x); });
    g.userData.an = { arms, head, basket, legs };
    g.scale.setScalar(scale);
    return g;
  }
  function ring(color) {
    const m = new T.Mesh(new T.RingGeometry(0.55, 0.72, 24), new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.04;
    return m;
  }

  /* ---------- 怪獸 ---------- */
  function monster(color,role) {
    const g=new T.Group(),clay=c=>mat(c,{flatShading:false,roughness:0.94,metalness:0});
    const palette={purple:0xa58bc5,cloud:0xc5d6d8,green:0x83ad92,navy:0x526f84,paper:0xf1e8d1,gold:0xc9b17c};
    function ball(x,y,z,rx,ry,rz,m){const o=mesh(new T.SphereGeometry(1,20,14),m);o.position.set(x,y,z);o.scale.set(rx,ry,rz);g.add(o);return o;}
    function stroke(points,r,m){const o=mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),18,r,7,false),m);g.add(o);return o;}
    function roundBox(w,h,d,r,m){
      const b=Math.min(r*.55,d*.24),x=-w/2+b,y=-h/2+b,W=w-2*b,H=h-2*b,R=Math.max(.01,r-b),s=new T.Shape();
      s.moveTo(x+R,y);s.lineTo(x+W-R,y);s.quadraticCurveTo(x+W,y,x+W,y+R);s.lineTo(x+W,y+H-R);s.quadraticCurveTo(x+W,y+H,x+W-R,y+H);s.lineTo(x+R,y+H);s.quadraticCurveTo(x,y+H,x,y+H-R);s.lineTo(x,y+R);s.quadraticCurveTo(x,y,x+R,y);
      const geo=new T.ExtrudeGeometry(s,{depth:Math.max(.01,d-2*b),bevelEnabled:true,bevelSize:b,bevelThickness:b,bevelSegments:4,curveSegments:10,steps:1});geo.translate(0,0,-d/2+b);return mesh(geo,m);
    }
    function face(cx,cy,w,zAt){
      const t=canvasTex(256,192);window.IsleArt.paintMonsterFace(t.ctx,role);t.tex.needsUpdate=true;
      const H=w*.75,N=22,M=16,vertices=[],uv=[],indices=[];
      for(let j=0;j<=M;j++)for(let i=0;i<=N;i++){const x=cx+(i/N-.5)*w,y=cy+(.5-j/M)*H;vertices.push(x,y,zAt(x,y)+.009);uv.push(i/N,1-j/M);}
      for(let j=0;j<M;j++)for(let i=0;i<N;i++){const k=j*(N+1)+i;indices.push(k,k+N+1,k+1,k+1,k+N+1,k+N+2);}
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(vertices,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
      const m=new T.MeshStandardMaterial({map:t.tex,transparent:true,roughness:.96,metalness:0,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
      const o=mesh(geo,m,false);o.renderOrder=1;g.add(o);
    }
    function cloudBody(m){
      const blobs=[[-.04,-.15,0,.83,.35,.45],[-.60,.04,0,.43,.40,.40],[-.16,.29,-.02,.45,.52,.45],[.49,.10,0,.53,.41,.43]];
      function field(x,y,z){let d=10;for(const [a,b,c,rx,ry,rz] of blobs){const X=x-a,Y=y-b,Z=z-c,k=Math.hypot(X/rx,Y/ry,Z/rz),q=Math.hypot(X/(rx*rx),Y/(ry*ry),Z/(rz*rz)),v=q<1e-6?-Math.min(rx,ry,rz):k*(k-1)/q,h=Math.max(0,Math.min(1,.5+.5*(v-d)/.22));d=v*(1-h)+d*h-.22*h*(1-h);}return d;}
      const nx=34,ny=24,nz=20,points=[],values=[],out=[],normal=[];
      const index=(i,j,k)=>(k*(ny+1)+j)*(nx+1)+i;
      for(let k=0;k<=nz;k++)for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const p=new T.Vector3(-1.2+i/nx*2.4,-.65+j/ny*1.60,-.65+k/nz*1.30);points.push(p);values.push(field(p.x,p.y,p.z));}
      const grad=p=>{const h=.002;return new T.Vector3(field(p.x+h,p.y,p.z)-field(p.x-h,p.y,p.z),field(p.x,p.y+h,p.z)-field(p.x,p.y-h,p.z),field(p.x,p.y,p.z+h)-field(p.x,p.y,p.z-h)).normalize();};
      function triangle(a,b,c){const center=a.clone().add(b).add(c).multiplyScalar(1/3),n=grad(center);if(new T.Vector3().subVectors(b,a).cross(new T.Vector3().subVectors(c,a)).dot(n)<0)[b,c]=[c,b];for(const p of [a,b,c]){out.push(p.x,p.y,p.z);const n=grad(p);normal.push(n.x,n.y,n.z);}}
      const tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
      for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
        const cell=[index(i,j,k),index(i+1,j,k),index(i+1,j+1,k),index(i,j+1,k),index(i,j,k+1),index(i+1,j,k+1),index(i+1,j+1,k+1),index(i,j+1,k+1)];
        for(const t of tetra){const inside=[],outside=[];for(const n of t)(values[cell[n]]<0?inside:outside).push(cell[n]);if(!inside.length||!outside.length)continue;const hit=(a,b)=>points[a].clone().lerp(points[b],values[a]/(values[a]-values[b]));if(inside.length===1){const a=inside[0];triangle(...outside.map(b=>hit(a,b)));}else if(outside.length===1){const b=outside[0];triangle(...inside.map(a=>hit(a,b)));}else{const [a,b]=inside,[c,d]=outside,A=hit(a,c),B=hit(a,d),C=hit(b,c),D=hit(b,d);triangle(A,B,C);triangle(B,D,C);}}
      }
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(out,3));geo.setAttribute('normal',new T.Float32BufferAttribute(normal,3));g.add(mesh(geo,m));
      return (x,y)=>{if(field(x,y,0)>0)return .08;let lo=0,hi=.8;for(let i=0;i<20;i++){const mid=(lo+hi)/2;if(field(x,y,mid)<0)lo=mid;else hi=mid;}return (lo+hi)/2;};
    }
    if(role==='define'){
      const front=cloudBody(clay(palette.cloud));face(0,.035,1.30,front);
      ball(-.61,-.49,-.20,.20,.13,.18,clay(0xb3cacf));ball(.38,-.58,-.12,.13,.09,.12,clay(0xb3cacf));
    }else if(role==='ideate'){
      const green=clay(palette.green),curve=new T.CatmullRomCurve3([new T.Vector3(-.55,-.65,.18),new T.Vector3(-.08,-.75,.40),new T.Vector3(.52,-.64,.24),new T.Vector3(.62,-.55,-.22),new T.Vector3(.12,-.52,-.38),new T.Vector3(-.35,-.46,-.15),new T.Vector3(-.44,-.18,.08),new T.Vector3(-.32,.13,.17),new T.Vector3(.05,.32,.15),new T.Vector3(.28,.52,.03)]);
      const N=76,R=16,geo=new T.TubeGeometry(curve,N,.215,R,false),a=geo.attributes.position,colors=[],body=new T.Color(palette.green),belly=new T.Color(0xb5c4a2);
      for(let i=0;i<=N;i++){const c=curve.getPointAt(i/N),t=Math.min(1,i/16),f=.16+.84*t*t*(3-2*t);for(let j=0;j<=R;j++){const k=i*(R+1)+j,p=new T.Vector3().fromBufferAttribute(a,k).sub(c).multiplyScalar(f),front=p.z/(.215*f);const tint=body.clone().lerp(belly,T.MathUtils.smoothstep(front,.48,.84)*.62);colors.push(tint.r,tint.g,tint.b);p.add(c);a.setXYZ(k,p.x,p.y,p.z);}}
      geo.setAttribute('color',new T.Float32BufferAttribute(colors,3));geo.computeVertexNormals();const tube=mesh(geo,new T.MeshStandardMaterial({vertexColors:true,roughness:.94}));g.add(tube);
      ball(-.55,-.65,.18,.035,.035,.035,green);ball(.30,.57,.025,.43,.30,.33,green);
      face(.30,.575,.72,(x,y)=>.025+.33*Math.sqrt(Math.max(.005,1-((x-.30)/.43)**2-((y-.57)/.30)**2)));
    }else if(role==='build'){
      g.add(roundBox(1.48,1.10,.84,.20,clay(palette.navy)));
      const screen=roundBox(1.18,.76,.055,.11,clay(0xa8cfd0));screen.position.set(0,.025,.425);g.add(screen);face(0,.025,.98,()=>.453);
      [-1,1].forEach(s=>{const foot=roundBox(.28,.23,.43,.075,clay(0xd69d88));foot.position.set(s*.42,-.62,.06);g.add(foot);stroke([[s*.29,.51,-.05],[s*.35,.69,-.05],[s*.43,.82,-.05]],.029,clay(palette.gold));ball(s*.43,.82,-.05,.07,.07,.07,clay(0xd69d88));});
      ball(.63,-.40,.425,.035,.035,.016,clay(palette.gold));
    }else if(role==='test'){
      const N=22,M=18,v=[],ind=[],stride=(N+1)*(M+1);
      for(let side=0;side<2;side++)for(let j=0;j<=M;j++)for(let i=0;i<=N;i++){const x=(i/N-.5)*1.02,y=(j/M-.5)*1.16;v.push(x,y,.06+.10*(x/.51)**2-side*.13);}
      for(let j=0;j<M;j++)for(let i=0;i<N;i++){const k=j*(N+1)+i;ind.push(k,k+1,k+N+1,k+1,k+N+2,k+N+1,k+stride,k+N+1+stride,k+1+stride,k+1+stride,k+N+1+stride,k+N+2+stride);}
      const border=[];for(let i=0;i<=N;i++)border.push(i);for(let j=1;j<=M;j++)border.push(j*(N+1)+N);for(let i=N-1;i>=0;i--)border.push(M*(N+1)+i);for(let j=M-1;j>0;j--)border.push(j*(N+1));for(let i=0;i<border.length;i++){const a=border[i],b=border[(i+1)%border.length];ind.push(a,a+stride,b,b,a+stride,b+stride);}
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(v,3));geo.setIndex(ind);geo.computeVertexNormals();g.add(mesh(geo,clay(palette.paper)));
      [-.60,.60].forEach(y=>{const roll=mesh(new T.CylinderGeometry(.15,.15,1.28,20),clay(palette.gold));roll.rotation.z=Math.PI/2;roll.position.y=y;g.add(roll);[-1,1].forEach(s=>{const end=mesh(new T.CircleGeometry(.126,24),clay(0xe8dbb6));end.rotation.y=s*Math.PI/2;end.position.set(s*.646,y,0);g.add(end);const pts=[];for(let i=0;i<34;i++){const t=i/33,b=t*Math.PI*2.5,r=.018+t*.075;pts.push([s*.651,y+Math.cos(b)*r,Math.sin(b)*r]);}stroke(pts,.008,clay(0xaa9469));});});
      face(0,.01,.90,x=>.06+.10*(x/.51)**2);
    }else{
      const purple=clay(palette.purple),dark=clay(0x8c73aa);ball(0,.025,0,.68,.73,.55,purple);
      [-1,1].forEach(s=>{const horn=mesh(new T.CylinderGeometry(.04,.12,.34,16),purple);horn.position.set(s*.40,.65,-.025);horn.rotation.z=-s*.23;g.add(horn);ball(s*.435,.82,-.025,.045,.055,.045,purple);ball(s*.62,-.24,.015,.17,.105,.15,purple);ball(s*.29,-.64,.13,.19,.105,.22,dark);});
      face(0,.10,1.22,(x,y)=>.55*Math.sqrt(Math.max(.005,1-(x/.68)**2-((y-.025)/.73)**2)));
    }
    g.userData.artRole=role;return g;
  }

  /* ---------- 洗衣的小東西 ---------- */
  function laundryBasket(s = 1, color = 0x9fd4e6, fill = [PAL.slate, 0xffffff, PAL.coral]) {
    const g = new T.Group(), m = mat(color);
    const w = 0.8, d = 0.55, h = 0.4, t = 0.05;
    g.add(box(w, t, d, m, 0, t / 2, 0));
    [d / 2, -d / 2].forEach(z => g.add(box(w, h, t, m, 0, h / 2, z)));
    [w / 2, -w / 2].forEach(x => g.add(box(t, h, d, m, x, h / 2, 0)));
    fill.forEach((c, k) => {
      const lump = mesh(new T.DodecahedronGeometry(0.2, 0), mat(c));
      lump.position.set(-0.22 + k * 0.22, h * 0.85, k % 2 ? 0.06 : -0.05); lump.scale.set(1.1, 0.6, 1); g.add(lump);
    });
    g.scale.setScalar(s);
    return g;
  }
  function shirt(color) {
    const g = new T.Group(), m = mat(color);
    g.add(box(0.5, 0.55, 0.04, m, 0, -0.32, 0));
    [-1, 1].forEach(s => { const sl = box(0.22, 0.16, 0.04, m, s * 0.3, -0.12, 0); sl.rotation.z = s * 0.5; g.add(sl); });
    return g;
  }
  // 褲子；wet 時褲管下半段顏色比較深
  function pants(color, wet) {
    const g = new T.Group(), m = mat(color), dark = mat(shade(color, 0.62).getHex());
    g.add(box(0.5, 0.16, 0.05, m, 0, -0.08, 0));
    [-0.13, 0.13].forEach(x => {
      g.add(box(0.21, wet ? 0.5 : 0.8, 0.05, m, x, wet ? -0.41 : -0.56, 0));
      if (wet) g.add(box(0.21, 0.3, 0.055, dark, x, -0.81, 0));
    });
    if (wet) {
      [-0.13, 0.13].forEach((x, k) => { const drip = mesh(new T.SphereGeometry(0.035, 5, 4), mat(0x6cc6e8, { transparent: true, opacity: 0.85 }), false); drip.position.set(x, -1.02 - k * 0.08, 0); drip.scale.y = 1.6; g.add(drip); g.userData.drips = (g.userData.drips || []).concat(drip); });
    }
    return g;
  }
  function clothesline(len, items) {
    const g = new T.Group(), pole = mat(PAL.slateL);
    [-len / 2, len / 2].forEach(x => g.add(box(0.08, 2.1, 0.08, pole, x, 1.05, 0)));
    const line = mesh(new T.CylinderGeometry(0.015, 0.015, len, 4), mat(0xffffff), false); line.rotation.z = Math.PI / 2; line.position.y = 2.0; g.add(line);
    items.forEach((it, k) => {
      it.position.set(-len / 2 + (k + 0.5) * (len / items.length), 2.0, 0);
      const peg = box(0.04, 0.1, 0.06, mat(PAL.coral), 0, 0, 0.03, false); it.add(peg);
      g.add(it);
    });
    return g;
  }
  function pottedPlant(r) {
    const g = new T.Group();
    const pot = mesh(new T.CylinderGeometry(0.28, 0.2, 0.4, 7), mat(r() < 0.5 ? PAL.coral : PAL.white)); pot.position.y = 0.2; g.add(pot);
    const greens = [0x4f9a62, 0x67ad6d, 0x3f8656];
    for (let k = 0; k < 3; k++) {
      const leaf = mesh(new T.DodecahedronGeometry(0.22 + r() * 0.1, 0), mat(greens[k])); leaf.position.set((r() - 0.5) * 0.25, 0.55 + k * 0.14, (r() - 0.5) * 0.25); g.add(leaf);
    }
    g.scale.setScalar(0.9 + r() * 0.5);
    return g;
  }
  function bottle(r) {
    const g = new T.Group();
    const c = [PAL.bubble, PAL.coral, 0xb9a3e3, 0xf6d36b][Math.floor(r() * 4)];
    g.add(box(0.36, 0.6, 0.24, mat(c, { roughness: 0.5 }), 0, 0.3, 0));
    g.add(box(0.2, 0.08, 0.24, mat(0xffffff), 0, 0.42, 0.001));
    const cap = mesh(new T.CylinderGeometry(0.07, 0.07, 0.12, 6), mat(PAL.white)); cap.position.set(0.08, 0.66, 0); g.add(cap);
    g.scale.setScalar(0.9 + r() * 0.5);
    return g;
  }
  function foldedStack(r) {
    const g = new T.Group(), cs = [PAL.white, PAL.coral, PAL.bubble, 0xf6d36b, 0xb9d8c2];
    const n = 2 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) g.add(box(0.7, 0.13, 0.5, mat(cs[Math.floor(r() * cs.length)]), (r() - 0.5) * 0.06, 0.07 + k * 0.13, (r() - 0.5) * 0.06));
    return g;
  }
  function crate(r) {
    const g = new T.Group();
    g.add(box(0.7, 0.6, 0.7, mat(0xd4a86e), 0, 0.3, 0));
    if (r() < 0.5) g.add(box(0.5, 0.45, 0.5, mat(0xc3965c), 0.05, 0.82, 0));
    g.rotation.y = r() * 1.5;
    return g;
  }
  function puddle(r) {
    const m = new T.Mesh(new T.CircleGeometry(0.4 + r() * 0.4, 10), new T.MeshStandardMaterial({ color: 0x8fd3ea, transparent: true, opacity: 0.55, roughness: 0.1 }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.scale.y = 0.7;
    return m;
  }
  function drop(r) {
    const g = new T.Group();
    const d = mesh(new T.SphereGeometry(0.22, 8, 6), mat(0x8fd3ea, { transparent: true, opacity: 0.8, roughness: 0.1 }), false);
    d.position.y = 0.22; d.scale.y = 1.25; g.add(d);
    const tip = mesh(new T.ConeGeometry(0.15, 0.22, 8), d.material, false); tip.position.y = 0.52; g.add(tip);
    g.scale.setScalar(0.8 + r() * 0.9);
    return g;
  }
  function roundTree(r) {
    const g = new T.Group();
    const trunk = mesh(new T.CylinderGeometry(0.1, 0.15, 0.7, 6), mat(0x9a7350)); trunk.position.y = 0.35; g.add(trunk);
    const top = mesh(new T.DodecahedronGeometry(0.7, 0), mat([0x5fa86f, 0x72b97a, 0x4e9862][Math.floor(r() * 3)])); top.position.y = 1.2; g.add(top);
    g.scale.setScalar(0.8 + r() * 0.5);
    return g;
  }
  const PROPS = {
    ask: [pottedPlant, foldedStack, pottedPlant, bottle, roundTree, foldedStack],
    define: [drop, puddle, drop, pottedPlant, roundTree, drop],
    ideate: [bottle, bottle, foldedStack, pottedPlant, roundTree, bottle],
    build: [crate, crate, bottle, roundTree, crate, pottedPlant],
    test: [pottedPlant, pottedPlant, bottle, roundTree, foldedStack, pottedPlant],
    center: [pottedPlant, roundTree]
  };
  function lamp() {
    const g = new T.Group();
    const post = mesh(new T.CylinderGeometry(0.06, 0.08, 1.8, 6), mat(PAL.slate)); post.position.y = 0.9; g.add(post);
    const head = mesh(new T.SphereGeometry(0.2, 8, 6), mat(0xfff6dc, { emissive: 0xffd08a, emissiveIntensity: 0.15 })); head.position.y = 1.95; g.add(head);
    const cap = mesh(new T.ConeGeometry(0.24, 0.16, 8), mat(PAL.gold)); cap.position.y = 2.17; g.add(cap);
    lamps.push(head.material);
    return g;
  }
  function dock(len) {
    const g = new T.Group();
    for (let k = 0; k < len; k++) {
      const plank = mesh(new T.BoxGeometry(1.6, 0.12, 0.42), mat(k % 2 ? 0xc99a6c : 0xd8ab7d)); plank.position.set(0, 0.35, k * 0.46); g.add(plank);
    }
    [[-0.75, 0.2], [0.75, 0.2], [-0.75, len * 0.46 - 0.2], [0.75, len * 0.46 - 0.2]].forEach(([x, z]) => {
      const post = mesh(new T.CylinderGeometry(0.09, 0.09, 1.1, 6), mat(PAL.slateL)); post.position.set(x, 0.1, z); g.add(post);
    });
    return g;
  }

  /* ---------- 直立式洗衣機：白色機身、香檳金面板、上掀蓋 ---------- */
  function washer(s = 1, text = "45") {
    const g = new T.Group();
    const white = mat(0xf5f6f4, { roughness: 0.55 });
    g.add(box(1.0, 1.25, 1.0, white, 0, 0.68, 0));
    g.add(box(1.03, 0.07, 1.03, mat(PAL.slateL), 0, 0.05, 0));
    g.add(box(1.0, 0.06, 1.0, white, 0, 1.33, 0));
    const hole = mesh(new T.CylinderGeometry(0.34, 0.34, 0.02, 18), mat(0x9aa6ad)); hole.position.set(0, 1.37, -0.08); g.add(hole);
    const lidPivot = new T.Group(); lidPivot.position.set(0, 1.37, -0.45); g.add(lidPivot);
    const lid = mesh(new T.BoxGeometry(0.86, 0.04, 0.66), mat(0xc4d8e2, { transparent: true, opacity: 0.72, roughness: 0.15 })); lid.position.set(0, 0.02, 0.34); lidPivot.add(lid);
    // 面板：微微斜的香檳金長條
    const panel = new T.Group(); panel.position.set(0, 1.4, 0.4); panel.rotation.x = -0.55; g.add(panel);
    panel.add(box(0.98, 0.26, 0.06, mat(PAL.gold, { roughness: 0.4, metalness: 0.3 })));
    const scr = canvasTex(128, 48);
    const disp = new T.Mesh(new T.PlaneGeometry(0.3, 0.11), new T.MeshBasicMaterial({ map: scr.tex })); disp.position.set(-0.04, 0.02, 0.032); panel.add(disp);
    const leds = [0, 1, 2].map(i => { const l = mesh(new T.SphereGeometry(0.02, 6, 5), mat(0x5a5040, { emissive: 0x47d6ff, emissiveIntensity: 0 }), false); l.position.set(-0.15 + i * 0.11, -0.08, 0.035); panel.add(l); return l; });
    [-0.42, -0.33, -0.24, 0.17, 0.26].forEach(x => { const b = mesh(new T.CylinderGeometry(0.033, 0.033, 0.025, 10), mat(0xffffff), false); b.rotation.x = Math.PI / 2; b.position.set(x, 0, 0.04); panel.add(b); });
    const start = mesh(new T.CylinderGeometry(0.065, 0.065, 0.03, 16), mat(0xffffff), false); start.rotation.x = Math.PI / 2; start.position.set(0.39, 0, 0.04); panel.add(start);
    const startRing = mesh(new T.TorusGeometry(0.072, 0.012, 6, 20), mat(0x6fb6ff, { emissive: 0x4aa8ff, emissiveIntensity: 0.7 }), false); startRing.position.set(0.39, 0, 0.056); panel.add(startRing);
    function draw(txt, color) {
      const c = scr.ctx;
      c.fillStyle = "#16242c"; c.fillRect(0, 0, 128, 48);
      c.fillStyle = color || "#7fe7ff"; c.font = "bold 34px monospace"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText(txt, 64, 26); scr.tex.needsUpdate = true;
    }
    draw(text);
    g.userData.washer = { lidPivot, leds, startRing, draw, group: g, text };
    g.scale.setScalar(s);
    return g;
  }

  /* ---------- 漂浮的生活場景：每座島自己的地板、邊緣、主體、底座 ---------- */
  // 島上的座標：+z 是島的正面（朝外，點島名時鏡頭從這邊看進來），phi 從正面往右轉
  function P(phi, R, y = 0) { return new T.Vector3(Math.sin(phi) * R, y, Math.cos(phi) * R); }
  function angDiff(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); }
  function nearGap(ctx, phi, w = 0.3) { return ctx.gaps.some(g => angDiff(phi, g) < w); }
  const D = Math.PI / 180;
  // 沿著島邊排一圈東西；橋頭的位置空出來
  function alongRim(ctx, from, to, step, R, make, w) {
    for (let phi = from; phi <= to + 1e-6; phi += step) {
      if (nearGap(ctx, phi, w)) continue;
      const o = make(phi); if (!o) continue;
      const y = o.position.y; o.position.copy(P(phi, R, y)); o.rotation.y = phi; ctx.g.add(o);
    }
  }
  function floorTex(draw, size = 256) { const t = canvasTex(size, size); draw(t.ctx, size); t.tex.needsUpdate = true; return t.tex; }
  function floorDisc(ctx, tex) {
    const m = new T.Mesh(new T.CircleGeometry(ctx.r * 0.98, 56), new T.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.012; m.receiveShadow = true; ctx.g.add(m);
    return m;
  }
  function slab(ctx, color, h = 0.55) {
    const s = mesh(new T.CylinderGeometry(ctx.r * 0.98, ctx.r * 0.96, h, 56), mat(color)); s.position.y = -h / 2; ctx.g.add(s);
    return s;
  }
  function doorFrame(m, h = 2.6, w = 2.4) {
    const g = new T.Group();
    [-w / 2, w / 2].forEach(x => g.add(box(0.22, h, 0.3, m, x, h / 2, 0)));
    g.add(box(w + 0.22, 0.26, 0.3, m, 0, h, 0));
    return g;
  }
  // 小東西
  function bed(c) {
    const g = new T.Group();
    g.add(box(1.7, 0.4, 2.5, mat(PAL.white), 0, 0.2, 0));
    g.add(box(1.6, 0.18, 2.3, mat(0xffffff), 0, 0.48, 0.05));
    g.add(box(1.62, 0.12, 1.4, mat(c), 0, 0.6, 0.45));
    g.add(box(0.9, 0.16, 0.45, mat(0xf6f3fb), 0, 0.62, -0.8));
    g.add(box(1.7, 0.9, 0.12, mat(0x8a6a4e), 0, 0.45, -1.25));
    return g;
  }
  function shelf() {
    const g = new T.Group(), m = mat(0x8a6a4e);
    g.add(box(1.4, 1.6, 0.45, m, 0, 0.8, 0));
    [0.45, 1.0].forEach(y => { const s = foldedStack(rand(y * 10)); s.scale.setScalar(0.8); s.position.set(-0.3, y, 0.05); g.add(s); const b = bottle(rand(y * 7)); b.scale.setScalar(0.6); b.position.set(0.35, y - 0.05, 0.05); g.add(b); });
    return g;
  }
  function acUnit() {
    const g = new T.Group();
    g.add(box(1.0, 0.7, 0.45, mat(0xf2f2ef), 0, 0, 0));
    const fan = mesh(new T.CylinderGeometry(0.24, 0.24, 0.04, 12), mat(PAL.slateL)); fan.rotation.x = Math.PI / 2; fan.position.set(-0.15, 0, 0.23); g.add(fan);
    return g;
  }
  function questionMark(c = PAL.coral) {
    const q = new T.Group();
    const arc = mesh(new T.TorusGeometry(0.16, 0.05, 6, 12, Math.PI * 1.3), mat(c, { emissive: c, emissiveIntensity: 0.25 })); arc.position.y = 0.25; arc.rotation.z = -0.6; q.add(arc);
    q.add(box(0.08, 0.14, 0.08, arc.material, 0.02, 0.04, 0));
    const dot = mesh(new T.SphereGeometry(0.06, 6, 5), arc.material); dot.position.y = -0.14; q.add(dot);
    return q;
  }
  function labelSign(text, w = 2.2, bg = "#fbf8f2", fg = "#23384a") {
    const t = canvasTex(256, 64), c = t.ctx;
    c.fillStyle = bg; c.fillRect(0, 0, 256, 64); c.strokeStyle = "#d6b97c"; c.lineWidth = 6; c.strokeRect(3, 3, 250, 58);
    c.fillStyle = fg; c.font = "bold 28px 'Noto Sans TC','Microsoft JhengHei',sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(text, 128, 34);
    t.tex.needsUpdate = true;
    return new T.Mesh(new T.PlaneGeometry(w, w / 4), new T.MeshBasicMaterial({ map: t.tex }));
  }

  function planShape(points) {
    const s=new T.Shape();points.forEach(([x,z],i)=>i?s.lineTo(x,-z):s.moveTo(x,-z));s.closePath();return s;
  }
  function planBlock(points,h,color,top=0) {
    const geo=new T.ExtrudeGeometry(planShape(points),{depth:h,bevelEnabled:false,curveSegments:1,steps:1});geo.rotateX(-Math.PI/2);
    const o=mesh(geo,mat(color));o.position.y=top-h;o.receiveShadow=true;return o;
  }
  function planDeck(ctx,points,color,texture) {
    ctx.u.plan=points;ctx.u.docks=[];ctx.u.obstacles=[];
    ctx.g.add(planBlock(points,0.55,color));
    const geo=new T.ShapeGeometry(planShape(points));geo.rotateX(-Math.PI/2);
    const p=geo.attributes.position,uv=geo.attributes.uv;for(let i=0;i<p.count;i++)uv.setXY(i,(p.getX(i)+7)/14,(p.getZ(i)+7)/14);uv.needsUpdate=true;
    const floor=new T.Mesh(geo,new T.MeshStandardMaterial({map:texture,roughness:0.88}));floor.position.y=0.014;floor.receiveShadow=true;ctx.g.add(floor);
    ctx.gaps.forEach(a=>{
      const start=P(a,ctx.r*0.48),end=P(a,ctx.r*0.99),len=start.distanceTo(end),mid=start.clone().add(end).multiplyScalar(0.5);
      const dock=box(2.7,0.52,len,mat(PAL.white),mid.x,-0.25,mid.z);dock.rotation.y=a;ctx.g.add(dock);
      ctx.u.docks.push({a:{x:start.x,z:start.z},b:{x:end.x,z:end.z},half:1.33});
      [-1.23,1.23].forEach(side=>{const strip=box(0.06,0.025,len,mat(PAL.gold),0,0,0);strip.position.set(mid.x+Math.cos(a)*side,0.03,mid.z-Math.sin(a)*side);strip.rotation.y=a;ctx.g.add(strip);});
    });
  }
  function planBoundary(ctx,points,wallColor,height=3.7,kind="cabin") {
    const wall=mat(wallColor),ink=mat(PAL.slate),gold=mat(PAL.gold),glass=mat(0xb6dce6,{transparent:true,opacity:0.62,roughness:0.25,side:T.DoubleSide});
    for(let i=0;i<points.length;i++){
      const A=points[i],B=points[(i+1)%points.length],dx=B[0]-A[0],dz=B[1]-A[1],len=Math.hypot(dx,dz),n=Math.ceil(len/(kind==="home"?3.25:kind==="workshop"?2.25:1.7));
      for(let k=0;k<n;k++){
        const t=(k+0.5)/n,x=A[0]+dx*t,z=A[1]+dz*t,W=len/n;
        if(nearGap(ctx,Math.atan2(x,z),0.32))continue;
        const seg=new T.Group();seg.position.set(x,0,z);seg.rotation.y=-Math.atan2(dz,dx);ctx.g.add(seg);
        const isBack=z<-3.2,isSide=Math.abs(x)>5.7&&z<0.1;
        if(isBack||isSide){
          const solid=kind==="workshop"||(kind==="home"&&(k===0||k===n-1));
          if(solid){
            seg.add(box(W+0.015,height,0.19,wall,0,height/2,0));
            if(kind==="workshop"){
              seg.add(box(W*0.72,height*0.42,0.04,mat(0xd5c4a3),0,height*0.60,0.12));
              for(let i=0;i<3;i++)seg.add(box(W*0.55,0.025,0.03,gold,0,height*0.46+i*0.25,0.155));
            }
          } else if(kind==="lab"){
            seg.add(box(W+0.015,1.65,0.19,wall,0,0.825,0));seg.add(box(W+0.015,0.85,0.19,wall,0,height-0.425,0));
            seg.add(box(W-0.13,height-2.5,0.06,glass,0,1.65+(height-2.5)/2,0));
          } else {
            seg.add(box(W+0.015,0.9,0.19,wall,0,0.45,0));seg.add(box(W+0.015,0.4,0.19,wall,0,height-0.2,0));
            seg.add(box(W-0.13,height-1.3,0.06,glass,0,0.9+(height-1.3)/2,0));
            if(kind==="home")seg.add(box(0.08,height-1.3,0.11,ink,0,0.9+(height-1.3)/2,0.02));
          }
          seg.add(box(0.08,height,0.25,ink,-W/2,height/2,0));seg.add(box(W+0.07,0.13,0.28,gold,0,height+0.02,0));
        } else {
          seg.add(box(W,0.09,0.12,ink,0,1.24,0));seg.add(box(0.055,1.2,0.055,gold,0,0.62,0));
        }
      }
    }
  }

  const landmarks = {
    // ① 漂浮的小安租屋處：剖開來的一間套房，下面是整棟樓被切下來的一塊
    ask(ctx) {
      const g = ctx.g, u = ctx.u;
      const cream = mat(PAL.white), navy = mat(PAL.slate), gold = mat(PAL.gold), concrete = mat(0xc9c2b5);
      const glass = mat(0xc1e3e9, { transparent: true, opacity: 0.36, roughness: 0.18, depthWrite: false });
      const wood = floorTex((c,s) => {
        c.fillStyle = "#c9976a"; c.fillRect(0,0,s,s);
        for (let y=0; y<s; y+=32) { c.fillStyle = y%64 ? "#d5ab7e" : "#deb98b"; c.fillRect(0,y,s,30); c.fillStyle = "#b9885e"; for(let x=(y*3)%112; x<s; x+=112) c.fillRect(x,y,2,32); }
      });
      const tile = floorTex((c,s) => {
        c.fillStyle = "#92bac4"; c.fillRect(0,0,s,s); c.strokeStyle = "#d9e8e5"; c.lineWidth=3;
        for(let i=0;i<=s;i+=32) { c.beginPath();c.moveTo(i,0);c.lineTo(i,s);c.moveTo(0,i);c.lineTo(s,i);c.stroke(); }
      });
      g.add(box(13.2,0.5,10.4,concrete,0,-0.25,0));
      g.add(box(13.4,0.14,10.6,navy,0,-0.57,0));
      const room = new T.Mesh(new T.PlaneGeometry(7.2,10.2),new T.MeshStandardMaterial({map:wood,roughness:0.88}));
      room.rotation.x=-Math.PI/2;room.position.set(-3,0.012,0);room.receiveShadow=true;g.add(room);
      const balcony = new T.Mesh(new T.PlaneGeometry(6,10.2),new T.MeshStandardMaterial({map:tile,roughness:0.8}));
      balcony.rotation.x=-Math.PI/2;balcony.position.set(3.6,0.016,0);balcony.receiveShadow=true;g.add(balcony);
      // 剖面背牆保留真正的窗洞，前方敞開讓玩家看見室內。
      g.add(box(7.2,1.0,0.3,cream,-3,0.5,-5.05));
      g.add(box(7.2,0.7,0.3,cream,-3,3.65,-5.05));
      [-6.45,-3.4,0.45].forEach(x=>g.add(box(0.28,2.8,0.3,cream,x,2.25,-5.05)));
      [-4.95,-1.5].forEach(x=>{
        g.add(box(2.6,2.25,0.06,glass,x,2.15,-5.04));
        g.add(box(0.07,2.25,0.12,navy,x,2.15,-4.96));
        g.add(box(2.85,0.12,0.5,navy,x,1.05,-4.88));
      });
      g.add(box(0.28,4.0,10.4,cream,-6.5,2,0));
      g.add(box(0.34,0.16,10.5,gold,-6.5,4.05,0));
      g.add(box(7.3,0.16,0.4,gold,-3,4.05,-5.05));
      // 室內與陽台的落地窗，中央留一個寬敞的出入口。
      [[-2.75,4.5],[3.95,2.3]].forEach(([z,d])=>{
        g.add(box(0.07,3.2,d,glass,0.62,1.7,z));
        [z-d/2,z+d/2].forEach(p=>g.add(box(0.12,3.5,0.12,navy,0.62,1.75,p)));
        g.add(box(0.16,0.12,d,navy,0.62,3.5,z));
      });
      g.add(box(0.22,0.055,2.8,gold,0.62,0.04,1.3));
      const rug=box(3.7,0.035,2.5,mat(0xe7a095),-2.5,0.035,0.05);g.add(rug);
      [-4.1,-0.9].forEach(x=>g.add(box(0.04,0.04,2.2,cream,x,0.058,0.05)));
      const sofa=new T.Group();sofa.position.set(-4.15,0,-1.9);g.add(sofa);
      const blue=mat(0x6b91a2);
      sofa.add(box(2.5,0.48,1.0,blue,0,0.42,0));sofa.add(box(2.5,0.95,0.22,blue,0,0.8,-0.47));
      [-1.23,1.23].forEach(x=>sofa.add(box(0.23,0.72,1.05,blue,x,0.6,0)));
      sofa.add(box(0.6,0.5,0.16,mat(PAL.coral),0.65,0.95,-0.25));
      const tvG=new T.Group();tvG.position.set(-2.5,0,-4.45);g.add(tvG);
      tvG.add(box(2.6,0.6,0.6,mat(0x97704e),0,0.3,0));
      tvG.add(box(1.9,1.1,0.12,navy,0,1.15,0.05));
      const tv=canvasTex(96,56);tv.ctx.fillStyle="#dfba92";tv.ctx.fillRect(0,0,96,56);
      tv.ctx.fillStyle="#91b6c4";tv.ctx.fillRect(5,5,53,46);tv.ctx.fillStyle="#ef8577";tv.ctx.fillRect(64,15,25,36);tv.tex.needsUpdate=true;
      const screen=new T.Mesh(new T.PlaneGeometry(1.7,0.92),new T.MeshBasicMaterial({map:tv.tex}));screen.position.set(0,1.15,0.13);tvG.add(screen);
      const sh=shelf();sh.position.set(-5.9,0,-3.4);sh.rotation.y=Math.PI/2;g.add(sh);
      const frame=box(0.06,0.95,1.2,gold,-6.32,2.5,1.3);g.add(frame);
      g.add(box(0.08,0.75,1.0,mat(PAL.coral),-6.27,2.5,1.3));
      // 陽台欄杆只在實際邊界上，右側水道入口空出來。
      function rail(x1,z1,x2,z2) {
        const len=Math.hypot(x2-x1,z2-z1),rr=new T.Group();rr.position.set((x1+x2)/2,0,(z1+z2)/2);rr.rotation.y=Math.atan2(x2-x1,z2-z1);g.add(rr);
        rr.add(box(0.12,0.12,len,navy,0,1.38,0));rr.add(box(0.1,0.1,len,gold,0,0.2,0));
        for(let z=-len/2;z<=len/2+0.01;z+=0.65) rr.add(box(0.055,1.25,0.055,cream,0,0.75,z));
      }
      rail(0.7,-5.05,6.5,-5.05);rail(0.7,5.05,6.5,5.05);rail(6.5,-5.05,6.5,-0.25);rail(6.5,2.65,6.5,5.05);
      const ac=acUnit();ac.position.set(0.95,2.6,-3.8);ac.rotation.y=Math.PI/2;g.add(ac);
      const pipe=mesh(new T.CylinderGeometry(0.105,0.105,6.8,8),navy);pipe.position.set(0.95,0.2,-4.8);g.add(pipe);
      const elbow=mesh(new T.TorusGeometry(0.32,0.1,6,12,Math.PI/2),gold);elbow.position.set(1.27,-3.05,-4.8);elbow.rotation.z=Math.PI;g.add(elbow);
      g.add(box(1.5,0.85,0.95,cream,4.8,0.65,-3.7));g.add(box(1.65,0.1,1.1,navy,4.8,1.12,-3.7));
      const plant=pottedPlant(rand(6));plant.position.set(4.9,0,3.9);g.add(plant);
      const sandals=mat(PAL.coral);[2.7,3.1].forEach(x=>g.add(box(0.25,0.08,0.55,sandals,x,0.06,3.9)));
      const basket=laundryBasket(1.05);basket.position.set(-2.5,0.06,0.1);g.add(basket);u.cover.push({o:basket,need:"ask"});
      const piles=new T.Group();g.add(piles);u.reveal.push({o:piles,need:"ask"});
      [[0x34495e,-3.2],[0xf7f1e6,-1.6]].forEach(([color,x])=>{
        for(let k=0;k<5;k++){const cloth=mesh(new T.DodecahedronGeometry(0.27,0),mat(k%2?color:shade(color,0.9)));cloth.scale.set(1.3,0.5,1);cloth.position.set(x+Math.cos(k*2)*0.28,0.16+(k>2?0.16:0),0.1+Math.sin(k*2)*0.25);piles.add(cloth);}
      });
      const empty=laundryBasket(0.75,PAL.bubble,[]);empty.position.set(-1,0.05,-0.9);piles.add(empty);
      // 矩形建築底座延續樓上的立面，不再保留圓盤。
      const under=new T.Group();under.position.y=-0.65;g.add(under);
      under.add(box(12.8,2.5,9.8,concrete,0,-1.25,0));
      under.add(box(9.6,2.5,8.6,mat(0xa4b3b5),-1.4,-3.75,-0.3));
      [-4.8,-1.6,1.6,4.8].forEach(x=>{
        under.add(box(1.8,1.3,0.07,mat(0x6a91a3),x,-1.15,4.94));
        under.add(box(1.9,0.1,0.3,cream,x,-1.8,5));
      });
      [-4.7,-1.5,1.7].forEach(x=>under.add(box(1.7,1.2,0.08,mat(0x547c8b),x,-3.6,4.04)));
      [-5.7,5.7].forEach(x=>under.add(box(0.2,3.0,0.25,gold,x,-1.5,4.95)));
    },

    // ② 水滴觀察站：半透明的大水滴就是建築，地板是一圈一圈的波紋
    define(ctx) {
      const g = ctx.g, u = ctx.u, R = ctx.r;
      slab(ctx, 0xbfe9f5, 0.5).material.setValues({ transparent: true, opacity: 0.9 });
      floorDisc(ctx, floorTex((c, s) => {
        const gr = c.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2); gr.addColorStop(0, "#e8f7fb"); gr.addColorStop(1, "#9fd8ea"); c.fillStyle = gr; c.fillRect(0, 0, s, s);
        c.strokeStyle = "rgba(255,255,255,.8)"; for (let r0 = 14; r0 < s / 2; r0 += 15) { c.lineWidth = r0 % 30 ? 1.5 : 3; c.beginPath(); c.arc(s / 2, s / 2, r0, 0, 7); c.stroke(); }
      }));
      const glassRim = mesh(new T.TorusGeometry(R * 0.97, 0.2, 8, 64), mat(0xd8f2fa, { transparent: true, opacity: 0.6, roughness: 0.1 }), false); glassRim.rotation.x = Math.PI / 2; glassRim.position.y = 0.12; g.add(glassRim);
      alongRim(ctx, 0, 2 * Math.PI - 0.01, 24 * D, R * 0.97, () => { const d = drop(rand(5)); d.scale.setScalar(0.9); d.position.y = 0.2; return d; }, 0.28);
      // 大水滴：寬底尖頂
      const H = 8.2, RR = 3.9, prof = [];
      for (let k = 0; k <= 28; k++) { const t = k / 28; prof.push(new T.Vector2(Math.max(0.001, RR * Math.pow(1 - t, 0.85) * Math.sqrt(Math.min(1, (t + 0.2) / 0.5))), t * H)); }
      const domeM = new T.MeshStandardMaterial({ color: 0x9fdcf0, transparent: true, opacity: 0.34, roughness: 0.05, metalness: 0.1, depthWrite: false, side: T.DoubleSide });
      const dome = new T.Mesh(new T.LatheGeometry(prof, 32), domeM); dome.position.set(0, 0, -0.6); g.add(dome);
      const base = mesh(new T.TorusGeometry(RR * Math.sqrt(0.4) * 1.0, 0.12, 6, 40), mat(PAL.gold, { roughness: 0.35, metalness: 0.35 })); base.rotation.x = Math.PI / 2; base.position.set(0, 0.08, -0.6); g.add(base);
      // 水滴的骨架：幾條金色的肋條和兩圈白色的環，看起來才像一棟建築
      const ribM = mat(PAL.gold, { roughness: 0.35, metalness: 0.35 });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        const pts = prof.filter((_, i) => i % 2 === 0).map(v => new T.Vector3(Math.sin(a) * v.x, v.y, Math.cos(a) * v.x - 0.6));
        g.add(mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 24, 0.06, 5), ribM, false));
      }
      [0.3, 0.6].forEach(t => { const i = Math.round(t * 28), rr = prof[i].x; const hoop = mesh(new T.TorusGeometry(rr, 0.05, 5, 40), mat(0xffffff), false); hoop.rotation.x = Math.PI / 2; hoop.position.set(0, prof[i].y, -0.6); g.add(hoop); });
      const tip = mesh(new T.SphereGeometry(0.25, 8, 6), mat(0xffffff, { emissive: 0x8fd3ea, emissiveIntensity: 0.8 }), false); tip.position.set(0, H + 0.1, -0.6); g.add(tip);
      const hi = box(0.08, 3.2, 0.02, mat(0xffffff, { transparent: true, opacity: 0.6 }), -1.9, 3.2, 1.6, false); hi.rotation.z = 0.15; g.add(hi);
      // 裡面：放大鏡
      const plinth = mesh(new T.CylinderGeometry(0.9, 1.05, 0.5, 10), mat(PAL.white)); plinth.position.set(0, 0.25, -0.6); g.add(plinth);
      const lens = new T.Group(); lens.position.set(0, 2.9, -0.6); g.add(lens);
      const ring0 = mesh(new T.TorusGeometry(1.35, 0.13, 8, 36), mat(PAL.gold, { roughness: 0.35, metalness: 0.35 })); lens.add(ring0);
      const glass = new T.Mesh(new T.CircleGeometry(1.3, 32), new T.MeshStandardMaterial({ color: 0xd8f2fa, transparent: true, opacity: 0.35, roughness: 0.05, side: T.DoubleSide, depthWrite: false })); lens.add(glass);
      const handle = mesh(new T.CylinderGeometry(0.13, 0.16, 1.9, 8), mat(PAL.goldD)); handle.position.set(0.95, -1.75, 0); handle.rotation.z = 0.55; lens.add(handle);
      // 還沒說清楚：鏡片裡一團霧；說清楚之後：看得到那條濕褲子
      const fog = new T.Group(); lens.add(fog); u.cover.push({ o: fog, need: "define" });
      for (let k = 0; k < 7; k++) { const f = mesh(new T.IcosahedronGeometry(0.32 + (k % 3) * 0.1, 0), mat(0xeef2f3, { transparent: true, opacity: 0.9 }), false); f.position.set(Math.cos(k * 2.1) * 0.6, Math.sin(k * 1.7) * 0.6, 0.05); fog.add(f); }
      const wet = pants(0x5b7fa6, true); wet.position.set(0, 0.62, 0.05); wet.scale.setScalar(1.0); lens.add(wet); u.reveal.push({ o: wet, need: "define" });
      // 地上一直擴散的漣漪
      const ripples = [0, 1, 2].map(k => { const m = new T.Mesh(new T.RingGeometry(0.9, 1.0, 40), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(0, 0.03, -0.6); g.add(m); return m; });
      // 底下：倒過來的大水滴，尖端一直滴水
      const under = new T.Group(); under.position.y = -0.5; g.add(under);
      const up = []; for (let k = 0; k <= 20; k++) { const t = k / 20; up.push(new T.Vector2(Math.max(0.001, R * 0.94 * Math.pow(1 - t, 0.7)), -t * 9)); }
      under.add(new T.Mesh(new T.LatheGeometry(up.reverse(), 32), new T.MeshStandardMaterial({ color: 0x7cc8e2, transparent: true, opacity: 0.55, roughness: 0.1 })));
      const core = mesh(new T.ConeGeometry(2.2, 6, 16), mat(0x3f97c0, { transparent: true, opacity: 0.6 }), false); core.rotation.x = Math.PI; core.position.y = -3.2; under.add(core);
      const fall = mesh(new T.SphereGeometry(0.3, 8, 6), mat(0x8fd3ea, { transparent: true, opacity: 0.9 }), false); under.add(fall);
      u.tick = (t) => {
        fog.children.forEach((f, k) => { f.position.x = Math.cos(k * 2.1 + t * 0.5) * 0.6; });
        ripples.forEach((m, k) => { const f = (t * 0.25 + k / 3) % 1; m.scale.setScalar(1 + f * 5.2); m.material.opacity = 0.55 * (1 - f); });
        const f = (t * 0.4) % 1; fall.position.y = -9.2 - f * 5; fall.material.opacity = 0.9 * (1 - f);
        lens.rotation.y = Math.sin(t * 0.4) * 0.25;
      };
    },

    // ③ 三方案實驗工坊：三台長得完全不一樣的機器，想出來之前關鍵的地方是問號
    ideate(ctx) {
      const g = ctx.g, u = ctx.u, R = ctx.r;
      const outline=[[-6.1,5.7],[6.1,5.7],[6.1,-3.4],[3.4,-3.4],[3.4,-6.1],[-3.4,-6.1],[-3.4,-3.4],[-6.1,-3.4]];
      planDeck(ctx,outline,0xd5c5ac,floorTex((c,s)=>{for(let i=0;i<16;i++)for(let j=0;j<16;j++){c.fillStyle=(i+j)%2?"#f7f1e6":"#c2dde2";c.fillRect(i*16,j*16,16,16);}}));
      planBoundary(ctx,outline,0xf0e6d4,3.8,"workshop");
      [-4.0,4.0].forEach((x,i)=>{
        const bay=new T.Group();bay.position.set(x,0,-0.4);g.add(bay);
        const h=i?4.0:4.75,metal=mat(PAL.slate),roofM=mat(i?0x8ab5c0:0xd79586),trim=mat(PAL.gold);
        [-1.5,1.5].forEach(dx=>{
          bay.add(box(0.16,h-0.15,0.16,metal,dx,(h-0.15)/2,-1.9));
          bay.add(box(0.12,0.15,3.0,metal,dx,h-0.17,-1.2));
          const brace=box(0.10,1.0,0.12,metal,dx,h-0.65,-1.58);brace.rotation.x=-0.75;bay.add(brace);
        });
        const roof=box(3.85,0.22,3.3,roofM,0,h,-1.2);roof.rotation.x=-0.08;bay.add(roof);
        const fascia=box(3.85,0.31,0.18,trim,0,h-0.26,0.44);bay.add(fascia);
        for(let k=0;k<6;k++){const rib=box(0.045,0.035,3.25,trim,-1.62+k*0.65,h+0.13,-1.2,false);rib.rotation.x=-0.08;bay.add(rib);}
        [-1.5,1.5].forEach(dx=>ctx.u.obstacles.push({x:x+dx,z:-2.3,r:0.17}));
      });
      const spots = [270 * D, 180 * D, 90 * D].map(a => nearGap(ctx, a, 0.5) ? a + 0.6 : a);
      const pad = (c) => { const p = mesh(new T.CylinderGeometry(1.3, 1.35, 0.14, 20), mat(c)); p.position.y = 0.07; return p; };
      // A 自動調整：高高的機器，正面一顆大旋鈕
      const A = new T.Group(); A.position.copy(P(spots[0], 3.7)); A.rotation.y = Math.atan2(-A.position.x, 4 - A.position.z); g.add(A); A.add(pad(PAL.coral));
      A.add(box(1.5, 3.0, 1.2, mat(0xf5f6f4), 0, 1.6, 0));
      A.add(box(1.56, 0.3, 1.26, mat(PAL.coral), 0, 3.15, 0));
      const pipe = mesh(new T.CylinderGeometry(0.1, 0.1, 1.2, 6), mat(PAL.gold)); pipe.position.set(0.45, 3.8, 0); A.add(pipe);
      const dialA = new T.Group(); dialA.position.set(0, 2.0, 0.62); A.add(dialA); u.reveal.push({ o: dialA, need: "ideate" });
      const dA = mesh(new T.CylinderGeometry(0.5, 0.5, 0.14, 20), mat(PAL.gold, { metalness: 0.3, roughness: 0.4 })); dA.rotation.x = Math.PI / 2; dialA.add(dA);
      const pA = box(0.08, 0.42, 0.04, mat(PAL.coral, { emissive: 0xef8577, emissiveIntensity: 0.6 }), 0, 0.18, 0.09, false); dialA.add(pA); u.ptrA = dialA;
      const qA = questionMark(); qA.position.set(0, 2.0, 0.7); A.add(qA); u.cover.push({ o: qA, need: "ideate" });
      // B 先分類：上面一個漏斗，分成深淺兩邊流下來
      const B = new T.Group(); B.position.copy(P(spots[1], 3.9)); B.rotation.y = Math.atan2(-B.position.x, 4 - B.position.z); g.add(B); B.add(pad(PAL.gold));
      const hop = mesh(new T.ConeGeometry(1.0, 1.0, 4), mat(PAL.bubble)); hop.rotation.x = Math.PI; hop.rotation.y = Math.PI / 4; hop.position.y = 2.6; B.add(hop);
      [-0.9, 0.9].forEach(x => B.add(box(0.1, 2.4, 0.1, mat(PAL.slate), x, 1.2, 0)));
      [-1, 1].forEach(s => { const ch = box(0.4, 0.08, 1.2, mat(0xffffff), s * 0.5, 1.6, 0); ch.rotation.z = s * 0.6; B.add(ch); });
      const binD = laundryBasket(1.0, 0x5f7489, []), binL = laundryBasket(1.0, 0xf6c9c1, []); binD.position.set(-0.95, 0.14, 0.2); binL.position.set(0.95, 0.14, 0.2); B.add(binD); B.add(binL);
      const fillB = new T.Group(); B.add(fillB); u.reveal.push({ o: fillB, need: "ideate" });
      [[0x2f3c4f, -0.95], [0x3d4f6b, -0.8], [0xffffff, 0.95], [0xfff4d6, 1.1]].forEach(([c, x], i) => { const l = mesh(new T.DodecahedronGeometry(0.2, 0), mat(c)); l.scale.y = 0.6; l.position.set(x, 0.42, 0.2 + (i % 2) * 0.1); fillB.add(l); });
      const qB = questionMark(); qB.position.set(0, 2.0, 0.0); qB.scale.setScalar(1.3); B.add(qB); u.cover.push({ o: qB, need: "ideate" });
      // C 洗後檢查：曬衣架加一盞檢查燈和濕度錶
      const C = new T.Group(); C.position.copy(P(spots[2], 3.7)); C.rotation.y = Math.atan2(-C.position.x, 4 - C.position.z); g.add(C); C.add(pad(PAL.bubble));
      [-0.55, 0.55].forEach(x => { [0.25, -0.25].forEach(rx => { const leg = box(0.05, 1.7, 0.05, mat(PAL.slateL), x, 0.9, 0); leg.rotation.x = rx; C.add(leg); }); });
      const bar = mesh(new T.CylinderGeometry(0.03, 0.03, 1.2, 5), mat(0xffffff)); bar.rotation.z = Math.PI / 2; bar.position.y = 1.7; C.add(bar);
      const arm = new T.Group(); arm.position.set(0.9, 0, -0.3); C.add(arm);
      arm.add(box(0.08, 2.6, 0.08, mat(PAL.gold), 0, 1.3, 0)); const ab = box(0.9, 0.08, 0.08, mat(PAL.gold), -0.4, 2.6, 0); arm.add(ab);
      const lampM = mat(0xfff1d6, { emissive: 0xffd08a, emissiveIntensity: 0.6 }); const lc = mesh(new T.ConeGeometry(0.25, 0.3, 8, 1, true), lampM, false); lc.position.set(-0.8, 2.42, 0); arm.add(lc);
      const showC = new T.Group(); C.add(showC); u.reveal.push({ o: showC, need: "ideate" });
      const pw = pants(0x5b7fa6, true); pw.position.set(0, 1.7, 0); pw.scale.setScalar(0.85); showC.add(pw);
      const meter = mesh(new T.CylinderGeometry(0.24, 0.24, 0.06, 16), mat(0xffffff)); meter.rotation.x = Math.PI / 2; meter.position.set(-0.95, 1.0, 0.25); showC.add(meter);
      const needle = box(0.03, 0.2, 0.02, mat(PAL.coral), -0.95, 1.05, 0.3, false); showC.add(needle);
      const qC = questionMark(); qC.position.set(0, 1.3, 0.1); qC.scale.setScalar(1.2); C.add(qC); u.cover.push({ o: qC, need: "ideate" });
      [A,B,C].forEach(o=>ctx.u.obstacles.push({x:o.position.x,z:o.position.z,r:1.3}));
      // 吊掛工坊的桁架與兩個小齒輪。
      const under = new T.Group(); under.position.y = -0.55; g.add(under);
      under.add(box(11.8,0.55,5.5,mat(PAL.slate),0,-0.4,0));
      [-4.6,4.6].forEach(x=>under.add(box(0.45,2.2,4.8,mat(PAL.slateL),x,-1.5,0)));
      const gears = [[1.5,0.55,-2.9],[1.1,0.4,-3.75]].map(([rr, h, y], i) => {
        const ge = new T.Group(); ge.position.set(i?-3.8:3.5,y,0); under.add(ge);
        ge.add(mesh(new T.CylinderGeometry(rr, rr, h, 24), mat(i % 2 ? PAL.slateL : PAL.slate)));
        const n = Math.round(rr * 4); for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; const tt = box(0.5, h * 0.8, 0.5, mat(i % 2 ? PAL.gold : PAL.goldD), Math.sin(a) * rr, 0, Math.cos(a) * rr); tt.rotation.y = a; ge.add(tt); }
        return ge;
      });
      under.add(box(7.5,0.32,3.3,mat(PAL.goldD),0,-2.6,0));
      u.tick = (t) => { gears.forEach((ge, i) => { ge.rotation.y = t * (i % 2 ? -0.25 : 0.25) * (1 + i * 0.3); }); if (u.ptrA) u.ptrA.rotation.z = t * 1.4; needle.rotation.z = Math.sin(t * 1.3) * 0.6; };
    },

    // ④ 洗衣機研發中心：測試台上一台大洗衣機（舊版原型），上面把它的面板放大來看
    build(ctx) {
      const g = ctx.g, u = ctx.u, R = ctx.r;
      const outline=[[-6.4,-5.8],[6.4,-5.8],[6.4,3.4],[4.0,5.8],[-4.0,5.8],[-6.4,3.4]];
      planDeck(ctx,outline,0x869fac,floorTex((c,s)=>{c.fillStyle="#b4ccd4";c.fillRect(0,0,s,s);c.strokeStyle="#dce9e8";c.lineWidth=1.3;for(let i=0;i<=s;i+=16){c.beginPath();c.moveTo(i,0);c.lineTo(i,s);c.moveTo(0,i);c.lineTo(s,i);c.stroke();}}));
      planBoundary(ctx,outline,0xd9e5e4,4.7,"lab");
      [-5.4,5.4].forEach(x=>{
        g.add(box(0.5,5.6,1.2,mat(PAL.white),x,2.8,-4.65));
        const brace=box(0.25,2.8,0.28,mat(PAL.gold),x,4.95,-3.6);brace.rotation.x=-0.6;g.add(brace);
      });
      g.add(box(11.3,0.34,1.1,mat(PAL.white),0,5.75,-4.75));
      ctx.u.obstacles.push({x:0,z:-1.6,r:2.5},{x:-4.1,z:0.6,w:1.3,d:2.6},{x:4.1,z:0.4,w:1.05,d:1.6});
      [-5.4,5.4].forEach(x=>ctx.u.obstacles.push({x,z:-4.65,w:0.72,d:1.45}));
      [-2.9,2.9].forEach(x=>ctx.u.obstacles.push({x,z:-2.8,r:0.23}));
      // 測試台＋大洗衣機
      const stand = mesh(new T.CylinderGeometry(2.3, 2.4, 0.4, 6), mat(PAL.slate)); stand.position.set(0, 0.2, -1.6); g.add(stand);
      const ring0 = mesh(new T.TorusGeometry(2.3, 0.06, 4, 6), mat(PAL.gold)); ring0.rotation.x = Math.PI / 2; ring0.position.set(0, 0.41, -1.6); g.add(ring0);
      const big = washer(2.65, "45"); big.position.set(0, 0.4, -1.6); g.add(big); u.washer = big.userData.washer;
      [-0.46,0.46].forEach(x=>big.add(box(0.045,1.05,0.025,mat(PAL.goldD),x,0.74,0.515)));
      // 龍門架上掛一塊放大的面板
      [-2.9, 2.9].forEach(x => g.add(box(0.3, 6.2, 0.3, mat(PAL.slate), x, 3.1, -2.8)));
      g.add(box(6.1, 0.32, 0.34, mat(PAL.slate), 0, 6.25, -2.8));
      const pnl = canvasTex(512, 200), c = pnl.ctx;
      const drawPanel = (digits) => {
        c.fillStyle = "#d6b97c"; c.fillRect(0, 0, 512, 200); c.fillStyle = "#c4a566"; c.fillRect(0, 160, 512, 40);
        c.fillStyle = "#16242c"; c.fillRect(150, 30, 210, 110);
        c.fillStyle = "#7fe7ff"; c.font = "bold 84px monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(digits, 240, 88);
        c.font = "bold 24px 'Noto Sans TC','Microsoft JhengHei',sans-serif"; c.fillText("分", 335, 118);
        c.fillStyle = "#23384a"; c.font = "bold 24px 'Noto Sans TC','Microsoft JhengHei',sans-serif";
        ["洗衣", "清洗", "脫水"].forEach((t, i) => { c.textAlign = "left"; c.fillText(t, 30, 50 + i * 40); c.fillStyle = i === 2 ? "#47d6ff" : "#7a6a4a"; c.beginPath(); c.arc(110, 50 + i * 40, 8, 0, 7); c.fill(); c.fillStyle = "#23384a"; });
        c.fillStyle = "#ffffff"; c.beginPath(); c.arc(440, 85, 46, 0, 7); c.fill(); c.strokeStyle = "#4aa8ff"; c.lineWidth = 7; c.stroke();
        c.fillStyle = "#23384a"; c.textAlign = "center"; c.font = "bold 22px 'Noto Sans TC','Microsoft JhengHei',sans-serif"; c.fillText("起動", 440, 74); c.fillText("暫停", 440, 100);
        c.font = "bold 20px 'Noto Sans TC','Microsoft JhengHei',sans-serif"; c.fillText("洗程　水位　預約", 256, 180);
        pnl.tex.needsUpdate = true;
      };
      drawPanel("45"); u.drawPanel = drawPanel;
      const board = new T.Mesh(new T.PlaneGeometry(5.0, 1.95), new T.MeshBasicMaterial({ map: pnl.tex })); board.position.set(0, 4.95, -2.62); g.add(board);
      g.add(box(5.2, 2.15, 0.12, mat(PAL.slate), 0, 4.95, -2.7));
      const cable = mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(0.9, 3.6, -2.0), new T.Vector3(1.6, 3.4, -2.4), new T.Vector3(2.0, 3.9, -2.7)]), 12, 0.06, 5), mat(PAL.coral)); g.add(cable);
      // 工作台、藍圖
      const gs = Math.sign(ctx.gaps.reduce((a, b) => a + Math.sin(b), 0)) || 1;
      const bench = new T.Group(); bench.position.set(-4.1, 0, 0.6); bench.rotation.y = Math.PI / 2; g.add(bench);
      bench.add(box(2.2, 0.12, 0.9, mat(0x8a6a4e), 0, 1.0, 0)); [-1, 1].forEach(x => [-0.35, 0.35].forEach(z => bench.add(box(0.08, 1.0, 0.08, mat(PAL.slate), x, 0.5, z))));
      bench.add(box(0.6, 0.3, 0.3, mat(PAL.coral), -0.5, 1.21, 0)); const lp = box(0.5, 0.06, 0.35, mat(PAL.slate), 0.5, 1.09, 0); bench.add(lp);
      const sm = washer(0.35, "52"); sm.position.set(0.5, 1.06, -0.1); bench.add(sm);
      const easel = new T.Group(); easel.position.set(4.1, 0, 0.4); easel.rotation.y = -Math.PI / 2; g.add(easel);
      [-0.55, 0.55].forEach(x => easel.add(box(0.05, 1.8, 0.05, mat(0x8a6a4e), x, 0.9, 0)));
      const bp = canvasTex(96, 72), b = bp.ctx;
      b.fillStyle = "#3d78a8"; b.fillRect(0, 0, 96, 72); b.strokeStyle = "rgba(255,255,255,.85)"; b.lineWidth = 2;
      b.strokeRect(30, 14, 34, 46); b.strokeRect(30, 14, 34, 10); b.beginPath(); b.arc(47, 42, 11, 0, 7); b.stroke(); bp.tex.needsUpdate = true;
      const sheet = new T.Mesh(new T.PlaneGeometry(1.3, 1.0), new T.MeshStandardMaterial({ map: bp.tex, roughness: 0.8 })); sheet.position.set(0, 1.4, 0.04); easel.add(sheet);
      easel.add(box(1.4, 1.1, 0.04, mat(0x8a6a4e), 0, 1.4, 0));
      const under=new T.Group();under.position.y=-0.55;g.add(under);
      under.add(planBlock([[-5.7,-4.8],[5.7,-4.8],[5.7,2.4],[3.7,4.6],[-3.7,4.6],[-5.7,2.4]],3.6,PAL.slate));
      [-4.4,4.4].forEach(x=>{
        under.add(box(0.65,5.0,1.7,mat(PAL.gold),x,-2.3,-1.0));
        for(let j=0;j<4;j++)under.add(box(0.75,0.12,1.9,mat(PAL.white),x,-0.8-j*0.9,-1.0));
      });
      [-1.8,1.8].forEach(x=>{const vent=mesh(new T.CylinderGeometry(0.85,0.85,0.18,12),mat(PAL.slateL));vent.rotation.x=Math.PI/2;vent.position.set(x,-2.0,4.2);under.add(vent);});
      const blink = mesh(new T.SphereGeometry(0.22, 8, 6), mat(0xffffff, { emissive: 0xef8577, emissiveIntensity: 1 }), false); blink.position.y = -4.3; under.add(blink);
      u.tick = (t) => { blink.material.emissiveIntensity = (Math.sin(t * 3) > 0) ? 1.2 : 0.1; };
    },

    // ⑤ 真正的陽台：後面是公寓外牆（有冷氣、排水管），前面是欄杆，底下是一層一層的陽台
    test(ctx) {
      const g = ctx.g, u = ctx.u, R = ctx.r;
      const outline=[[-6.5,-5.2],[6.5,-5.2],[6.5,5.2],[-6.5,5.2]];
      planDeck(ctx,outline,0xdbd0bc,floorTex((c,s)=>{c.fillStyle="#ded2bc";c.fillRect(0,0,s,s);c.strokeStyle="#b8c2b7";c.lineWidth=2;for(let i=0;i<=s;i+=32){c.beginPath();c.moveTo(i,0);c.lineTo(i,s);c.moveTo(0,i);c.lineTo(s,i);c.stroke();}}));
      planBoundary(ctx,outline,0xd0bfa6,4.1,"home");
      const wallM=mat(0x9db3bd),glassM=mat(0xc6e4e7,{emissive:0xffe2a8,emissiveIntensity:0.15,transparent:true,opacity:0.8});lamps.push(glassM);
      const ac=acUnit();ac.position.set(-4.7,2.65,-4.9);g.add(ac);
      const pipeP=new T.Vector3(5.7,0,-4.8),dp=mesh(new T.CylinderGeometry(0.11,0.11,13,8),mat(0x899a9f));dp.position.set(pipeP.x,-3.2,pipeP.z);g.add(dp);
      ctx.u.obstacles.push({x:-3.6,z:-2.85,r:0.88},{x:-2.4,z:-0.2,w:3.5,d:2.9},{x:-4.7,z:3.6,r:0.48},{x:4.5,z:3.8,r:0.48},{x:-1,z:4.6,r:0.4});
      // 洗衣機靠牆，排水管接到地上的排水孔
      const wp = P(232 * D, R * 0.66), w = washer(1.05, "45"); w.position.copy(wp); w.rotation.y = 232 * D + Math.PI; g.add(w); u.washer = w.userData.washer;
      const back = P(232 * D, R * 0.66 + 0.6, 0.45), dr = P(212 * D, R * 0.7);
      g.add(mesh(new T.TubeGeometry(new T.CatmullRomCurve3([back, P(222 * D, R * 0.74, 0.25), new T.Vector3(dr.x, 0.06, dr.z)]), 16, 0.05, 6), mat(0x9aa3a8)));
      const drain = mesh(new T.CylinderGeometry(0.16, 0.16, 0.02, 12), mat(0x4a555c)); drain.position.set(dr.x, 0.02, dr.z); g.add(drain);
      // 曬衣繩：問過小安之後，多了一條褲管還在滴水的褲子
      const line = clothesline(3.6, [shirt(PAL.coral), shirt(0xffffff), new T.Group(), shirt(PAL.bubble)]); line.position.set(-2.4, 0, -0.2); line.rotation.y = 0.9; g.add(line);
      const wet = pants(0x5b7fa6, true); wet.position.set(0.45, 2.0, 0); line.add(wet); u.reveal.push({ o: wet, need: "ask" });
      const pd = puddle(rand(4)); pd.position.set(0.45, 0.02, 0); line.add(pd); u.reveal.push({ o: pd, need: "ask" });
      [[-4.7, 3.6], [4.5, 3.8], [-1.0, 4.6]].forEach(([x, z], i) => { const p = pottedPlant(rand(8 + i)); p.position.set(x, 0, z); g.add(p); });
      const sl = new T.Group(); sl.position.set(1.4, 0.03, -3.2); g.add(sl); [-0.12, 0.12].forEach(x => sl.add(box(0.17, 0.05, 0.32, mat(PAL.coral), x, 0, 0)));

      // 沿牆的日用品只營造生活，不揭露測試答案；中央與橋口留空。
      const woodM=mat(0xb78e69),creamM=mat(0xe9e0cb),clothM=mat(0xb5c9c1),metalM=mat(0x6e8c96);
      const shelf=new T.Group();shelf.position.set(-1.75,1.68,-4.78);g.add(shelf);
      shelf.add(box(2.05,0.11,0.58,woodM));
      [-0.72,0.72].forEach(x=>shelf.add(box(0.09,0.38,0.4,metalM,x,-0.2,-0.02)));
      function detergent(x,col,size){
        const b=new T.Group();b.position.set(x,0.06,0.04);b.scale.setScalar(size);shelf.add(b);
        b.add(box(0.38,0.58,0.29,mat(col),0,0.29,0));
        b.add(box(0.29,0.13,0.26,mat(col),-0.035,0.62,0));
        b.add(box(0.20,0.24,0.30,creamM,0,0.28,0.006));
        const cap=mesh(new T.CylinderGeometry(0.08,0.08,0.12,10),creamM);cap.position.set(-0.08,0.73,0);b.add(cap);
        const handle=mesh(new T.TorusGeometry(0.11,0.035,5,10),mat(col));handle.position.set(0.20,0.46,0);b.add(handle);
      }
      detergent(-0.51,0x78a9ad,1.15);detergent(0.10,0xd5a08a,0.9);
      const pegs=box(0.5,0.16,0.32,creamM,0.68,0.14,0.03);shelf.add(pegs);
      [0,1,2].forEach(i=>{const peg=box(0.07,0.14,0.05,mat(i%2?PAL.coral:PAL.bubble),0.54+i*0.12,0.27,0.03);peg.rotation.z=0.18-i*0.16;shelf.add(peg);});
      const tap=mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(-4.0,1.55,-5.0),new T.Vector3(-4.0,1.55,-4.68),new T.Vector3(-4.0,1.35,-4.6)]),8,0.055,6),metalM);g.add(tap);
      g.add(box(0.28,0.045,0.08,mat(PAL.coral),-4.0,1.64,-4.85));
      const inlet=mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(-4.0,1.35,-4.6),new T.Vector3(-4.18,0.65,-4.2),new T.Vector3(wp.x-0.3,0.65,wp.z-0.48)]),16,0.035,6),mat(0x91b1b8));g.add(inlet);
      const cabinet=new T.Group();cabinet.position.set(4.75,0,-4.15);g.add(cabinet);
      cabinet.add(box(2.15,0.82,1.05,creamM,0,0.48,0));cabinet.add(box(2.3,0.12,1.18,woodM,0,0.95,0));
      [-0.53,0.53].forEach(x=>{cabinet.add(box(0.035,0.55,0.03,woodM,x,0.49,0.54));cabinet.add(box(0.22,0.04,0.04,metalM,x,0.72,0.57));});
      const folded=foldedStack(rand(64));folded.position.set(-0.46,1.02,0.02);folded.rotation.y=-0.13;cabinet.add(folded);
      const towel=box(0.65,0.065,0.48,clothM,0.5,1.04,0.13);towel.rotation.y=0.14;cabinet.add(towel);
      cabinet.add(box(0.65,0.38,0.05,clothM,0.5,0.85,0.57));
      const hamper=laundryBasket(1.3,0xc4b49c,[0xf4eada,0x9bbab8]);hamper.position.set(3.35,0,-1.6);hamper.rotation.y=-0.18;g.add(hamper);
      const bucket=new T.Group();bucket.position.set(5.55,0,-2.55);g.add(bucket);
      bucket.add(mesh(new T.CylinderGeometry(0.35,0.27,0.55,12,1,true),mat(0xd4b574)).translateY(0.29));
      const handle=mesh(new T.TorusGeometry(0.35,0.026,5,16,Math.PI),metalM);handle.position.y=0.52;bucket.add(handle);
      const broom=new T.Group();broom.position.set(5.87,0,-4.58);broom.rotation.z=-0.16;g.add(broom);
      broom.add(box(0.07,2.4,0.07,woodM,0,1.45,0));broom.add(box(0.45,0.5,0.16,mat(0xc5ae77),0,0.28,0));
      const rug=box(2.4,0.018,1.04,mat(0xb58f70),1.65,0.021,-4.2,false);rug.rotation.y=-0.035;g.add(rug);
      for(let i=0;i<4;i++)g.add(box(2.14,0.022,0.035,creamM,1.65,0.033,-4.55+i*0.23,false));
      const rod=mesh(new T.CylinderGeometry(0.04,0.04,3.0,8),woodM);rod.rotation.z=Math.PI/2;rod.position.set(1.6,3.8,-4.96);g.add(rod);
      [0.4,2.8].forEach(x=>{for(let k=0;k<3;k++)g.add(box(0.19,2.65,0.08,mat(k%2?0xe4d9c0:0xf1e7d2),x+k*0.13,2.39,-4.92+(k%2)*0.035));});
      [-1.35,1.35].forEach((x,i)=>{
        const pts=[new T.Vector3(x,2.08,0),new T.Vector3(x+0.07,2.20,0),new T.Vector3(x+0.15,2.12,0),new T.Vector3(x+0.1,1.98,0),new T.Vector3(x+0.42,1.78,0),new T.Vector3(x-0.25,1.78,0),new T.Vector3(x+0.1,1.98,0)];
        const hanger=mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts,false,'catmullrom',0.1),30,0.023,5),mat(i?0xd0af78:0x91b9c1));line.add(hanger);
      });
      ctx.u.obstacles.push({x:4.75,z:-4.15,w:2.6,d:1.65},{x:3.35,z:-1.6,w:1.45,d:1.1,a:-0.18},{x:5.55,z:-2.55,r:0.53},{x:5.87,z:-4.58,r:0.42});

      // 底下：同一棟樓下面幾層的陽台
      const under = new T.Group(); under.position.y = -0.55; g.add(under);
      under.add(box(9.6, 9.0, 4.4, wallM, 0, -4.5, -2.6));
      for (let f = 0; f < 3; f++) {
        const y = -2.2 - f * 2.8, fl = new T.Group(); fl.position.y = y; under.add(fl);
        fl.add(box(8.6 - f * 0.6, 0.25, 3.0, mat(0xe9dfcf), 0, 0, 0.7));
        fl.add(box(8.6 - f * 0.6, 0.8, 0.12, mat(PAL.gold), 0, 0.5, 2.15));
        fl.add(box(1.4, 1.6, 0.06, glassM, -1.5 + f, 1.0, -0.38));
        const mini = washer(0.6, "--"); mini.position.set(2.2 - f * 1.2, 0.12, 0.2); fl.add(mini);
        const pl = pottedPlant(rand(20 + f)); pl.scale.setScalar(0.7); pl.position.set(-3 + f * 0.8, 0.12, 1.4); fl.add(pl);
      }
      u.tick = (t) => { if (wet.userData.drips) wet.userData.drips.forEach((d, i) => { const f = (t * 0.7 + i * 0.5) % 1; d.position.y = -1.02 - f * 0.9; d.material.opacity = 0.85 * (1 - f); }); };
    },

    // ★ 巨型洗程控制核心：一顆斜斜面向玩家的大旋鈕，刻度上是五座島；左右放舊版和修改版
    center(ctx) {
      const g = ctx.g, u = ctx.u, R = ctx.r;
      const outline=[[-6.5,-5.8],[6.5,-5.8],[6.5,4.4],[5.1,5.8],[-5.1,5.8],[-6.5,4.4]];
      planDeck(ctx,outline,0x2c3d50,floorTex((c,s)=>{c.fillStyle="#34495e";c.fillRect(0,0,s,s);c.strokeStyle="#70858d";c.lineWidth=1;for(let i=0;i<=s;i+=32){c.beginPath();c.moveTo(i,0);c.lineTo(i,s);c.moveTo(0,i);c.lineTo(s,i);c.stroke();}c.strokeStyle="#d6b97c";c.lineWidth=4;c.strokeRect(12,12,s-24,s-24);}));
      planBoundary(ctx,outline,0xe8e6d9,3.9);
      [-5.7,5.7].forEach(x=>{g.add(box(0.45,4.8,0.6,mat(PAL.white),x,2.4,-4.9));g.add(box(0.7,0.18,0.8,mat(PAL.gold),x,4.85,-4.9));});
      g.add(box(11.8,0.22,0.65,mat(PAL.white),0,4.9,-4.9));
      ctx.u.obstacles.push({x:-0.85,z:-0.85,w:5.8,d:4.2,a:Math.PI/4},{x:-1.95,z:3.83,r:1.15},{x:3.83,z:-1.95,r:1.15});
      [-5.7,5.7].forEach(x=>ctx.u.obstacles.push({x,z:-4.9,w:0.65,d:0.8}));
      // 大旋鈕：斜放在一個控制台上
      const core = new T.Group(); core.rotation.y = Math.PI / 4; core.position.copy(P(Math.PI / 4 + Math.PI, 0.9)); g.add(core);
      const con = box(5.2, 2.4, 3.2, mat(0xf7f1e6), 0, 1.2, -0.4); core.add(con);
      const slope = box(5.2, 0.3, 3.6, mat(PAL.gold, { roughness: 0.4, metalness: 0.3 }), 0, 2.5, -0.2); slope.rotation.x = 0.25; core.add(slope);
      const knob = new T.Group(); knob.position.set(0, 4.0, 0.2); knob.rotation.x = 0.75; core.add(knob);
      const body = mesh(new T.CylinderGeometry(2.3, 2.45, 1.0, 40), mat(PAL.white)); knob.add(body);
      for (let k = 0; k < 36; k++) { const a = (k / 36) * Math.PI * 2; const rd = box(0.16, 0.95, 0.2, mat(PAL.gold), Math.sin(a) * 2.42, 0, Math.cos(a) * 2.42); rd.rotation.y = a; knob.add(rd); }
      const fc = canvasTex(512, 512), c = fc.ctx;
      c.fillStyle = "#34495e"; c.fillRect(0, 0, 512, 512);
      const marks = [["1", "#ef8577"], ["2", "#8fd3ea"], ["3", "#b9a3e3"], ["4", "#f39c8f"], ["5", "#5aaed0"], ["★", "#d6b97c"]];
      marks.forEach(([t, col], i) => {
        const a = -Math.PI / 2 + i * (Math.PI * 2 / 6);
        c.strokeStyle = col; c.lineWidth = 34; c.beginPath(); c.arc(256, 256, 205, a - 0.42, a + 0.42); c.stroke();
        c.fillStyle = "#fbf8f2"; c.font = "bold 43px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(t, 256 + Math.cos(a) * 166, 256 + Math.sin(a) * 166);
      });
      for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; c.strokeStyle = "#f2e5cd"; c.lineWidth = k % 3 ? 2 : 5; c.beginPath(); c.moveTo(256 + Math.cos(a) * 228, 256 + Math.sin(a) * 228); c.lineTo(256 + Math.cos(a) * 248, 256 + Math.sin(a) * 248); c.stroke(); }
      c.fillStyle = "#d6b97c"; c.beginPath(); c.arc(256, 256, 60, 0, 7); c.fill();
      fc.tex.needsUpdate = true;
      const face = new T.Mesh(new T.CircleGeometry(2.25, 40), new T.MeshStandardMaterial({ map: fc.tex, roughness: 0.6 })); face.rotation.x = -Math.PI / 2; face.position.y = 0.51; knob.add(face);
      const pointer = new T.Group(); pointer.position.y = 0.56; knob.add(pointer);
      const pm = mat(PAL.coral, { emissive: 0xef8577, emissiveIntensity: 0.9 }); lamps.push(pm);
      pointer.add(box(0.26,0.10,0.38,pm,0,0.04,-1.92,false));
      const hub=mesh(new T.CylinderGeometry(0.97,1.10,0.46,32),mat(0xe8dfc9,{metalness:0.08,roughness:0.65}));hub.position.y=0.23;pointer.add(hub);
      pointer.add(box(0.36,0.22,1.48,mat(PAL.gold),0,0.52,0));
      for(let k=0;k<16;k++){const angle=k/16*Math.PI*2;const grip=box(0.07,0.32,0.08,mat(0xc4b38c),Math.sin(angle)*1.04,0.22,Math.cos(angle)*1.04);grip.rotation.y=angle;pointer.add(grip);}
      const title=labelSign("洗程控制",2.2,"#f8f0dd");title.position.set(0,1.0,1.23);core.add(title);
      const glow = mesh(new T.TorusGeometry(2.3, 0.08, 6, 48), mat(0xbfe9f5, { emissive: 0x8fd3ea, emissiveIntensity: 0.8 }), false); glow.rotation.x = Math.PI / 2; glow.position.y = 0.52; knob.add(glow);
      // 舊版與修改版的展示台
      const bay = (phi, txt, col, isNew) => {
        const b = new T.Group(); b.position.copy(P(phi, 4.3)); b.rotation.y = phi; g.add(b);
        b.add(mesh(new T.CylinderGeometry(0.9, 1.0, 0.5, 14), mat(PAL.slate)).translateY(0.25));
        const arch = mesh(new T.TorusGeometry(1.1, 0.1, 6, 20, Math.PI), mat(PAL.gold)); arch.position.y = 0.5; b.add(arch);
        const m = washer(0.75, txt); m.position.y = 0.5; m.userData.washer.draw(txt, col); b.add(m);
        const sign = labelSign(isNew ? "修改版・還沒給小安試" : "舊版・小安試過", 2.3, isNew ? "#fff3ef" : "#fbf8f2"); sign.position.set(0, 0.32, 1.05); sign.rotation.x = -0.5; b.add(sign);
        if (isNew) { const q = questionMark(); q.position.y = 2.25; q.scale.setScalar(1.4); b.add(q); u.q = q; }
        return m.userData.washer;
      };
      u.minis = [bay(Math.PI / 4 - 72 * D, "--", "#ffb066", false), bay(Math.PI / 4 + 72 * D, "52", "#7fe7ff", true)];
      const under=new T.Group();under.position.y=-0.6;g.add(under);
      under.add(planBlock([[-5.7,-5.0],[5.7,-5.0],[5.7,3.9],[4.5,5.0],[-4.5,5.0],[-5.7,3.9]],2.8,PAL.slate));
      [-3.0,3.0].forEach(x=>{
        const vent=mesh(new T.CylinderGeometry(1.15,1.15,0.28,24),mat(PAL.gold));vent.rotation.x=Math.PI/2;vent.position.set(x,-1.45,5.0);under.add(vent);
        const inside=mesh(new T.CircleGeometry(0.93,24),mat(PAL.slateL));inside.position.set(x,-1.45,5.16);under.add(inside);
        for(let i=0;i<5;i++)under.add(box(1.25,0.06,0.06,mat(PAL.white),x,-1.9+i*0.22,5.21));
      });
      u.tick = (t) => {
        pointer.rotation.y = -Math.PI / 6 * 5 + Math.sin(t * 0.35) * 0.5 - t * 0.0;
        glow.material.emissiveIntensity = 0.6 + Math.sin(t * 2) * 0.3;
        if (u.q) { u.q.position.y = 2.25 + Math.sin(t * 2) * 0.1; u.q.rotation.y = t; }
      };
    }
  };

  /* ---------- 一座島 ---------- */
  function makeIsland(spec, seed, gapsWorld) {
    const g = new T.Group();
    const r = spec.r, rnd = rand(seed * 13 + 5);
    const mats = [];
    const keep = (m) => { if (!mats.find(x => x.m === m)) mats.push({ m, base: m.color.clone() }); return m; };
    const top = 0.9;
    const isCenter = spec.landmark === "center";
    const toCenter = isCenter ? 0 : Math.atan2(-spec.x, -spec.z), face = spec.id === "ask" ? 0 : ["ideate","build","test","center"].includes(spec.id) ? 0.2 : toCenter + Math.PI;
    const fx = Math.sin(face), fz = Math.cos(face), rx = Math.cos(face), rz = -Math.sin(face);
    const lm = new T.Group(); lm.position.y = top; lm.rotation.y = face; g.add(lm);
    const ctx = { g: lm, u: lm.userData, r, rnd, gaps: (gapsWorld || []).map(a => a - face) };
    ctx.u.reveal = []; ctx.u.cover = [];
    landmarks[spec.landmark](ctx);
    g.traverse(o => { if (o.isMesh && o.material && o.material.color && !o.material.emissive?.getHex?.()) keep(o.material); });

    const kp = spec.id === "ask" ? new T.Vector3(-2.4, top, 2.8) : isCenter ? new T.Vector3(r * 0.42, top, r * 0.32) : new T.Vector3(fx * r * 0.48 + rx * r * 0.34, top, fz * r * 0.48 + rz * r * 0.34);
    const keeper = figure(spec.keeperStyle, 1.05, spec.id);
    keeper.position.copy(kp); keeper.rotation.y = face; g.add(keeper);
    const keeperRing = ring(0xf2b866); keeperRing.position.set(kp.x, top + 0.03, kp.z); g.add(keeperRing);

    // 小安：去問島過關之前站在去問島（她就是那裡的守門人），過關之後改站到給他用島的守門人旁邊
    let partner = null;
    if (spec.partnerStyle) {
      partner = figure(spec.partnerStyle, 1.05);
      partner.position.set(kp.x + rx * 1.4 - fx * 0.6, top, kp.z + rz * 1.4 - fz * 0.6); partner.rotation.y = face; partner.visible = false; g.add(partner);
    }

    let mon = null;
    if (spec.monsterColor) { mon = monster(spec.monsterColor,spec.id); mon.position.set(Math.cos(seed*1.7)*r*1.35,1.6,Math.sin(seed*1.7)*r*1.35); mon.rotation.y=-seed*1.7+Math.PI; g.add(mon); }

    g.position.set(spec.x, 0, spec.z);
    g.traverse(o => { o.userData.isleId = spec.id; });
    scene.add(g);
    isles[spec.id] = { group: g, mats, mon, lm, keeper, partner, partnerFrom: spec.partnerFrom, r, face, plan: ctx.u.plan, docks: ctx.u.docks, obstacles: ctx.u.obstacles, id: spec.id, phase: seed * 1.7, top };
  }

  function makeRoutes(all) {
    routes = [];
    for(let i=0;i<order.length-1;i++) {
      const A=all[order[i]],B=all[order[i+1]],p=new T.Vector3(A.x,0,A.z),q=new T.Vector3(B.x,0,B.z),dir=q.clone().sub(p).normalize();
      const a=p.clone().addScaledVector(dir,A.r*0.9),b=q.clone().addScaledVector(dir,-B.r*0.9);
      let points=[a,b];
      if(i===0) {
        a.set(A.x+6.35,0,A.z+1.2);b.set(B.x-B.r*0.9,0,B.z);
        const k=Math.min(1,a.distanceTo(b)/29.6);
        const curve=new T.CatmullRomCurve3([a,a.clone().add(new T.Vector3(3.4*k,0,0)),a.clone().add(new T.Vector3(10*k,0,-8*k)),b.clone().add(new T.Vector3(-10*k,0,-8*k)),b.clone().add(new T.Vector3(-3.4*k,0,0)),b],false,"catmullrom",0.3);
        points=curve.getPoints(100);
      }
      if(i>0){
        const middle=a.clone().add(b).multiplyScalar(0.5),normal=new T.Vector3(dir.z,0,-dir.x);middle.addScaledVector(normal,i%2?2:-2);
        const curve=new T.CatmullRomCurve3([a,a.clone().addScaledVector(dir,2.4),middle,b.clone().addScaledVector(dir,-2.4),b],false,"catmullrom",0.25);points=curve.getPoints(64);
      }
      routes.push({from:A.id,to:B.id,points,waterway:true});
    }
  }
  function makeWaterEnvironment() {
    const t=canvasTex(512,256),c=t.ctx;
    const sky=c.createLinearGradient(0,0,0,256);sky.addColorStop(0,"#70b4d4");sky.addColorStop(0.46,"#dceee6");sky.addColorStop(0.55,"#fff1d4");sky.addColorStop(0.66,"#6dabb8");sky.addColorStop(1,"#235a70");c.fillStyle=sky;c.fillRect(0,0,512,256);
    const sunGlow=c.createRadialGradient(376,75,1,376,75,34);sunGlow.addColorStop(0,"#ffffff");sunGlow.addColorStop(0.18,"#fff8d9");sunGlow.addColorStop(1,"rgba(255,241,206,0)");c.fillStyle=sunGlow;c.fillRect(340,39,72,72);
    t.tex.needsUpdate=true;t.tex.mapping=T.EquirectangularReflectionMapping;
    const generator=new T.PMREMGenerator(renderer);waterEnvironment=generator.fromEquirectangular(t.tex).texture;generator.dispose();t.tex.dispose();
  }
  function waterMaterial(color,channel) {
    const m=new T.MeshStandardMaterial({color,roughness:channel?0.32:0.26,metalness:0.28,envMap:waterEnvironment,envMapIntensity:channel?0.55:0.9});
    m.userData.channel=channel;
    m.onBeforeCompile=shader=>{
      shader.uniforms.uFlowTime=flowTime;shader.uniforms.uChannel={value:channel?1:0};
      shader.vertexShader='uniform float uFlowTime;uniform float uChannel;varying vec2 vWaterUV;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',
        'float a=mix(0.14,0.024,uChannel);float p=position.x*0.32+position.z*0.41+uFlowTime*0.85;float q=position.x*0.57-position.z*0.22-uFlowTime*0.63;vec3 objectNormal=normalize(vec3(-a*(0.32*cos(p)+0.342*cos(q)),1.0,-a*(0.41*cos(p)-0.132*cos(q))));');
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',
        'vec3 transformed=vec3(position);transformed.y+=a*(sin(p)+0.6*sin(q));vWaterUV=uv;');
      shader.fragmentShader='uniform float uFlowTime;uniform float uChannel;varying vec2 vWaterUV;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\nif(uChannel>0.5){float stream=pow(max(0.0,sin(vWaterUV.y*6.2-uFlowTime*2.1+sin(vWaterUV.x*17.0))),18.0);float bank=smoothstep(0.29,0.49,abs(vWaterUV.x-0.5));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.72,0.91,0.94),stream*(0.12+0.18*bank));}');
    };
    m.customProgramCacheKey=()=>channel?'drift-channel-v1':'drift-sea-v1';waterSurfaces.push(m);return m;
  }
  function waterway(route) {
    const points=route.points,navy=mat(PAL.slate),edge=mat(PAL.gold),waterM=waterMaterial(0x197f8f,true);
    const g=new T.Group();scene.add(g);
    const taper=i=>0.72+0.28*Math.min(1,i/10,(points.length-1-i)/10);
    function ribbon(width,y,material) {
      const positions=[],uvs=[],indices=[];let length=0;
      points.forEach((p,i)=>{
        if(i)length+=p.distanceTo(points[i-1]);
        const tangent=points[Math.min(i+1,points.length-1)].clone().sub(points[Math.max(0,i-1)]).normalize(),nx=tangent.z,nz=-tangent.x;
        const localWidth=width>2?width*taper(i):width;
        [-1,1].forEach(s=>{positions.push(p.x+nx*localWidth*s/2,y,p.z+nz*localWidth*s/2);uvs.push(s<0?0:1,length/1.3);});
        if(i){const k=i*2;indices.push(k-2,k,k-1,k-1,k,k+1);}
      });
      const geo=new T.BufferGeometry();geo.setAttribute("position",new T.Float32BufferAttribute(positions,3));geo.setAttribute("uv",new T.Float32BufferAttribute(uvs,2));geo.setIndex(indices);geo.computeVertexNormals();
      const m=new T.Mesh(geo,material);m.receiveShadow=true;
      if(material===navy){m.castShadow=true;material.shadowSide=T.DoubleSide;}g.add(m);
    }
    ribbon(4.2,0.64,navy);ribbon(3.94,0.76,waterM);
    const bankPositions=[],bankIndices=[];
    [-1,1].forEach(side=>points.forEach((p,i)=>{
      const tangent=points[Math.min(i+1,points.length-1)].clone().sub(points[Math.max(0,i-1)]).normalize(),off=2.04*taper(i)*side;
      const k=bankPositions.length/3;bankPositions.push(p.x+tangent.z*off,0.48,p.z-tangent.x*off,p.x+tangent.z*off,0.79,p.z-tangent.x*off);
      if(i)bankIndices.push(k-2,k-1,k,k-1,k+1,k);
    }));
    const bankGeo=new T.BufferGeometry();bankGeo.setAttribute("position",new T.Float32BufferAttribute(bankPositions,3));bankGeo.setIndex(bankIndices);bankGeo.computeVertexNormals();
    const banks=new T.Mesh(bankGeo,mat(0x467d88,{roughness:0.65,metalness:0.08,side:T.DoubleSide}));banks.receiveShadow=true;g.add(banks);
    const tx=floorTex((c,s)=>{c.fillStyle="#f7f1e6";c.fillRect(0,0,s,s);c.fillStyle="#e1d4bc";c.fillRect(0,0,s,12);c.fillStyle="#d6b97c";c.fillRect(0,0,5,s);c.fillRect(s-5,0,5,s);});
    tx.wrapS=tx.wrapT=T.RepeatWrapping;ribbon(1.95,0.9,new T.MeshStandardMaterial({map:tx,roughness:0.8}));
    for(let i=0;i<points.length;i++) {
      const p=points[i],t=points[Math.min(i+1,points.length-1)].clone().sub(points[Math.max(0,i-1)]).normalize(),n=new T.Vector3(t.z,0,-t.x);
      if(i%4===0 || i===points.length-1) [-1,1].forEach(s=>{
        const post=p.clone().addScaledVector(n,s*1.98*taper(i));g.add(box(0.07,0.8,0.07,edge,post.x,1.12,post.z));
      });
    }
    [-1,1].forEach(side=>{
      const railPoints=points.map((p,i)=>{
        const tangent=points[Math.min(i+1,points.length-1)].clone().sub(points[Math.max(0,i-1)]).normalize(),off=side*1.98*taper(i);
        return new T.Vector3(p.x+tangent.z*off,1.53,p.z-tangent.x*off);
      });
      const curve=new T.CatmullRomCurve3(railPoints,false,"catmullrom",0.25);
      g.add(mesh(new T.TubeGeometry(curve,120,0.055,6,false),edge));
    });
    const a=points[0],next=points[1],gate=new T.Group();gate.position.set(a.x,0.9,a.z);gate.rotation.y=Math.atan2(next.x-a.x,next.z-a.z);
    [-1.35,1.35].forEach(x=>gate.add(box(0.17,2.8,0.17,edge,x,1.4,0)));
    gate.add(box(2.9,0.18,0.18,edge,0,2.8,0));
    const door=box(2.5,1.8,0.15,mat(PAL.coral),0,0.85,0);gate.add(door);
    const port=mesh(new T.TorusGeometry(0.43,0.08,6,24),mat(PAL.white));port.position.z=0.1;door.add(port);g.add(gate);
    bridges.push({from:route.from,to:route.to,a:points[0],b:points.at(-1),points,len:0,door,open:false,lift:0});
  }

  // 橋：像洗衣機裡的輸送帶，暖白色帶子會一直往前走，兩邊是泡泡藍的管子，接頭是香檳金
  const belts = [];
  function makeBridges() {
    const frameM = mat(PAL.slate), tubeM = mat(0x8fd3ea, { roughness: 0.3 }), goldM = mat(PAL.gold, { roughness: 0.4, metalness: 0.3 }), gateM = mat(PAL.coral);
    for (let i = 0; i < order.length - 1; i++) {
      if(routes[i].waterway) { waterway(routes[i]); continue; }
      const A = isles[order[i]], B = isles[order[i + 1]];
      const P0 = A.group.position.clone(), Q = B.group.position.clone();
      const dir = Q.clone().sub(P0); dir.y = 0; dir.normalize();
      const a = P0.clone().add(dir.clone().multiplyScalar(A.r * 0.9)); a.y = 0;
      const b = Q.clone().sub(dir.clone().multiplyScalar(B.r * 0.9)); b.y = 0;
      const len = a.distanceTo(b), ang = Math.atan2(dir.x, dir.z), L = len + 1.6;
      const g = new T.Group();
      g.position.copy(a.clone().add(b).multiplyScalar(0.5)); g.rotation.y = ang;
      g.add(box(2.3, 0.3, L, frameM, 0, 0.62, 0));
      const bt = canvasTex(64, 64), c = bt.ctx;
      c.fillStyle = "#f7f1e6"; c.fillRect(0, 0, 64, 64); c.fillStyle = "#e2d8c6"; c.fillRect(0, 0, 64, 10); c.fillStyle = "#d6b97c"; c.fillRect(0, 0, 6, 64); c.fillRect(58, 0, 6, 64);
      bt.tex.needsUpdate = true; bt.tex.wrapS = T.RepeatWrapping; bt.tex.wrapT = T.RepeatWrapping; bt.tex.repeat.set(1, L / 0.9);
      const belt = new T.Mesh(new T.PlaneGeometry(1.95, L), new T.MeshStandardMaterial({ map: bt.tex, roughness: 0.8 })); belt.rotation.x = -Math.PI / 2; belt.position.y = 0.785; belt.receiveShadow = true; g.add(belt);
      belts.push(bt.tex);
      [-1.15, 1.15].forEach(x => {
        [1.05, 1.45].forEach(y => { const tb = mesh(new T.CylinderGeometry(0.11, 0.11, L, 8), tubeM); tb.rotation.x = Math.PI / 2; tb.position.set(x, y, 0); g.add(tb); });
        for (let k = 0; k <= Math.floor(L / 3); k++) { const j = mesh(new T.SphereGeometry(0.17, 8, 6), goldM); j.position.set(x, 1.45, -L / 2 + k * (L / Math.max(1, Math.floor(L / 3)))); g.add(j); g.add(box(0.1, 0.5, 0.1, goldM, x, 1.2, j.position.z)); }
      });
      [-L / 2, L / 2].forEach(z => { const rl = mesh(new T.CylinderGeometry(0.22, 0.22, 2.4, 12), goldM); rl.rotation.z = Math.PI / 2; rl.position.set(0, 0.62, z); g.add(rl); });
      // 下面吊著幾顆泡泡
      for (let k = 0; k < 3; k++) { const bb = mesh(new T.SphereGeometry(0.35 + k * 0.1, 10, 8), new T.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, roughness: 0.1 }), false); bb.position.set((k - 1) * 0.5, -0.4 - k * 0.5, (k - 1) * L * 0.25); g.add(bb); }
      // 橋頭的門：像洗衣機的圓窗門，過關後往上收
      const gate = new T.Group(); gate.position.set(0, 0.9, -L / 2 + 1.0);
      [-1.3, 1.3].forEach(x => { const pst = box(0.32, 2.8, 0.32, goldM, x, 1.4, 0); gate.add(pst); });
      gate.add(box(2.9, 0.3, 0.34, goldM, 0, 2.8, 0));
      const door = box(2.2, 1.8, 0.16, gateM, 0, 0.9, 0);
      const port = mesh(new T.TorusGeometry(0.45, 0.09, 6, 20), mat(0xffffff)); port.position.z = 0.1; door.add(port);
      const portG = new T.Mesh(new T.CircleGeometry(0.4, 20), mat(0xbfe6f2, { transparent: true, opacity: 0.8 })); portG.position.z = 0.09; door.add(portG);
      gate.add(door);
      g.add(gate);
      scene.add(g);
      bridges.push({ from: order[i], to: order[i + 1], a, b, points: [a,b], len, door, open: false, lift: 0 });
    }
  }

  function makeScenery() {
    // 遠方：疊得像山一樣高的毛巾，被霧吃掉一半
    const r = rand(7), cs = [0xf7f1e6, 0xf6b7ab, 0xbfe3ef, 0xead9a8, 0xd8cdee];
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2 + r() * 0.2, d = 160 + r() * 50;
      const st = new T.Group(); st.position.set(Math.cos(a) * d, SEA - 2, Math.sin(a) * d); st.rotation.y = r() * 3;
      const n = 3 + Math.floor(r() * 5), w = 18 + r() * 14;
      for (let j = 0; j < n; j++) st.add(box(w * (1 - j * 0.04), 6.5, w * 0.62, mat(cs[Math.floor(r() * cs.length)]), (r() - 0.5) * 2, 3.2 + j * 6.5, (r() - 0.5) * 2, false));
      scene.add(st);
    }
    // 在下面的海上漂的洗衣籃，插著一隻襪子當帆
    for (let k = 0; k < 4; k++) {
      const b = new T.Group();
      const bk = laundryBasket(2.2, [0x9fd4e6, 0xf6c9c1, 0xf7f1e6, 0xd8cdee][k], []); bk.position.y = -0.1; b.add(bk);
      const mast = mesh(new T.CylinderGeometry(0.05, 0.05, 2.4, 5), mat(PAL.slateL)); mast.position.y = 1.4; b.add(mast);
      const sock = new T.Group(); sock.position.set(0, 2.5, 0.05); b.add(sock);
      const sc = [PAL.coral, 0xffffff, 0xf6d36b, PAL.bubble][k];
      sock.add(box(0.06, 1.2, 0.4, mat(sc), 0, -0.5, 0.24)); sock.add(box(0.06, 0.33, 0.72, mat(sc), 0, -1.15, 0.4));
      b.userData = { rad: 40 + k * 7, speed: 0.02 + k * 0.006, phase: k * 1.6 };
      scene.add(b); boats.push(b);
    }
  }
  // 泡泡迴圈：一大群泡泡沿著五座島那一圈在空中繞
  function makeCurrent() {
    const geo=new T.SphereGeometry(0.10,10,7),m=new T.MeshStandardMaterial({color:0xf1fcf8,transparent:true,opacity:0.75,roughness:0.16,envMap:waterEnvironment});
    routes.forEach((route,index)=>{
      const curve=new T.CatmullRomCurve3(route.points.map(p=>new T.Vector3(p.x,0.82,p.z))),count=index?8:14,speed=1.15/curve.getLength();
      for(let i=0;i<count;i++){
        const o=new T.Mesh(geo,m),a=i/count,side=i%2?1:-1,tangent=curve.getTangentAt(a);
        o.position.copy(curve.getPointAt(a)).add(new T.Vector3(tangent.z,0,-tangent.x).multiplyScalar(side*1.48*(0.72+0.28*Math.min(1,a*10,(1-a)*10))));scene.add(o);bubbles.push({o,curve,a,side,speed,ph:i});
      }
      for(let i=0;i<(index?2:4);i++){
        const o=new T.Group(),a=(i+0.35)/(index?2:4),side=i%2?1:-1;
        [[0,0,0,0.22],[-0.1,0.015,-0.3,0.14],[0.1,0,-0.48,0.11]].forEach(([x,y,z,r])=>{
          const foam=mesh(new T.SphereGeometry(r,12,8),m,false);foam.position.set(x,y,z);o.add(foam);
        });
        const tangent=curve.getTangentAt(a);o.position.copy(curve.getPointAt(a)).add(new T.Vector3(tangent.z,0,-tangent.x).multiplyScalar(side*1.48));o.rotation.y=Math.atan2(tangent.x,tangent.z);scene.add(o);bubbles.push({o,curve,a,side,speed,ph:i,big:true});
      }
    });
    const returnCurve=new T.CubicBezierCurve3(new T.Vector3(-6.2,-2.8,-1.8),new T.Vector3(-17,-5,-7),new T.Vector3(-34,-5,-16),new T.Vector3(-30,-4.0,-25));
    const pipe=mesh(new T.TubeGeometry(returnCurve,60,0.16,9,false),new T.MeshStandardMaterial({color:0x90cbd8,transparent:true,opacity:0.53,roughness:0.2,metalness:0.16,envMap:waterEnvironment}),false);scene.add(pipe);
    for(const t of [0.04,0.32,0.65,0.95]){
      const ring0=mesh(new T.TorusGeometry(0.18,0.035,6,14),mat(PAL.gold));ring0.position.copy(returnCurve.getPointAt(t));ring0.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),returnCurve.getTangentAt(t));scene.add(ring0);
    }
    for(let i=0;i<9;i++){const o=new T.Mesh(geo,m);o.scale.setScalar(0.75);o.position.copy(returnCurve.getPointAt(i/9));scene.add(o);bubbles.push({o,curve:returnCurve,a:i/9,side:0,speed:0.024,ph:i});}
  }

  /* ---------- 天色 ---------- */
  const MOODS = {
    dawn: { bg: 0xc3e2ec, fog: [0xc3e2ec, 90, 260], hemi: [0xfffaf0, 0x4f7a96, 1.0], sun: [0xfff0d8, 1.9], water: 0x3f97c0, lamp: 0.15 },
    fog: { bg: 0xdde6ea, fog: [0xdde6ea, 25, 140], hemi: [0xf6f8f8, 0x7f9aa8, 1.2], sun: [0xffffff, 0.9], water: 0x86b8cc, lamp: 0.35 },
    night: { bg: 0x1e2f48, fog: [0x1e2f48, 80, 240], hemi: [0x9fb4e8, 0x1b3040, 0.95], sun: [0xb9c9ff, 1.0], water: 0x1f4f6e, lamp: 1.8 }
  };
  function applyMood(name) {
    mood = MOODS[name] ? name : "dawn";
    const m = MOODS[mood];
    scene.background.set(m.bg);
    scene.fog.color.set(m.fog[0]); scene.fog.near = m.fog[1]; scene.fog.far = m.fog[2];
    hemi.color.set(m.hemi[0]); hemi.groundColor.set(m.hemi[1]); hemi.intensity = m.hemi[2];
    sun.color.set(m.sun[0]); sun.intensity = m.sun[1];
    water.material.color.set(m.water);
    waterSurfaces.forEach(s=>{s.envMapIntensity=s.userData.channel?(mood === "night"?0.2:mood === "fog"?0.35:0.55):(mood === "night"?0.2:mood === "fog"?0.45:0.9);if(s.userData.channel)s.color.set(mood === "night"?0x1c6472:mood === "fog"?0x3a929a:0x197f8f);});
    if (current) current.material.opacity = mood === "night" ? 0.12 : 0.2;
    lamps.forEach(l => { l.emissiveIntensity = m.lamp; });
  }

  /* ---------- 初始化 ---------- */
  function init(el, spec) {
    container = el;
    try {
      if (!T) return false;
      const canvas = document.createElement("canvas");
      const attributes = { antialias: true, alpha: false };
      const context = canvas.getContext("webgl2", attributes) || canvas.getContext("webgl", attributes);
      if (!context) return false;
      renderer = new T.WebGLRenderer({ canvas, context, antialias: true });
      if (!renderer.getContext()) return false;
    } catch (e) { return false; }
    ok = true;
    onPick = spec.onPick || onPick;
    onNear = spec.onNear || onNear;
    onLeave = spec.onLeave || onLeave;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.domElement.className = "world-canvas";
    container.appendChild(renderer.domElement);
    labelLayer = document.createElement("div");
    labelLayer.className = "world-labels";
    container.appendChild(labelLayer);

    scene = new T.Scene();
    scene.background = new T.Color(0xcfe7ee);
    scene.fog = new T.Fog(0xcfe7ee, 90, 260);
    camera = new T.PerspectiveCamera(38, 1, 0.5, 600);

    hemi = new T.HemisphereLight(0xfffaf0, 0x5a86a0, 1.1); scene.add(hemi);
    sun = new T.DirectionalLight(0xfff0d8, 1.8);
    sun.position.set(-35, 60, 25); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 1, far: 160 });
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    makeWaterEnvironment();
    const wg = new T.PlaneGeometry(700, 700, 110, 110); wg.rotateX(-Math.PI / 2);
    water = new T.Mesh(wg, waterMaterial(0x5aaed0,false));
    water.receiveShadow = true; water.position.y = SEA; scene.add(water);
    waterBase = Float32Array.from(wg.attributes.position.array);

    order = spec.islands.map(s => s.id).concat([spec.center.id]);
    // 先算好每座島的橋頭朝哪個方向，牆和欄杆才知道哪裡要留門
    const all = {}; spec.islands.concat([spec.center]).forEach(s => { all[s.id] = s; });
    makeRoutes(all);
    const gaps = {}; order.forEach(id => { gaps[id] = []; });
    for (let i = 0; i < order.length - 1; i++) {
      const A = all[order[i]], B = all[order[i + 1]], rp = routes[i].points;
      gaps[A.id].push(Math.atan2(rp[0].x-A.x,rp[0].z-A.z));
      gaps[B.id].push(Math.atan2(rp.at(-1).x-B.x,rp.at(-1).z-B.z));
    }
    spec.islands.forEach((s, i) => makeIsland(s, i + 1, gaps[s.id]));
    makeIsland(spec.center, 9, gaps[spec.center.id]);
    const extent=Math.max(50,...Object.values(all).flatMap(s=>[Math.abs(s.x)+s.r+8,Math.abs(s.z)+s.r+8]));
    Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent});sun.shadow.camera.updateProjectionMatrix();
    makeBridges();
    makeScenery();
    makeCurrent();

    playerStyle = spec.player;
    player = new T.Group();
    player.add(figure(spec.player, 1.15));
    player.add(ring(0xffffff));
    // 出生在碼頭邊，離守門人有一段路，要自己走過去
    const home = isles[spec.start] ? spec.start : order[0], hp = isles[home].group.position, ha = Math.atan2(-hp.x, -hp.z);
    player.position.set(hp.x + Math.sin(ha) * isles[home].r * 0.78, isles[home].top, hp.z + Math.cos(ha) * isles[home].r * 0.78);
    if (home === "center") player.position.set(hp.x, isles[home].top, hp.z + isles[home].r * 0.7);
    if (home === "ask") player.position.set(hp.x+3.9,isles[home].top,hp.z+3.1);
    if(isles[home].plan)player.position.copy(roomSpawn(isles[home]));
    placed = true;
    scene.add(player);

    spec.islands.concat([spec.center]).forEach(s => {
      const b = document.createElement("button");
      b.className = "world-label"; b.dataset.id = s.id;
      b.addEventListener("click", () => onPick(s.id));
      labelLayer.appendChild(b);
      isles[s.id].label = b;
    });

    raycaster = new T.Raycaster();
    bindControls();
    bindKeys();
    makePad();
    window.addEventListener("resize", resize);
    resize();
    const ov = overview(); Object.assign(cam, { theta: ov.theta, phi: ov.phi, dist: ov.dist }); cam.target.copy(ov.target);
    applyMood("dawn");
    clock = new T.Clock();
    renderer.setAnimationLoop(loop);
    return true;
  }

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // 直的螢幕把鏡頭拉遠一點，才裝得下整個群島
    camera.fov = w / h < 0.8 ? 52 : 38;
    panelW = document.querySelector("#panel").getBoundingClientRect().width || 460;
    if (panelOpen && w > 720) camera.setViewOffset(w, h, panelW / 2, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  /* ---------- 操作：拖曳旋轉、滾輪或兩指縮放、點一下登島 ---------- */
  function bindControls() {
    const el = renderer.domElement;
    const pts = new Map();
    let start = null, moved = 0, pinch = 0;
    let pan = null;
    el.addEventListener("mousedown", e => { if (e.button === 1) e.preventDefault(); });
    el.addEventListener("pointerdown", e => {
      if (e.button === 1) { e.preventDefault(); el.setPointerCapture(e.pointerId); pan = { id: e.pointerId, x: e.clientX, y: e.clientY }; cam.goal = null; el.style.cursor = "move"; return; }
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { x: e.clientX, y: e.clientY }; moved = 0; cam.goal = null;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    });
    el.addEventListener("pointermove", e => {
      if (pan && e.pointerId === pan.id) {
        const dx = e.clientX - pan.x, dy = e.clientY - pan.y, k = cam.dist * 0.0018;
        pan.x = e.clientX; pan.y = e.clientY;
        const rx = Math.cos(cam.theta), rz = -Math.sin(cam.theta), fx = -Math.sin(cam.theta), fz = -Math.cos(cam.theta);
        cam.target.x += (-dx * rx + dy * fx) * k; cam.target.z += (-dx * rz + dy * fz) * k;
        return;
      }
      if (!pts.has(e.pointerId)) { hover = pickAt(e.clientX, e.clientY); el.style.cursor = hover ? "pointer" : "grab"; return; }
      const prev = pts.get(e.pointerId);
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved += Math.abs(dx) + Math.abs(dy);
      if (pts.size === 1) {
        cam.theta -= dx * 0.006;
        cam.phi = Math.min(1.35, Math.max(0.35, cam.phi - dy * 0.005));
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) cam.dist = Math.min(150, Math.max(14, cam.dist * pinch / d));
        pinch = d;
      }
    });
    const up = e => {
      if (pan && e.pointerId === pan.id) { pan = null; el.style.cursor = "grab"; return; }
      if (pts.size === 1 && moved < 6 && start) { const id = pickAt(e.clientX, e.clientY); if (id) onPick(id); }
      pts.delete(e.pointerId); if (pts.size < 2) pinch = 0;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", e => { pts.delete(e.pointerId); if (pan && e.pointerId === pan.id) pan = null; });
    el.addEventListener("wheel", e => {
      e.preventDefault(); cam.goal = null;
      cam.dist = Math.min(150, Math.max(14, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
    }, { passive: false });
  }
  function pickAt(x, y) {
    const r = renderer.domElement.getBoundingClientRect();
    const p = new T.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(p, camera);
    const hits = raycaster.intersectObjects(Object.values(isles).map(i => i.group), true);
    return hits.length ? hits[0].object.userData.isleId : null;
  }

  /* ---------- 鏡頭移動 ---------- */
  function flyTo(view) {
    if (calm) { Object.assign(cam, { theta: view.theta, phi: view.phi, dist: view.dist }); cam.target.copy(view.target); cam.goal = null; return; }
    cam.goal = { target: view.target.clone(), theta: view.theta, phi: view.phi, dist: view.dist };
  }
  function focus(id) {
    if (!ok) return;
    if (!id || !isles[id]) return flyTo(overview());
    const p = isles[id].group.position;
    const outward = isles[id].plan ? isles[id].face : Math.atan2(p.x, p.z);
    if(id === "ask") {
      const aspect=container.clientWidth/Math.max(1,container.clientHeight);
      return flyTo({target:new T.Vector3(p.x,0.65,p.z),theta:0.28,phi:0.96,dist:25*Math.max(1,0.68/aspect)});
    }
    flyTo({ target: new T.Vector3(p.x, 1, p.z), theta: id === "center" ? isles[id].face+Math.PI/4 : outward, phi: 0.82, dist: 34 });
  }
  function followPlayer() {
    if (!ok) return;
    flyTo({ target: player.position.clone(), theta: cam.theta, phi: 0.7, dist: 18 });
  }

  /* ---------- 狀態 ---------- */
  const gray = new T.Color(0x8c9497);
  function update(v) {
    if (!ok) return;
    calm = !!v.calm;
    curId = v.current || null;
    if (!!v.panelOpen !== panelOpen) { panelOpen = !!v.panelOpen; resize(); }
    if (v.mood && v.mood !== mood) applyMood(v.mood);
    const passed = v.passed || {};
    lastPassed = passed;
    Object.entries(isles).forEach(([id, it]) => {
      const locked = !!(v.locked && v.locked[id]);
      it.mats.forEach(({ m, base }) => m.color.copy(base).lerp(gray, locked ? 0.55 : 0));
      if (it.mon) it.mon.visible = !passed[id];
      if (it.partner && isles[it.partnerFrom]) {
        const moved = !!passed[it.partnerFrom];
        it.partner.visible = moved;
        isles[it.partnerFrom].keeper.visible = !moved;
      }
      // 過關之後島上才長出那一站的發現；還沒過的不先露出來
      const u = it.lm.userData;
      (u.reveal || []).forEach(x => { x.o.visible = !!passed[x.need]; });
      (u.cover || []).forEach(x => { x.o.visible = !passed[x.need]; });
      const lab = v.labels[id];
      it.label.innerHTML = `<span class="wl-num">${window.IsleArt.face(id === "center" ? window.ISLE.center.keeper.name : window.ISLE.islands.find(s=>s.id===id).keeper.name)}<i>${lab.num}</i></span><span class="wl-text"><b>${lab.title}</b><small>${lab.sub}</small></span>`;
      it.label.classList.toggle("locked", locked);
      it.label.classList.toggle("done", !!passed[id]);
      it.label.classList.toggle("current", v.current === id);
      it.label.setAttribute("aria-label", lab.aria);
    });
    bridges.forEach(br => { br.open = !!passed[br.from]; });
    if (v.player && v.player !== playerStyle) {
      playerStyle = v.player;
      player.remove(player.children[0]); player.add(figure(v.player, 1.15));
    }
    if (!placed) { const target = v.current && isles[v.current] ? v.current : null; if (target !== playerAt) movePlayer(target); }
  }
  function spot(id) {
    if (!id) return new T.Vector3(0, 0.9, 14);
    const it = isles[id];
    if(it.plan)return roomSpawn(it);
    const p = it.group.position, a = Math.atan2(-p.x, -p.z);
    if(id === "ask") return new T.Vector3(p.x+3.9,it.top,p.z+3.1);
    return new T.Vector3(p.x + Math.sin(a) * it.r * 0.45 + 1.2, it.top, p.z + Math.cos(a) * it.r * 0.45);
  }
  function movePlayer(id) {
    playerAt = id;
    const to = spot(id);
    if (calm) { player.position.copy(to); playerAnim = null; return; }
    playerAnim = { from: player.position.clone(), to, t: 0 };
  }

  /* ---------- 走路 ---------- */
  function bindKeys() {
    const map = { ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d", ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r" };
    window.addEventListener("keydown", e => {
      const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = map[e.code]; if (!k) return;
      keys.add(k); e.preventDefault();
    });
    window.addEventListener("keyup", e => { const k = map[e.code]; if (k) keys.delete(k); });
    window.addEventListener("keydown", e => {
      const t = e.target; if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.code === "KeyE" && playNear) { e.preventDefault(); playNear.run(); }
    });
    window.addEventListener("blur", () => keys.clear());
  }
  function makePad() {
    const pad = document.createElement("div"); pad.className = "walk-pad";
    pad.setAttribute("aria-label", "方向鍵");
    [["u", "▲", "往前走"], ["l", "◀", "往左走"], ["r", "▶", "往右走"], ["d", "▼", "往後走"]].forEach(([k, t, label]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "walk-" + k; b.innerHTML = window.IsleArt.icon({u:"up",l:"left",r:"right",d:"down"}[k]); b.setAttribute("aria-label", label);
      const on = e => { e.preventDefault(); keys.add(k); }, off = () => keys.delete(k);
      b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off); b.addEventListener("pointerleave", off); b.addEventListener("pointercancel", off);
      pad.appendChild(b);
    });
    container.appendChild(pad);
  }
  function onBridge(x, z) {
    for (const br of bridges) {
      if (!br.open) continue;
      for(let i=1;i<br.points.length;i++) {
        const a=br.points[i-1],b=br.points[i],dx=b.x-a.x,dz=b.z-a.z,L2=dx*dx+dz*dz;
        if(L2<1e-8)continue;
        const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/L2));
        if(Math.hypot(x-a.x-dx*t,z-a.z-dz*t)<0.95)return true;
      }
    }
    return false;
  }
  function apartmentWalkable(x,z) {
    if(x < -6.25 || x > 6.6 || z < -4.85 || z > 4.85)return false;
    if(x > 6.2 && (z < 0 || z > 2.4))return false;
    const blocks=[[-6.25,-5.15,-4.4,-2.35],[-5.55,-2.75,-2.65,-1.2],[-3.95,-1.05,-4.85,-3.95],[4.0,5.65,-4.4,-3.0],[4.5,5.4,3.45,4.5]];
    if(Math.abs(x-0.62)<0.28 && (z < -0.18 || z > 2.65))return false;
    return !blocks.some(([x0,x1,z0,z1])=>x>x0-0.18 && x<x1+0.18 && z>z0-0.18 && z<z1+0.18);
  }
  function inPolygon(x,z,points) {
    let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[i],b=points[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }return inside;
  }
  function onPlan(it,x,z) {
    const dx=x-it.group.position.x,dz=z-it.group.position.z,c=Math.cos(it.face),s=Math.sin(it.face),lx=dx*c-dz*s,lz=dx*s+dz*c;
    let floor=inPolygon(lx,lz,it.plan);
    if(floor)floor=!it.plan.some((a,i)=>{const b=it.plan[(i+1)%it.plan.length],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((lx-a[0])*dx+(lz-a[1])*dz)/(dx*dx+dz*dz)));return Math.hypot(lx-a[0]-dx*t,lz-a[1]-dz*t)<0.55;});
    if(!floor)floor=(it.docks||[]).some(d=>{const ax=d.a.x,az=d.a.z,bx=d.b.x-ax,bz=d.b.z-az,t=((lx-ax)*bx+(lz-az)*bz)/(bx*bx+bz*bz);return t>=0&&t<=1&&Math.hypot(lx-ax-bx*t,lz-az-bz*t)<d.half-0.16;});
    if(!floor)return false;
    return !(it.obstacles||[]).some(o=>{
      const dx=lx-o.x,dz=lz-o.z;if(o.r)return Math.hypot(dx,dz)<o.r;
      const c=Math.cos(o.a||0),s=Math.sin(o.a||0);return Math.abs(dx*c-dz*s)<o.w/2&&Math.abs(dx*s+dz*c)<o.d/2;
    });
  }
  function roomSpawn(it) {
    const c=Math.cos(it.face),s=Math.sin(it.face);return new T.Vector3(it.group.position.x+s*4.8,it.top,it.group.position.z+c*4.8);
  }
  function blockedByGate(x,z) {
    return bridges.some(br=>{
      if(br.open)return false;
      const a=br.points[0],b=br.points[1],dx=b.x-a.x,dz=b.z-a.z,L=Math.hypot(dx,dz),px=x-a.x,pz=z-a.z;
      return Math.abs((px*dx+pz*dz)/L)<0.22 && Math.abs((px*dz-pz*dx)/L)<1.43;
    });
  }
  function walkable(x, z) {
    if(blockedByGate(x,z))return false;
    for (const [id,it] of Object.entries(isles)) {
      const p = it.group.position;
      if(id === "ask") { if(apartmentWalkable(x-p.x,z-p.z))return true; }
      else if(it.plan) { if(onPlan(it,x,z))return true; }
      else if (Math.hypot(x - p.x, z - p.z) < it.r * 0.92) return true;
    }
    return onBridge(x, z);
  }
  function keeperPos(it) { return it.group.position.clone().add(it.keeper.position); }
  function walk(dt) {
    if (!keys.size || playerAnim) return;
    let fx = 0, fz = 0;
    if (keys.has("u")) fz += 1; if (keys.has("d")) fz -= 1; if (keys.has("l")) fx -= 1; if (keys.has("r")) fx += 1;
    if (!fx && !fz) return;
    const sx = -Math.sin(cam.theta), sz = -Math.cos(cam.theta);   // 鏡頭看出去的方向
    let mx = sx * fz + (-sz) * fx, mz = sz * fz + sx * fx;
    const n = Math.hypot(mx, mz); mx /= n; mz /= n;
    const step = WALK_SPEED * dt, p = player.position;
    if (walkable(p.x + mx * step, p.z + mz * step)) { p.x += mx * step; p.z += mz * step; }
    else if (walkable(p.x + mx * step, p.z)) p.x += mx * step;
    else if (walkable(p.x, p.z + mz * step)) p.z += mz * step;
    p.y = 0.9 + Math.abs(Math.sin(clock.elapsedTime * 10)) * 0.08;
    player.rotation.y = Math.atan2(mx, mz);
    cam.goal = null;
    if (!walking) { walking = true; cam.phi = Math.min(cam.phi, 0.9); cam.dist = Math.min(cam.dist, 34); }
    cam.target.lerp(tmp.set(p.x, 1, p.z), 0.15);
    // 走到守門人身邊
    let near = null;
    for (const [id, it] of Object.entries(isles)) if (keeperPos(it).distanceTo(tmp.set(p.x, it.top, p.z)) < NEAR) near = id;
    if (near !== nearId) { nearId = near; if (near) onNear(near); }
    // 紀錄夾開著的時候，走上橋或走離守門人太遠，就自動收起來
    if (panelOpen && curId && isles[curId]) {
      const it = isles[curId], gp = it.group.position;
      const onIt = curId === "ask" ? apartmentWalkable(p.x - gp.x, p.z - gp.z) : it.plan ? onPlan(it, p.x, p.z) : Math.hypot(p.x - gp.x, p.z - gp.z) < it.r * 0.92;
      if (!onIt || keeperPos(it).distanceTo(tmp.set(p.x, it.top, p.z)) > NEAR + 3) onLeave(curId);
    }
  }
  function isNear(id) { return nearId === id; }

  /* ---------- 每一格 ---------- */
  const tmp = new T.Vector3();
  /* ---------- 可以按的洗衣機：舊版原型、小安那一次的重播、新舊對照 ---------- */
  let lastPassed = {}, playNear = null, playBtn = null, actx = null;
  const demos = [], replays = [];
  function beep(freq, dur, at = 0, type = "square", vol = 0.06) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      const t0 = actx.currentTime + at, o = actx.createOscillator(), gn = actx.createGain();
      o.type = type; o.frequency.value = freq;
      gn.gain.setValueAtTime(0, t0); gn.gain.linearRampToValueAtTime(vol, t0 + 0.01);
      gn.gain.setValueAtTime(vol, t0 + Math.max(0.02, dur - 0.03)); gn.gain.linearRampToValueAtTime(0, t0 + dur);
      o.connect(gn); gn.connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) {}
  }
  const normalBeep = () => beep(880, 0.28, 0, "sine", 0.09);
  // 舊版：按下起動先嗶兩聲、不轉，脫水燈閃；幾秒後自己開始轉；洗完換一種嗶聲
  // 修改版：照原本流程直接開始；脫水分鐘數先顯示標準再切成它選的；洗完是平常那一聲
  function runWasher(w, mode) {
    if (!w || w.busy) return false;
    w.busy = true; w.leds.forEach(l => { l.material.emissiveIntensity = 0; });
    if (mode === "old") { beep(1320, 0.09); beep(1320, 0.09, 0.2); } else { normalBeep(); w.draw("45", "#7fe7ff"); }
    demos.push({ w, mode, t: 0, ended: false });
    return true;
  }
  function tickDemo(d, dt) {
    d.t += dt; const e = d.t, w = d.w, blink = Math.floor(e * 4) % 2 ? 1.4 : 0.05, g = w.group;
    let spinning = false;
    if (d.mode === "old") {
      w.leds[2].material.emissiveIntensity = e < 7.5 ? blink : 0;
      if (e > 3.2 && e < 7.5) { spinning = true; w.leds[0].material.emissiveIntensity = 1.2; }
      if (e >= 7.5 && !d.ended) { d.ended = true; beep(784, 0.14); beep(659, 0.14, 0.18); beep(523, 0.22, 0.36); w.leds[0].material.emissiveIntensity = 0; }
    } else {
      spinning = e < 7;
      if (e > 1.4 && !d.swapped) { d.swapped = true; w.draw("52", "#7fe7ff"); }
      w.leds[2].material.emissiveIntensity = e > 1.4 && e < 7 ? 1.2 : 0;
      w.leds[0].material.emissiveIntensity = e < 7 ? 1.2 : 0;
      if (e >= 7 && !d.ended) { d.ended = true; normalBeep(); }
    }
    g.rotation.z = spinning && !calm ? Math.sin(e * 46) * 0.012 : 0;
    if (e > 9) { g.rotation.z = 0; w.leds.forEach(l => { l.material.emissiveIntensity = 0; }); w.draw(w.text, d.mode === "new" ? "#7fe7ff" : (w.text === "--" ? "#ffb066" : undefined)); w.busy = false; return true; }
    return false;
  }
  // 頭上冒出來的「！」「？」「…」：用 canvas 畫，不用圖片
  function emote(txt, color) {
    const t = canvasTex(128, 128), c = t.ctx;
    c.fillStyle = "#fbf8f2"; c.strokeStyle = "#34495e"; c.lineWidth = 8;
    c.beginPath(); c.arc(64, 58, 46, 0, Math.PI * 2); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(50, 98); c.lineTo(64, 122); c.lineTo(76, 98); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = "#fbf8f2"; c.fillRect(52, 92, 22, 10);
    c.fillStyle = color || "#ef8577"; c.font = "bold 64px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, 64, 60);
    t.tex.needsUpdate = true;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: t.tex, depthTest: false, transparent: true }));
    sp.scale.setScalar(0.9); sp.position.y = 2.55; sp.renderOrder = 10;
    return sp;
  }
  // 給他用島過關之後才有：小安走到洗衣機前按開始，嗶兩聲不轉，她嚇一跳、歪頭、手伸過去又縮回來，最後站著不敢動
  function runReplay() {
    const it = isles.test, an = it && it.partner, w = it && it.lm.userData.washer;
    if (!an || !w || w.busy || replays.length) return;
    const home = an.position.clone(), homeRot = an.rotation.y;
    const wl = w.group.getWorldPosition(new T.Vector3()); it.group.worldToLocal(wl);
    const front = w.group.localToWorld(new T.Vector3(0, 0, 1.15)); it.group.worldToLocal(front); front.y = home.y;
    const face = Math.atan2(wl.x - front.x, wl.z - front.z);
    const back = front.clone().add(new T.Vector3(-Math.sin(face) * 0.4, 0, -Math.cos(face) * 0.4));
    const marks = { bang: emote("！"), what: emote("？", "#3f97c0"), dots: emote("…", "#34495e") };
    Object.values(marks).forEach(m => { m.visible = false; an.add(m); });
    const wp = it.group.localToWorld(front.clone());
    flyTo({ target: new T.Vector3(wp.x, 1.4, wp.z), theta: face + Math.PI + 0.75, phi: 0.95, dist: 12 });
    replays.push({ an, w, home, homeRot, front, back, face, marks, t: 0, pressed: false });
  }
  function tickReplay(r, dt) {
    r.t += dt; const e = r.t, a = r.an, u = a.userData.an || {};
    const ease = k => { k = Math.max(0, Math.min(1, k)); return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; };
    const arms = x => { if (u.arms) u.arms.rotation.x = x; }, head = (z, y) => { if (u.head) { u.head.rotation.z = z; u.head.rotation.y = y; } };
    const legs = sw => { (u.legs || []).forEach((l, i) => { l.rotation.x = i ? -sw : sw; }); };
    const show = k => { Object.entries(r.marks).forEach(([n, m]) => { m.visible = n === k; }); if (k) { const m = r.marks[k]; m.scale.setScalar(0.9 + Math.max(0, 0.25 - (e - (m.userData.at || e)) ) ); } };
    const pop = k => { if (r.marks[k].userData.at === undefined || !r.marks[k].visible) r.marks[k].userData.at = e; show(k); };
    a.rotation.x = 0; legs(0);
    if (e < 1.8) { const k = ease(e / 1.8); a.position.lerpVectors(r.home, r.front, k); a.position.y = r.home.y + Math.abs(Math.sin(e * 9)) * 0.06; legs(Math.sin(e * 9) * 0.5); a.rotation.y = r.face; }
    else if (e < 2.1) { arms(-0.9 * Math.sin((e - 1.8) / 0.3 * Math.PI)); if (!r.pressed && e > 1.9) { r.pressed = true; runWasher(r.w, "old"); } }
    else if (e < 2.5) { arms(-0.35); const k = (e - 2.1) / 0.4; a.position.copy(r.front); a.position.y = r.home.y + Math.sin(k * Math.PI) * 0.28; a.rotation.x = -0.2 * Math.sin(k * Math.PI); pop("bang"); }
    else if (e < 4.2) { arms(-0.45); head(0.3, Math.sin((e - 2.5) * 2.2) * 0.6); pop("what"); }
    else if (e < 5.0) { const k = ease((e - 4.2) / 0.8); head(0.15, 0); arms(-0.45 - 0.85 * k); a.rotation.x = 0.16 * k; a.position.lerpVectors(r.front, r.front.clone().add(new T.Vector3(Math.sin(r.face) * 0.25, 0, Math.cos(r.face) * 0.25)), k); show(null); }
    else if (e < 5.4) { const k = ease((e - 5.0) / 0.4); arms(-1.3 * (1 - k)); a.rotation.x = -0.14 * Math.sin(k * Math.PI); a.position.lerpVectors(r.front.clone().add(new T.Vector3(Math.sin(r.face) * 0.25, 0, Math.cos(r.face) * 0.25)), r.back, k); pop("bang"); }
    else if (e < 9.4) { arms(-0.15); head(0.06, 0); a.position.copy(r.back); a.position.x += Math.sin(e * 40) * 0.008; pop("dots"); }
    else if (e < 10.2) { head(0.28, 0); pop("what"); }
    else if (e < 12.0) { show(null); head(0, 0); arms(0); const k = ease((e - 10.2) / 1.8); a.position.lerpVectors(r.back, r.home, k); a.position.y = r.home.y + Math.abs(Math.sin(e * 9)) * 0.06; legs(Math.sin(e * 9) * 0.5); a.rotation.y = r.face + Math.PI; }
    else { a.position.copy(r.home); a.rotation.set(0, r.homeRot, 0); arms(0); head(0, 0); legs(0); Object.values(r.marks).forEach(m => { a.remove(m); m.material.map.dispose(); m.material.dispose(); }); return true; }
    return false;
  }
  function playSpots() {
    const out = [], P2 = (it, o) => o.getWorldPosition(new T.Vector3());
    const b = isles.build && isles.build.lm.userData.washer;
    if (b && lastPassed.build) out.push({ pos: P2(isles.build, b.group), r: 4.6, label: "按下起動", run: () => runWasher(b, "old") });
    const t = isles.test && isles.test.lm.userData.washer;
    if (t && lastPassed.test && isles.test.partner && isles.test.partner.visible) out.push({ pos: P2(isles.test, t.group), r: 4.2, label: "重播小安那一次", run: runReplay });
    const m = isles.center && isles.center.lm.userData.minis;
    if (m) { out.push({ pos: P2(isles.center, m[0].group), r: 2.6, label: "按下起動：舊版", run: () => runWasher(m[0], "old") }); out.push({ pos: P2(isles.center, m[1].group), r: 2.6, label: "按下起動：修改版", run: () => runWasher(m[1], "new") }); }
    return out;
  }
  function tickPlay(dt) {
    for (let i = demos.length - 1; i >= 0; i--) if (tickDemo(demos[i], dt)) demos.splice(i, 1);
    for (let i = replays.length - 1; i >= 0; i--) if (tickReplay(replays[i], dt)) replays.splice(i, 1);
    if (!playBtn) {
      playBtn = document.createElement("button"); playBtn.type = "button"; playBtn.className = "try-btn"; playBtn.hidden = true;
      playBtn.addEventListener("click", () => { if (playNear) playNear.run(); });
      container.appendChild(playBtn);
    }
    let best = null, bd = Infinity;
    playSpots().forEach(sp => { const d = Math.hypot(player.position.x - sp.pos.x, player.position.z - sp.pos.z); if (d < sp.r && d < bd) { bd = d; best = sp; } });
    playNear = best;
    if (best) { if (playBtn.dataset.label !== best.label) { playBtn.dataset.label = best.label; playBtn.textContent = best.label + "（E）"; } playBtn.hidden = false; }
    else playBtn.hidden = true;
  }

  function loop() {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;

    if (cam.goal) {
      const k = 1 - Math.pow(0.002, dt);
      cam.target.lerp(cam.goal.target, k);
      let dTheta = cam.goal.theta - cam.theta;
      dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
      cam.theta += dTheta * k; cam.phi += (cam.goal.phi - cam.phi) * k; cam.dist += (cam.goal.dist - cam.dist) * k;
      if (cam.target.distanceTo(cam.goal.target) < 0.05 && Math.abs(cam.goal.dist - cam.dist) < 0.05) cam.goal = null;
    }
    camera.position.set(
      cam.target.x + cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta),
      cam.target.y + cam.dist * Math.cos(cam.phi),
      cam.target.z + cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta)
    );
    camera.lookAt(cam.target);

    if (!calm) {
      flowTime.value = t;

      Object.entries(isles).forEach(([id, it]) => {
        const s = 1;
        it.group.scale.lerp(tmp.set(s, s, s), 0.12);
        if (it.mon && it.mon.visible) {
          const a = t * 0.3 + it.phase;
          it.mon.position.set(Math.cos(a) * it.r * 1.35, 1.6 + Math.sin(t * 1.8 + it.phase) * 0.35, Math.sin(a) * it.r * 1.35);
          it.mon.rotation.y = -a + Math.PI;
        }
        const u = it.lm.userData;
        if (u.tick) u.tick(t, dt);
      });
      belts.forEach(tx => { tx.offset.y -= dt * 0.45; });
      bubbles.forEach(b => {
        b.a = (b.a + b.speed * dt) % 1;
        const tangent=b.curve.getTangentAt(b.a);
        b.o.position.copy(b.curve.getPointAt(b.a)).add(new T.Vector3(tangent.z,0,-tangent.x).multiplyScalar(b.side*1.48*(0.72+0.28*Math.min(1,b.a*10,(1-b.a)*10))));
        b.o.position.y += Math.sin(t*1.6+b.ph)*0.035;
        if(b.big){b.o.rotation.y=Math.atan2(tangent.x,tangent.z);b.o.scale.setScalar(0.72+0.28*Math.min(1,b.a*10,(1-b.a)*10));}
      });
      boats.forEach(b => {
        const u = b.userData, a = t * u.speed + u.phase;
        b.position.set(Math.cos(a) * u.rad, SEA + Math.sin(t + u.phase) * 0.12, Math.sin(a) * u.rad);
        b.rotation.y = -a; b.rotation.z = Math.sin(t * 1.3 + u.phase) * 0.06;
      });
    }

    walk(dt);
    tickPlay(dt);
    bridges.forEach(br => {
      br.lift += ((br.open ? 1 : 0) - br.lift) * Math.min(1, dt * 3);
      br.door.position.y = 0.85 + br.lift * 2.2; br.door.scale.y = 1 - br.lift * 0.85;
    });

    if (playerAnim) {
      playerAnim.t = Math.min(1, playerAnim.t + dt / 1.1);
      const k = playerAnim.t, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      player.position.lerpVectors(playerAnim.from, playerAnim.to, e);
      player.position.y += Math.sin(k * Math.PI) * 5;
      const dir = tmp.copy(playerAnim.to).sub(playerAnim.from);
      if (dir.lengthSq() > 0.01) player.rotation.y = Math.atan2(dir.x, dir.z);
      if (k >= 1) playerAnim = null;
    }

    renderer.render(scene, camera);

    const w = container.clientWidth, h = container.clientHeight;
    Object.values(isles).forEach(it => {
      tmp.copy(it.group.position); tmp.y = it.id === "ask" ? 5.2 : 7;
      tmp.project(camera);
      const vis = tmp.z < 1;
      it.label.style.display = vis ? "" : "none";
      it.label.style.transform = `translate(-50%, -100%) translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px)`;
    });
  }

  return { init, update, focus, followPlayer, isNear, get ok() { return ok; } };
})();
