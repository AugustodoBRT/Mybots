import * as T from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {rng} from '/lib/mimo.mjs';
const R=rng(82731),TAU=Math.PI*2;
export function makeWorld(scene,quality){
 const solids=[],cache=new Map(),mats=new Map(),dynamic=[];
 const mat=(c,extra={})=>{const k=c+JSON.stringify(extra);if(!mats.has(k))mats.set(k,new T.MeshStandardMaterial({color:c,roughness:.73,metalness:.05,...extra}));return mats.get(k)};
 const add=(g,m,x,y,z,rx=0,ry=0,rz=0,stat=true)=>{const o=new T.Mesh(g,m);o.position.set(x,y,z);o.rotation.set(rx,ry,rz);o.castShadow=true;o.receiveShadow=true;scene.add(o);if(stat)solids.push(o);return o};
 const box=(w,h,d,c,x,y,z,r=.035,rot=0)=>{const k=[w,h,d,r].join();if(!cache.has(k))cache.set(k,r?new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/3,h/3,d/3)):new T.BoxGeometry(w,h,d));return add(cache.get(k),typeof c==='string'?mat(c):c,x,y,z,0,rot)};
 const cyl=(r,h,c,x,y,z,rt=r)=>add(new T.CylinderGeometry(rt,r,h,24),typeof c==='string'?mat(c):c,x,y,z);
 const sphere=(r,c,x,y,z,s=[1,1,1])=>{const o=add(new T.SphereGeometry(r,20,12),typeof c==='string'?mat(c):c,x,y,z);o.scale.set(...s);return o};
 const tube=(pts,r,c)=>add(new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p=>new T.Vector3(...p))),16,r,8,false),mat(c),0,0,0);
 function texture(w,h,draw){const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;return t}
 const shadowMap=texture(128,128,(q)=>{const g=q.createRadialGradient(64,64,2,64,64,63);g.addColorStop(0,'rgba(0,0,0,.65)');g.addColorStop(.5,'rgba(0,0,0,.23)');g.addColorStop(1,'rgba(0,0,0,0)');q.fillStyle=g;q.fillRect(0,0,128,128)});
 const shadow=(x,z,sx,sz,y=.014)=>{const m=new T.Mesh(new T.PlaneGeometry(sx,sz),new T.MeshBasicMaterial({map:shadowMap,transparent:true,depthWrite:false,opacity:.85}));m.rotation.x=-Math.PI/2;m.position.set(x,y,z);scene.add(m);return m};
 const glowTex=texture(128,128,q=>{const g=q.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'#ffffffe0');g.addColorStop(.15,'#ffffff4a');g.addColorStop(.5,'#ffffff10');g.addColorStop(1,'#ffffff00');q.fillStyle=g;q.fillRect(0,0,128,128)});
 const glow=(color,x,y,z,size,opacity=.4)=>{const o=new T.Sprite(new T.SpriteMaterial({map:glowTex,color,transparent:true,blending:T.AdditiveBlending,depthWrite:false,opacity}));o.position.set(x,y,z);o.scale.setScalar(size);scene.add(o);return o};
 const woodtex=texture(512,128,(q,w,h)=>{q.fillStyle='#a97945';q.fillRect(0,0,w,h);for(let i=0;i<700;i++){q.strokeStyle=`rgba(${R()>.5?'55,26,8':'239,194,133'},${.03+R()*.14})`;q.lineWidth=.3+R();const y=R()*h;q.beginPath();q.moveTo(0,y);q.bezierCurveTo(w*.3,y+R()*7,w*.7,y-R()*7,w,y+R()*5);q.stroke()}});woodtex.wrapS=woodtex.wrapT=T.RepeatWrapping;
 const wood=new T.MeshStandardMaterial({color:'#a28361',map:woodtex,roughness:.48});
 const gold=mat('#eabb75',{metalness:.63,roughness:.35});const dark=mat('#24272e',{roughness:.43});
 const amber=mat('#ffd393',{emissive:'#ffb55b',emissiveIntensity:1.5});
 // Floor slab, edge light, inset checkerboard, ambient contact shading.
 box(11.5,.55,8.6,'#22242b',0,-.3,0,.12);box(11.6,.13,8.7,'#101218',0,-.62,0,.05);
 box(11.42,.035,8.52,amber,0,-.51,0,.01);
 for(let x=0;x<14;x++)for(let z=0;z<11;z++)box(.801,.045,.751,(x+z)%2?'#32333a':'#2a2c33',-5.25+x*.807,-.008,-3.78+z*.757,.006);
 for(let i=0;i<13;i++){let x=(R()-.5)*10,z=(R()-.5)*7;const o=add(new T.DodecahedronGeometry(.5+R()*.65,0),mat(i%2?'#25262e':'#39343b',{roughness:1}),x,-.9-R()*.7,z,R(),R(),R());o.scale.set(1,.8+R()*1.2,1);}
 for(let i=0;i<9;i++){const x=(R()-.5)*9,z=(R()-.5)*6;add(new T.ConeGeometry(.09+R()*.1,.6,5),amber,x,-.8,z,Math.PI,0,.3);glow('#ec9c45',x,-.9,z,1.8,.2)}
 const under=new T.PointLight('#ffae61',30,14,1.6);under.position.set(0,-2,2);scene.add(under);
 // Two charcoal walls. Thin walnut rails and wall panels give scale.
 box(11.6,3.7,.18,'#33353c',0,1.85,-4.25,.03);box(.18,3.7,8.6,'#303239',-5.7,1.85,0,.03);
 box(11.6,.14,.28,wood,0,3.74,-4.23);box(.28,.14,8.6,wood,-5.68,3.74,0);
 box(11.4,.13,.15,wood,0,.12,-4.12);box(.15,.13,8.4,wood,-5.58,.12,0);
 for(let x=-5.4;x<5.5;x+=1.1)box(.025,3.4,.04,'#44434a',x,1.83,-4.13,.003);
 for(let z=-3.9;z<4;z+=1.1)box(.04,3.4,.025,'#3b3d44',-5.59,1.83,z,.003);
 // Window, with stars baked into the glass rather than a horizon.
 const wt=texture(512,256,(q,w,h)=>{q.fillStyle='#080b16';q.fillRect(0,0,w,h);const g=q.createRadialGradient(380,60,5,380,60,280);g.addColorStop(0,'#3c3254');g.addColorStop(1,'#0b0d19');q.fillStyle=g;q.fillRect(0,0,w,h);for(let i=0;i<90;i++){q.fillStyle=`rgba(231,228,255,${.2+R()*.8})`;q.beginPath();q.arc(R()*w,R()*h,R()*1.3+.3,0,TAU);q.fill()}});
 box(3.3,1.65,.14,dark,3.15,2.57,-4.08,.05);const pane=add(new T.PlaneGeometry(3.12,1.47),new T.MeshBasicMaterial({map:wt}),3.15,2.57,-3.99);pane.castShadow=false;
 box(.065,1.56,.06,gold,3.15,2.57,-3.96,.005);box(3.45,.12,.27,wood,3.15,1.7,-3.96);
 // Three workstations, keyboard keys, mice, drawers and upholstered swivel chairs.
 const screens=[];
 for(const [i,x] of [-3.55,-.15,3.25].entries()){
  box(2.55,.16,1.2,wood,x,1.15,-2.95,.055);for(const dx of [-1.08,1.08]){box(.1,1.08,.9,dark,x+dx,.56,-2.95,.025);box(.29,.06,1.02,dark,x+dx,.04,-2.95)}
  box(.6,.7,1.03,'#514435',x+.86,.73,-2.94,.04);for(let j=0;j<3;j++){box(.53,.018,.02,'#231f1c',x+.86,.57+j*.2,-2.413,.003);box(.18,.022,.035,gold,x+.86,.65+j*.2,-2.39,.008)}
  box(.46,.035,.3,dark,x,1.26,-3.12);box(.075,.3,.075,gold,x,1.4,-3.18);
  box(1.4,.86,.09,'#171b22',x,1.86,-3.22,.055);
  const c=document.createElement('canvas');c.width=384;c.height=216;const tx=new T.CanvasTexture(c);tx.colorSpace=T.SRGBColorSpace;
  const sm=new T.MeshBasicMaterial({map:tx});add(new T.PlaneGeometry(1.27,.72),sm,x,1.86,-3.168);screens.push({c,tx,i});
  box(.88,.055,.31,'#44434a',x-.1,1.27,-2.64,.025);
  for(let j=0;j<4;j++)for(let k=0;k<12;k++)box(.052,.015,.046,j===3&&k>3&&k<8?'#c5ae86':'#6b6867',x-.49+k*.067,1.303,-2.75+j*.065,.006);
  sphere(.065,'#88817a',x+.61,1.3,-2.64,[.8,.5,1.2]);
  // seats facing the monitors, open on camera side
  cyl(.07,.48,'#4b4b52',x,.32,-1.95);for(let k=0;k<5;k++){const a=k*TAU/5;box(.06,.05,.55,dark,x+Math.sin(a)*.22,.095,-1.95+Math.cos(a)*.22,.01,a);sphere(.06,'#111317',x+Math.sin(a)*.43,.07,-1.95+Math.cos(a)*.43)}
  box(.75,.18,.74,'#4b4754',x,.61,-1.95,.085);
  box(.72,.4,.14,'#45424d',x,.86,-1.57,.07);for(const dx of [-.42,.42]){box(.045,.38,.045,dark,x+dx,.8,-1.83);box(.12,.06,.5,'#33333b',x+dx,1,-1.91,.025)}
  shadow(x,-2.7,3,2.7);
  const l=new T.PointLight('#ffc67b',2,3.2,2);l.position.set(x,1.85,-2.5);scene.add(l);glow('#f4ae59',x,1.8,-3.05,1.8,.1);
 }
 // Bookshelf along west wall, colorful cloth bindings and fine gold spine rules.
 box(.6,2.95,2.45,wood,-5.25,1.48,-2.3,.035);
 const books=['#885654','#697d7a','#c09b64','#52607b','#997369','#928869'];
 for(let row=0;row<5;row++){box(.65,.065,2.5,'#624b35',-5.2,.15+row*.57,-2.3);for(let j=0;j<10;j++){const h=.32+R()*.16,zz=-3.39+j*.23;box(.4,h,.14+R()*.06,books[(j+row*3)%6],-5.05,.19+row*.57+h/2,zz,.012);box(.012,.013,.13,gold,-4.844,.27+row*.57,zz,.002)}}
 shadow(-5,-2.2,1.6,3.4);
 // Coffee corner, espresso machine with chrome spouts, cups, shelves.
 box(.94,.98,1.9,'#4c4138',-5.08,.5,1.35,.06);box(1.05,.12,2.05,wood,-5.08,1.05,1.35,.035);
 box(.55,.6,.75,'#20242b',-5.05,1.39,1.05,.06);box(.05,.24,.61,'#898782',-4.75,1.48,1.05,.01);box(.15,.025,.55,dark,-4.68,1.13,1.05);box(.06,.045,.34,gold,-4.72,1.52,1.05);
 for(let z of [.93,1.2]){cyl(.06,.12,'#ede1ca',-4.65,1.22,z);tube([[-4.65,1.29,z+.06],[-4.65,1.26,z+.1],[-4.65,1.22,z+.06]],.012,'#e2cfaa')}
 cyl(.085,.16,'#c4ac89',-4.9,1.19,1.95);shadow(-4.9,1.35,1.8,2.8);
 box(.55,.08,1.95,wood,-5.35,2.28,1.35);for(let i=0;i<4;i++)cyl(.075,.21,books[i],-5.25,2.42,.74+i*.32);
 // Sofa with piping, angled cushions, short brass feet.
 for(let x of [2.2,4.7])for(let z of [2.25,3.3])cyl(.055,.19,gold,x,.13,z);
 box(2.95,.4,1.24,'#443553',3.45,.4,2.8,.16);box(2.95,.8,.27,'#564366',3.45,.84,3.34,.13);
 for(const x of [2.04,4.86])box(.28,.68,1.28,'#5b476c',x,.69,2.8,.13);
 for(const x of [2.8,4.08]){box(1.19,.22,1.02,'#695378',x,.69,2.76,.1);box(1.17,.035,.88,'#7d6389',x,.8,2.78,.015)}
 const pillow=box(.52,.49,.18,'#a281a0',4.34,1.03,3.12,.09);pillow.rotation.z=-.18;
 shadow(3.45,2.8,4.2,2.5);
 // Woven plum rug and low round coffee table.
 const rugtex=texture(256,256,(q,w,h)=>{q.fillStyle='#4f3c55';q.fillRect(0,0,w,h);for(let i=0;i<12000;i++){q.fillStyle=R()>.5?'#74617250':'#281c3440';q.fillRect(R()*w,R()*h,1,3)}q.strokeStyle='#ab876b88';q.lineWidth=3;q.beginPath();q.arc(128,128,118,0,TAU);q.stroke()});
 const rug=new T.Mesh(new T.CircleGeometry(2,96),new T.MeshStandardMaterial({map:rugtex,roughness:1}));rug.rotation.x=-Math.PI/2;rug.position.set(.05,.035,1.35);rug.receiveShadow=true;scene.add(rug);
 cyl(.63,.09,wood,.1,.53,1.25);for(let i=0;i<3;i++){const a=i*TAU/3;cyl(.04,.49,dark,.1+Math.cos(a)*.4,.25,1.25+Math.sin(a)*.4)}
 box(.3,.045,.42,'#927263',.22,.61,1.22,.01,.25);box(.32,.025,.4,'#d2b98e',.2,.64,1.22,.01,.25);shadow(.1,1.25,1.5,1.5,.043);
 // Detailed plants: curved stems and soft leaves with central vein.
 function plant(x,z,size=1,y=0){cyl(.3*size,.5*size,'#8a6c54',x,y+.25*size,z,.37*size);cyl(.32*size,.03,'#2a241e',x,y+.49*size,z);for(let i=0;i<12;i++){const a=i*2.399,h=(.75+(i%4)*.19)*size,ex=x+Math.cos(a)*.4*size,ez=z+Math.sin(a)*.4*size;tube([[x,y+.4*size,z],[x+Math.cos(a)*.1,y+h*.8,z+Math.sin(a)*.1],[ex,y+h,ez]],.012*size,'#566d4b');const leaf=sphere(.24*size,i%3===0?'#62896a':'#3d674d',ex,y+h,ez,[.65,1.45,.2]);leaf.rotation.set(.3,a,-Math.cos(a)*.55)}shadow(x,z,1.7*size,1.7*size)}
 plant(5,-3.15,1.05);plant(-5.12,3.1,.85);plant(.1,1.25,.22,.6);
 // Standing lamp, warm practical light and a fine stem.
 cyl(.25,.045,dark,-3.95,.035,3.4);cyl(.027,2.3,gold,-3.95,1.2,3.4);tube([[-3.95,2.3,3.4],[-3.9,2.55,3.4],[-3.55,2.55,3.4]],.025,'#ac8957');
 add(new T.ConeGeometry(.34,.32,32,1,true),mat('#cfb68a',{side:T.DoubleSide}),-3.55,2.39,3.4);
 sphere(.12,amber,-3.55,2.26,3.4);glow('#ffd295',-3.55,2.26,3.4,1.9,.3);const lamp=new T.PointLight('#ffc886',8,6,2);lamp.position.set(-3.55,2.2,3.4);scene.add(lamp);
 // Ticking clock. Hands remain separate from static batches.
 add(new T.TorusGeometry(.37,.035,12,48),gold,-1.45,2.96,-4.08);
 const disk=new T.Mesh(new T.CircleGeometry(.34,48),mat('#27292f'));disk.position.set(-1.45,2.96,-4.08);scene.add(disk);
 for(let i=0;i<12;i++){let a=i*TAU/12;box(.018,.045,.02,gold,-1.45+Math.sin(a)*.29,2.96+Math.cos(a)*.29,-4.055,.003,-a)}
 const clock=new T.Group();clock.position.set(-1.45,2.96,-4.01);scene.add(clock);
 const hand=(len,w,c)=>{const pivot=new T.Group();const mesh=new T.Mesh(new T.BoxGeometry(w,len,.014),new T.MeshBasicMaterial({color:c}));mesh.position.y=len/2-.025;pivot.add(mesh);clock.add(pivot);return pivot};
 const hour=hand(.17,.025,'#eabb75'),minute=hand(.25,.016,'#f1d4a1'),second=hand(.28,.008,'#e4a782');
 // Approval portal, inset in west wall: stops in front, never clips through a wall.
 box(.09,2.4,1.15,'#191d27',-5.55,1.25,-.1,.045);box(.075,2.35,.055,amber,-5.47,1.24,-.64,.02);box(.075,2.35,.055,amber,-5.47,1.24,.44,.02);box(.075,.055,1.08,amber,-5.47,2.4,-.1,.02);sphere(.045,gold,-5.39,1.05,.22);glow('#eabb75',-5.1,1.3,-.1,2,.13);
 // Animated whiteboard above the first desk.
 box(1.45,.78,.065,'#b7ac9a',-3.2,2.94,-4.08,.025);
 const bc=document.createElement('canvas');bc.width=384;bc.height=200;const bt=new T.CanvasTexture(bc);bt.colorSpace=T.SRGBColorSpace;
 add(new T.PlaneGeometry(1.34,.68),new T.MeshBasicMaterial({map:bt}),-3.2,2.94,-4.04);
 // Bake static meshes into material batches (few draw calls even with hundreds of books/keys).
 const batches=new Map();for(const o of solids){o.updateMatrixWorld();let g=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();g.applyMatrix4(o.matrixWorld);const list=batches.get(o.material)||[];list.push(g);batches.set(o.material,list);scene.remove(o)}
 for(const [m,gs] of batches){const merged=new T.BufferGeometry();for(const a of ['position','normal','uv']){let n=gs.reduce((s,g)=>s+g.attributes[a].array.length,0),arr=new Float32Array(n),off=0;for(const g of gs){arr.set(g.attributes[a].array,off);off+=g.attributes[a].array.length}merged.setAttribute(a,new T.BufferAttribute(arr,a==='uv'?2:3))}const mesh=new T.Mesh(merged,m);mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);gs.forEach(g=>g.dispose())}
 // Coffee steam and warm suspended dust, all driven analytically by time.
 const n=quality==='low'?75:200,p=new Float32Array(n*3),ph=Array.from({length:n},()=>[R(),R(),R()]);
 const pg=new T.BufferGeometry();pg.setAttribute('position',new T.BufferAttribute(p,3));const dust=new T.Points(pg,new T.PointsMaterial({map:glowTex,color:'#e9d6b1',size:.06,transparent:true,opacity:.42,depthWrite:false,blending:T.AdditiveBlending}));scene.add(dust);
 const sg=new T.BufferGeometry(),sp=new Float32Array(30*3);sg.setAttribute('position',new T.BufferAttribute(sp,3));scene.add(new T.Points(sg,new T.PointsMaterial({map:glowTex,color:'#e4d8ce',size:.28,transparent:true,opacity:.14,depthWrite:false})));
 function update(t){
  hour.rotation.z=-TAU*(10/12+t/43200);minute.rotation.z=-TAU*(8/60+t/3600);second.rotation.z=-TAU*(Math.floor(t)/60);
  for(const {c,tx,i} of screens){const q=c.getContext('2d');q.fillStyle='#211d1a';q.fillRect(0,0,384,216);q.fillStyle='#c49453';q.fillRect(0,0,384,22);q.fillStyle='#f4d7a1';for(let j=0;j<3;j++){q.beginPath();q.arc(13+j*12,11,3,0,TAU);q.fill()}for(let j=0;j<10;j++){const a=(j+i*3+Math.floor(t*.6))%12;q.fillStyle=j%3===0?'#eabb75':'#9d7b4c';q.fillRect(20+(j%3)*13,38+j*15,34+(a*37)%230,4);if(j%3===1){q.fillStyle='#8a9d87';q.fillRect(265,38+j*15,50,4)}}if(Math.floor(t*2)%2===0){q.fillStyle='#ffe3ac';q.fillRect(38,192,5,10)}tx.needsUpdate=true}
  const q=bc.getContext('2d');q.fillStyle='#d1c9b7';q.fillRect(0,0,384,200);q.strokeStyle='#6a666a';q.lineWidth=3;q.strokeRect(28,28,95,52);q.strokeRect(235,34,112,48);q.strokeRect(120,132,125,44);q.beginPath();q.moveTo(125,54);q.lineTo(235,58);q.moveTo(290,83);q.lineTo(190,132);q.stroke();q.strokeStyle='#b48b54';q.lineWidth=5;q.beginPath();q.moveTo(139,55);q.lineTo(139+70*((t*.15)%1),55);q.stroke();for(let j=0;j<3;j++){q.fillStyle='#82766b';q.fillRect(40,39+j*12,57-j*8,3)}bt.needsUpdate=true;
  for(let i=0;i<n;i++){const a=ph[i];p[i*3]=(a[0]-.5)*10+Math.sin(t*.2+i)*.07;p[i*3+1]=.25+((a[1]*3+t*.035)%3);p[i*3+2]=(a[2]-.5)*7}pg.attributes.position.needsUpdate=true;
  for(let i=0;i<30;i++){const a=(i/30+t*.28)%1;sp[i*3]=-4.65+Math.sin(a*7+i)*a*.09;sp[i*3+1]=1.29+a*.85;sp[i*3+2]=1.1+Math.cos(a*6+i)*a*.12}sg.attributes.position.needsUpdate=true;
 }
 return {update,shadow,glow,glowTex,shadowMap};
}
