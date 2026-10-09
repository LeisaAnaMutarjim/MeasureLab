(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const wrap = $('canvasWrap');
  const COLORS = ['#ff5a36', '#0d7e74', '#6d5bd0', '#da8b16', '#1e78bd', '#b84882'];

  const state = {
    image: null, imageSrc: '', imageName: '', imageW: 0, imageH: 0,
    logo: null, logoSrc: '', logoName: '', logoNaturalW: 0, logoNaturalH: 0,
    logoTransform: { x: 0, y: 0, w: 160, h: 80, rotation: 0, opacity: 1, visible: true, keepRatio: true, lockPosition: false, lockSize: false },
    mmPerPx: null, scaleMethod: 'width', widthMm: null, heightMm: null, dpi: 300, reference: null,
    tool: 'select', zoom: 1, panX: 0, panY: 0, grid: false, gridMm: 10, snap: true, snapDistance: 12,
    snapImage: true, snapLogo: true, snapPoints: true, snapGrid: false, precision: 1, loupe: true,
    measurements: [], guides: [], draft: null, selectedMeasurement: null, selectedLogo: false,
    currentColor: null, colorHistory: [],
    dragging: null, pointer: null, history: [], future: [], spaceDown: false
  };

  const cloneState = () => ({
    logoTransform: { ...state.logoTransform }, mmPerPx: state.mmPerPx, scaleMethod: state.scaleMethod,
    widthMm: state.widthMm, heightMm: state.heightMm, dpi: state.dpi,
    reference: state.reference ? JSON.parse(JSON.stringify(state.reference)) : null,
    measurements: JSON.parse(JSON.stringify(state.measurements)), guides: JSON.parse(JSON.stringify(state.guides)),
    currentColor: state.currentColor ? { ...state.currentColor } : null, colorHistory: [...state.colorHistory]
  });

  function pushHistory() {
    state.history.push(cloneState());
    if (state.history.length > 60) state.history.shift();
    state.future = [];
    updateHistoryButtons();
    saveLocal();
  }

  function restoreSnapshot(s) {
    Object.assign(state.logoTransform, s.logoTransform);
    Object.assign(state, { mmPerPx: s.mmPerPx, scaleMethod: s.scaleMethod, widthMm: s.widthMm, heightMm: s.heightMm, dpi: s.dpi, reference: s.reference, measurements: s.measurements, guides: s.guides, currentColor: s.currentColor, colorHistory: s.colorHistory || [] });
    syncAllControls(); render();
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(cloneState());
    restoreSnapshot(state.history.pop());
    updateHistoryButtons();
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(cloneState());
    restoreSnapshot(state.future.pop());
    updateHistoryButtons();
  }

  function updateHistoryButtons() { $('undoBtn').disabled = !state.history.length; $('redoBtn').disabled = !state.future.length; }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = wrap.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = rect.width + 'px'; canvas.style.height = rect.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.viewportW = rect.width; state.viewportH = rect.height; state.dpr = dpr;
    render();
  }

  function imageToScreen(p) { return { x: state.panX + p.x * state.zoom, y: state.panY + p.y * state.zoom }; }
  function screenToImage(p) { return { x: (p.x - state.panX) / state.zoom, y: (p.y - state.panY) / state.zoom }; }
  function distance(a,b) { return Math.hypot(b.x-a.x,b.y-a.y); }
  function clamp(v,min,max) { return Math.max(min,Math.min(max,v)); }
  function fmt(v, p = state.precision) { return Number(v).toFixed(p); }

  function fitImage() {
    if (!state.image) return;
    const pad = 70;
    state.zoom = Math.min((state.viewportW-pad*2)/state.imageW, (state.viewportH-pad*2)/state.imageH, 3);
    state.zoom = Math.max(.05, state.zoom);
    state.panX = (state.viewportW-state.imageW*state.zoom)/2;
    state.panY = (state.viewportH-state.imageH*state.zoom)/2;
    updateZoom(); render();
  }

  function setZoom(next, center = {x:state.viewportW/2,y:state.viewportH/2}) {
    const before = screenToImage(center);
    state.zoom = clamp(next, .03, 20);
    state.panX = center.x-before.x*state.zoom; state.panY = center.y-before.y*state.zoom;
    updateZoom(); render();
  }

  function updateZoom() { $('zoomLabel').textContent = Math.round(state.zoom*100)+'%'; }

  function drawGrid() {
    if (!state.grid || !state.image) return;
    const spacing = state.mmPerPx ? state.gridMm/state.mmPerPx : 50;
    if (spacing*state.zoom < 8) return;
    ctx.save(); ctx.strokeStyle='rgba(13,126,116,.17)'; ctx.lineWidth=1;
    for(let x=0;x<=state.imageW;x+=spacing){ const a=imageToScreen({x,y:0}),b=imageToScreen({x,y:state.imageH}); ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke(); }
    for(let y=0;y<=state.imageH;y+=spacing){ const a=imageToScreen({x:0,y}),b=imageToScreen({x:state.imageW,y}); ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke(); }
    ctx.restore();
  }

  function drawGuides() {
    ctx.save(); ctx.strokeStyle='rgba(30,120,189,.8)';ctx.lineWidth=1;ctx.setLineDash([4,4]);
    state.guides.forEach(g=>{ctx.beginPath(); if(g.axis==='x'){const p=imageToScreen({x:g.value,y:0});ctx.moveTo(p.x,0);ctx.lineTo(p.x,state.viewportH);}else{const p=imageToScreen({x:0,y:g.value});ctx.moveTo(0,p.y);ctx.lineTo(state.viewportW,p.y);}ctx.stroke();});
    ctx.restore();
  }

  function logoCorners() {
    const l=state.logoTransform, cx=l.x+l.w/2, cy=l.y+l.h/2, r=l.rotation*Math.PI/180;
    const rotate=(x,y)=>({x:cx+(x-cx)*Math.cos(r)-(y-cy)*Math.sin(r),y:cy+(x-cx)*Math.sin(r)+(y-cy)*Math.cos(r)});
    return [rotate(l.x,l.y),rotate(l.x+l.w,l.y),rotate(l.x+l.w,l.y+l.h),rotate(l.x,l.y+l.h)];
  }

  function drawLogo() {
    if (!state.logo || !state.logoTransform.visible) return;
    const l=state.logoTransform, c=imageToScreen({x:l.x+l.w/2,y:l.y+l.h/2});
    ctx.save(); ctx.translate(c.x,c.y);ctx.rotate(l.rotation*Math.PI/180);ctx.globalAlpha=l.opacity;
    ctx.drawImage(state.logo,-l.w*state.zoom/2,-l.h*state.zoom/2,l.w*state.zoom,l.h*state.zoom);ctx.restore();
    if(state.selectedLogo){
      const corners=logoCorners().map(imageToScreen);ctx.save();ctx.strokeStyle='#0d7e74';ctx.lineWidth=2;ctx.setLineDash([5,3]);ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);corners.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.closePath();ctx.stroke();ctx.setLineDash([]);
      corners.forEach((p,i)=>{ctx.fillStyle='#fff';ctx.strokeStyle='#0d7e74';ctx.lineWidth=2;ctx.beginPath();ctx.rect(p.x-5,p.y-5,10,10);ctx.fill();ctx.stroke();});
      const topMid={x:(corners[0].x+corners[1].x)/2,y:(corners[0].y+corners[1].y)/2};const center=imageToScreen({x:l.x+l.w/2,y:l.y+l.h/2});const vx=topMid.x-center.x,vy=topMid.y-center.y,mag=Math.hypot(vx,vy)||1;const rp={x:topMid.x+vx/mag*25,y:topMid.y+vy/mag*25};ctx.beginPath();ctx.moveTo(topMid.x,topMid.y);ctx.lineTo(rp.x,rp.y);ctx.stroke();ctx.fillStyle='#ff5a36';ctx.beginPath();ctx.arc(rp.x,rp.y,6,0,Math.PI*2);ctx.fill();
    }
  }

  function drawPoint(p,color,active=false){const s=imageToScreen(p);ctx.save();ctx.fillStyle='#fff';ctx.strokeStyle=color;ctx.lineWidth=active?3:2;ctx.beginPath();ctx.arc(s.x,s.y,active?6:5,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();}

  function measurementValues(m){const dx=Math.abs(m.b.x-m.a.x),dy=Math.abs(m.b.y-m.a.y),d=Math.hypot(dx,dy),k=state.mmPerPx||1;return{dx:dx*k,dy:dy*k,d:d*k,unit:state.mmPerPx?'mm':'px'};}

  function drawMeasurement(m,index,draft=false){
    const a=imageToScreen(m.a),b=imageToScreen(m.b),color=m.color||COLORS[index%COLORS.length],selected=state.selectedMeasurement===m.id;
    ctx.save();ctx.strokeStyle=color;ctx.lineWidth=selected?3:2;ctx.setLineDash(draft?[7,5]:[]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
    const ang=Math.atan2(b.y-a.y,b.x-a.x),head=8;for(const [p,dir] of [[a,1],[b,-1]]){ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+Math.cos(ang+dir*.55)*head*dir,p.y+Math.sin(ang+dir*.55)*head*dir);ctx.moveTo(p.x,p.y);ctx.lineTo(p.x+Math.cos(ang-dir*.55)*head*dir,p.y+Math.sin(ang-dir*.55)*head*dir);ctx.stroke();}
    drawPoint(m.a,color,selected);drawPoint(m.b,color,selected);
    const val=measurementValues(m),text=fmt(val.d)+' '+val.unit,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};ctx.font='700 12px Inter, sans-serif';const tw=ctx.measureText(text).width;ctx.fillStyle='rgba(24,37,35,.92)';ctx.beginPath();roundRect(ctx,mid.x-tw/2-7,mid.y-10,tw+14,20,5);ctx.fill();ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,mid.x,mid.y);ctx.restore();
  }

  function drawReference(){
    if(!state.reference)return;const m=state.reference,a=imageToScreen(m.a),b=imageToScreen(m.b),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},text=`基準線${m.realMm?` ${fmt(m.realMm)} mm`:''}`;ctx.save();ctx.strokeStyle='#0d7e74';ctx.lineWidth=2;ctx.setLineDash([8,5]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);drawPoint(m.a,'#0d7e74');drawPoint(m.b,'#0d7e74');ctx.font='700 11px Inter, sans-serif';const tw=ctx.measureText(text).width;ctx.fillStyle='rgba(232,244,242,.96)';ctx.beginPath();roundRect(ctx,mid.x-tw/2-6,mid.y-9,tw+12,18,5);ctx.fill();ctx.fillStyle='#0d7e74';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,mid.x,mid.y);ctx.restore();
  }

  function roundRect(c,x,y,w,h,r){c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}

  function drawSnapMarker(){if(!state.pointer?.snapLabel)return;const p=imageToScreen(state.pointer.image);ctx.save();ctx.strokeStyle='#ff5a36';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,10,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#ff5a36';ctx.font='10px sans-serif';ctx.textAlign='center';ctx.fillText(state.pointer.snapLabel,p.x,p.y-15);ctx.restore();}

  function render() {
    if(!state.viewportW)return;ctx.clearRect(0,0,state.viewportW,state.viewportH);
    if(!state.image)return;
    const p=imageToScreen({x:0,y:0});ctx.save();ctx.shadowColor='rgba(12,29,25,.18)';ctx.shadowBlur=24;ctx.shadowOffsetY=8;ctx.fillStyle='#fff';ctx.fillRect(p.x,p.y,state.imageW*state.zoom,state.imageH*state.zoom);ctx.restore();
    ctx.drawImage(state.image,p.x,p.y,state.imageW*state.zoom,state.imageH*state.zoom);
    drawGrid();drawLogo();drawGuides();drawReference();state.measurements.filter(m=>m.visible!==false).forEach((m,i)=>drawMeasurement(m,i));if(state.draft?.a&&state.draft?.b)drawMeasurement({...state.draft,color:'#ff5a36'},0,true);drawSnapMarker();
  }

  function loadImageFile(file, asLogo=false) {
    if(!file||!file.type.startsWith('image/')){toast('画像ファイルを選択してください');return;}
    const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{
      if(asLogo){pushHistory();state.logo=img;state.logoSrc=reader.result;state.logoName=file.name;state.logoNaturalW=img.naturalWidth;state.logoNaturalH=img.naturalHeight;const max=Math.min(state.imageW*.3||240,240);state.logoTransform.w=max;state.logoTransform.h=max*img.naturalHeight/img.naturalWidth;state.logoTransform.x=state.image?state.imageW/2-state.logoTransform.w/2:30;state.logoTransform.y=state.image?state.imageH/2-state.logoTransform.h/2:30;state.selectedLogo=true;showLogoControls();switchTab('logo');toast('ロゴを追加しました');}
      else{state.image=img;state.imageSrc=reader.result;state.imageName=file.name;state.imageW=img.naturalWidth;state.imageH=img.naturalHeight;state.measurements=[];state.guides=[];state.mmPerPx=null;state.history=[];state.future=[];$('emptyState').style.display='none';updateImageMeta();setTimeout(fitImage,0);toast('画像を読み込みました');}
      syncAllControls();render();saveLocal();
    };img.onerror=()=>toast('画像を読み込めませんでした');img.src=reader.result;};reader.readAsDataURL(file);
  }

  function updateImageMeta(){
    if(!state.image)return;$('imageBadge').textContent='読込済み';$('imageBadge').classList.add('ready');$('fileName').textContent=state.imageName;$('fileName').title=state.imageName;$('pixelSize').textContent=`${state.imageW.toLocaleString()} × ${state.imageH.toLocaleString()} px`;
    const g=gcd(state.imageW,state.imageH);$('aspectRatio').textContent=`${state.imageW/g} : ${state.imageH/g}`;$('statusMessage').textContent='測定またはロゴ配置を開始できます';updateScaleUI();renderResults();
  }
  function gcd(a,b){while(b)[a,b]=[b,a%b];return a;}

  function sampleColorAt(p){
    if(!state.image||p.x<0||p.y<0||p.x>state.imageW||p.y>state.imageH)return null;const sample=document.createElement('canvas');sample.width=1;sample.height=1;const c=sample.getContext('2d',{willReadFrequently:true});c.translate(-p.x,-p.y);c.drawImage(state.image,0,0,state.imageW,state.imageH);if(state.logo&&state.logoTransform.visible){const l=state.logoTransform;c.save();c.translate(l.x+l.w/2,l.y+l.h/2);c.rotate(l.rotation*Math.PI/180);c.globalAlpha=l.opacity;c.drawImage(state.logo,-l.w/2,-l.h/2,l.w,l.h);c.restore();}const [r,g,b,a]=c.getImageData(0,0,1,1).data,hex='#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();return{r,g,b,a,hex};
  }

  function updateColorUI(){
    const col=state.currentColor;$('colorSwatch').style.background=col?col.hex:'';$('colorHex').textContent=col?col.hex:'未取得';$('colorRgb').textContent=col?`RGB ${col.r}, ${col.g}, ${col.b}`:'画像上の色を選択してください';$('copyColorBtn').disabled=!col;const recent=$('recentColors');recent.replaceChildren();state.colorHistory.forEach(hex=>{const b=document.createElement('button');b.style.background=hex;b.title=`${hex} をコピー`;b.setAttribute('aria-label',`${hex} をコピー`);b.addEventListener('click',()=>copyColor(hex));recent.appendChild(b);});
  }

  async function copyColor(value=state.currentColor?.hex){if(!value)return;try{await navigator.clipboard.writeText(value);toast(`${value} をコピーしました`);}catch{const input=document.createElement('textarea');input.value=value;document.body.appendChild(input);input.select();document.execCommand('copy');input.remove();toast(`${value} をコピーしました`);}}

  function applyScale(method,value){
    if(!state.image||!value||value<=0)return;
    pushHistory();state.scaleMethod=method;
    if(method==='width')state.mmPerPx=value/state.imageW;
    if(method==='height')state.mmPerPx=value/state.imageH;
    if(method==='dpi')state.mmPerPx=25.4/value;
    state.widthMm=state.imageW*state.mmPerPx;state.heightMm=state.imageH*state.mmPerPx;updateScaleUI();updateLogoInputs();renderResults();render();saveLocal();
  }

  function updateScaleUI(){
    if(state.mmPerPx){$('realSize').textContent=`${fmt(state.imageW*state.mmPerPx,2)} × ${fmt(state.imageH*state.mmPerPx,2)} mm`;$('pixelScale').textContent=`1 px = ${fmt(state.mmPerPx,4)} mm`;$('scaleStatus').textContent='縮尺設定済み';$('scaleStatus').classList.add('ready');$('summaryUnit').textContent='mm';}
    else{$('realSize').textContent='— × — mm';$('pixelScale').textContent='1 px = — mm';$('scaleStatus').textContent='縮尺未設定';$('scaleStatus').classList.remove('ready');$('summaryUnit').textContent='px';}
    updateReferenceUI();
  }

  function updateReferenceUI(){const ref=state.reference;$('deleteReferenceBtn').disabled=!ref;$('referencePx').textContent=ref?`基準線: ${fmt(distance(ref.a,ref.b),1)} px${ref.realMm?` / ${fmt(ref.realMm)} mm`:''}`:'基準線: 未選択';if(ref?.realMm)$('referenceMm').value=ref.realMm;}

  function activateScaleMethod(method,setState=true){if(setState)state.scaleMethod=method;document.querySelectorAll('#scaleMethod button').forEach(x=>x.classList.toggle('active',x.dataset.method===method));document.querySelectorAll('[data-scale-panel]').forEach(x=>x.classList.toggle('hidden',x.dataset.scalePanel!==method));}

  function setTool(tool){state.tool=tool;document.querySelectorAll('.tool[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));canvas.style.cursor=tool==='pan'?'grab':tool==='measure'||tool==='calibrate'||tool==='color'?'crosshair':'default';state.draft=null;$('statusMessage').textContent={select:'要素を選択・移動できます（Shiftで水平・垂直）',measure:'始点を選択してください',calibrate:'既知の距離の始点を選択してください',guide:'クリックして補助線を追加',color:'画像上の取得したい色をクリックしてください',pan:'ドラッグまたはホイールクリックで表示を移動'}[tool];render();}

  function candidatePoints(){
    const out=[];
    if(state.snapImage){const w=state.imageW,h=state.imageH;[[0,0,'画像 左上'],[w,0,'画像 右上'],[w,h,'画像 右下'],[0,h,'画像 左下'],[w/2,h/2,'画像 中心'],[w/2,0,'画像 上辺'],[w,h/2,'画像 右辺'],[w/2,h,'画像 下辺'],[0,h/2,'画像 左辺']].forEach(([x,y,label])=>out.push({x,y,label}));}
    if(state.logo&&state.logoTransform.visible&&state.snapLogo){const c=logoCorners(),l=state.logoTransform;c.forEach((p,i)=>out.push({...p,label:`ロゴ ${['左上','右上','右下','左下'][i]}`}));out.push({x:l.x+l.w/2,y:l.y+l.h/2,label:'ロゴ 中心'});for(let i=0;i<4;i++){const n=c[(i+1)%4];out.push({x:(c[i].x+n.x)/2,y:(c[i].y+n.y)/2,label:'ロゴ 辺'});}}
    if(state.snapPoints)state.measurements.forEach((m,i)=>{out.push({...m.a,label:`測定${i+1} 始点`},{...m.b,label:`測定${i+1} 終点`});});
    return out;
  }

  function snapPoint(p, shiftKey=false){
    let best={...p,snapLabel:''},bestD=state.snapDistance/state.zoom;if(!state.snap)return best;
    candidatePoints().forEach(c=>{const d=distance(p,c);if(d<bestD){bestD=d;best={x:c.x,y:c.y,snapLabel:c.label};}});
    if(state.snapGrid&&state.grid&&state.mmPerPx){const s=state.gridMm/state.mmPerPx,g={x:Math.round(p.x/s)*s,y:Math.round(p.y/s)*s};if(distance(p,g)<bestD)best={...g,snapLabel:'グリッド'};}
    if(shiftKey&&state.draft?.a){const dx=Math.abs(p.x-state.draft.a.x),dy=Math.abs(p.y-state.draft.a.y);best=dx>dy?{x:p.x,y:state.draft.a.y,snapLabel:'水平'}:{x:state.draft.a.x,y:p.y,snapLabel:'垂直'};}
    return best;
  }

  function hitMeasurement(p){let hit=null,bd=12/state.zoom;state.measurements.forEach(m=>{for(const key of ['a','b']){const d=distance(p,m[key]);if(d<bd){bd=d;hit={m,key};}}const vx=m.b.x-m.a.x,vy=m.b.y-m.a.y,len2=vx*vx+vy*vy||1,t=clamp(((p.x-m.a.x)*vx+(p.y-m.a.y)*vy)/len2,0,1),q={x:m.a.x+t*vx,y:m.a.y+t*vy},d=distance(p,q);if(d<bd){bd=d;hit={m,key:null};}});return hit;}

  function pointInLogo(p){if(!state.logo||!state.logoTransform.visible)return false;const l=state.logoTransform,cx=l.x+l.w/2,cy=l.y+l.h/2,r=-l.rotation*Math.PI/180,dx=p.x-cx,dy=p.y-cy,x=dx*Math.cos(r)-dy*Math.sin(r)+cx,y=dx*Math.sin(r)+dy*Math.cos(r)+cy;return x>=l.x&&x<=l.x+l.w&&y>=l.y&&y<=l.y+l.h;}

  function hitLogoHandle(screen){if(!state.selectedLogo)return null;const corners=logoCorners().map(imageToScreen);for(let i=0;i<4;i++)if(distance(screen,corners[i])<11)return 'resize-'+i;const l=state.logoTransform,top={x:(corners[0].x+corners[1].x)/2,y:(corners[0].y+corners[1].y)/2},c=imageToScreen({x:l.x+l.w/2,y:l.y+l.h/2}),vx=top.x-c.x,vy=top.y-c.y,mag=Math.hypot(vx,vy)||1,rp={x:top.x+vx/mag*25,y:top.y+vy/mag*25};if(distance(screen,rp)<12)return'rotate';return null;}

  function pointerPos(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}

  function onPointerDown(e){
    if(!state.image||!([0,1].includes(e.button)))return;e.preventDefault();canvas.setPointerCapture(e.pointerId);const s=pointerPos(e),raw=screenToImage(s),p=snapPoint(raw,e.shiftKey);state.pointer={screen:s,image:p,snapLabel:p.snapLabel};
    if(e.button===1||state.spaceDown||state.tool==='pan'){state.dragging={type:'pan',start:s,panX:state.panX,panY:state.panY};canvas.style.cursor='grabbing';return;}
    if(state.tool==='color'){const col=sampleColorAt(raw);if(!col){toast('画像の範囲内を選択してください');return;}state.currentColor=col;state.colorHistory=[col.hex,...state.colorHistory.filter(x=>x!==col.hex)].slice(0,8);updateColorUI();saveLocal();toast(`${col.hex} を取得しました`);render();return;}
    if(state.tool==='measure'||state.tool==='calibrate'){
      if(!state.draft){state.draft={a:p,b:p};$('statusMessage').textContent='終点を選択してください（Shiftで水平・垂直）';}
      else{const m={id:Date.now().toString(36),name:state.tool==='calibrate'?'基準線':`測定 ${state.measurements.length+1}`,a:{x:state.draft.a.x,y:state.draft.a.y},b:{x:p.x,y:p.y},snapA:state.draft.a.snapLabel||'',snapB:p.snapLabel||'',color:COLORS[state.measurements.length%COLORS.length],visible:true};state.draft=null;if(distance(m.a,m.b)<1){toast('2点を離して指定してください');return;}if(state.tool==='calibrate'){state.reference=m;$('calibrationPxLabel').textContent=fmt(distance(m.a,m.b),1)+' px';$('calibrationMmInput').value=$('referenceMm').value||'';$('calibrationModal').hidden=false;setTimeout(()=>$('calibrationMmInput').focus(),30);}else{pushHistory();state.measurements.push(m);state.selectedMeasurement=m.id;renderResults();toast('測定を追加しました');$('statusMessage').textContent='続けて始点を選択できます';}render();}
      return;
    }
    if(state.tool==='guide'){const vertical=e.shiftKey;pushHistory();state.guides.push({axis:vertical?'x':'y',value:vertical?p.x:p.y});toast(vertical?'垂直ガイドを追加しました':'水平ガイドを追加しました');render();return;}
    const handle=hitLogoHandle(s);if(handle&&!state.logoTransform.lockSize){pushHistory();state.dragging={type:handle,start:p,initial:{...state.logoTransform}};return;}
    const hit=hitMeasurement(raw);if(hit){pushHistory();state.selectedMeasurement=hit.m.id;state.selectedLogo=false;state.dragging=hit.key?{type:'measure-point',m:hit.m,key:hit.key}:{type:'measure-line',m:hit.m,start:raw,a:{...hit.m.a},b:{...hit.m.b}};switchTab('results');renderResults();render();return;}
    if(pointInLogo(raw)){state.selectedLogo=true;state.selectedMeasurement=null;if(!state.logoTransform.lockPosition){pushHistory();state.dragging={type:'logo',start:raw,initial:{...state.logoTransform}};}switchTab('logo');render();return;}
    state.selectedLogo=false;state.selectedMeasurement=null;renderResults();render();
  }

  function onPointerMove(e){
    if(!state.image)return;const s=pointerPos(e),raw=screenToImage(s),p=snapPoint(raw,e.shiftKey);state.pointer={screen:s,image:p,snapLabel:p.snapLabel};updateCursorPosition(raw);
    if(state.draft){state.draft.b=p;updateLoupe(s,p);render();}
    if(!state.dragging){render();return;}
    const d=state.dragging;
    if(d.type==='pan'){state.panX=d.panX+s.x-d.start.x;state.panY=d.panY+s.y-d.start.y;render();return;}
    if(d.type==='logo'){let dx=raw.x-d.start.x,dy=raw.y-d.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}state.logoTransform.x=d.initial.x+dx;state.logoTransform.y=d.initial.y+dy;updateLogoInputs();render();return;}
    if(d.type==='rotate'){const l=d.initial,c={x:l.x+l.w/2,y:l.y+l.h/2};state.logoTransform.rotation=Math.atan2(raw.y-c.y,raw.x-c.x)*180/Math.PI+90;updateLogoInputs();render();return;}
    if(d.type.startsWith('resize')){const l=d.initial,index=+d.type.split('-')[1],signs=[[-1,-1],[1,-1],[1,1],[-1,1]][index],sx=signs[0],sy=signs[1],c={x:l.x+l.w/2,y:l.y+l.h/2},r=-l.rotation*Math.PI/180,dx=raw.x-c.x,dy=raw.y-c.y,q={x:dx*Math.cos(r)-dy*Math.sin(r),y:dx*Math.sin(r)+dy*Math.cos(r)},opp={x:-sx*l.w/2,y:-sy*l.h/2};let nw=Math.max(5,sx*(q.x-opp.x)),nh=Math.max(5,sy*(q.y-opp.y));if(state.logoTransform.keepRatio){const ar=l.w/l.h;if(nw/l.w>=nh/l.h)nh=nw/ar;else nw=nh*ar;}const dragged={x:opp.x+sx*nw,y:opp.y+sy*nh},localCenter={x:(opp.x+dragged.x)/2,y:(opp.y+dragged.y)/2},rr=l.rotation*Math.PI/180,newCenter={x:c.x+localCenter.x*Math.cos(rr)-localCenter.y*Math.sin(rr),y:c.y+localCenter.x*Math.sin(rr)+localCenter.y*Math.cos(rr)};state.logoTransform.w=nw;state.logoTransform.h=nh;state.logoTransform.x=newCenter.x-nw/2;state.logoTransform.y=newCenter.y-nh/2;updateLogoInputs();render();return;}
    if(d.type==='measure-point'){d.m[d.key]={x:p.x,y:p.y};renderResults();render();return;}
    if(d.type==='measure-line'){let dx=raw.x-d.start.x,dy=raw.y-d.start.y;if(e.shiftKey){if(Math.abs(dx)>=Math.abs(dy))dy=0;else dx=0;}d.m.a={x:d.a.x+dx,y:d.a.y+dy};d.m.b={x:d.b.x+dx,y:d.b.y+dy};renderResults();render();}
  }

  function onPointerUp(){if(state.dragging&&state.dragging.type!=='pan'){saveLocal();syncAllControls();}state.dragging=null;canvas.style.cursor=state.tool==='pan'?'grab':state.tool==='measure'||state.tool==='calibrate'||state.tool==='color'?'crosshair':'default';hideLoupe();}

  function updateLoupe(screen,p){if(!state.loupe)return;const box=$('loupe'),lc=box.querySelector('canvas'),lctx=lc.getContext('2d');box.hidden=false;let x=screen.x+22,y=screen.y-180;if(x+150>state.viewportW)x=screen.x-172;if(y<5)y=screen.y+22;box.style.left=x+'px';box.style.top=y+'px';lctx.imageSmoothingEnabled=false;lctx.clearRect(0,0,140,140);const crop=28;lctx.drawImage(canvas,(screen.x-crop/2)*state.dpr,(screen.y-crop/2)*state.dpr,crop*state.dpr,crop*state.dpr,0,0,140,140);lctx.strokeStyle='#ff5a36';lctx.lineWidth=1;lctx.beginPath();lctx.moveTo(70,0);lctx.lineTo(70,140);lctx.moveTo(0,70);lctx.lineTo(140,70);lctx.stroke();box.querySelector('span').textContent=`${fmt(p.x,1)} px, ${fmt(p.y,1)} px`;}
  function hideLoupe(){$('loupe').hidden=true;}
  function updateCursorPosition(p){if(!state.image)return;const unit=state.mmPerPx?'mm':'px',k=state.mmPerPx||1;$('cursorPosition').textContent=`X: ${fmt(p.x*k)} ${unit} / Y: ${fmt(p.y*k)} ${unit}`;}

  function renderResults(){
    const list=$('resultList');list.querySelectorAll('.result-item').forEach(n=>n.remove());$('resultsEmpty').style.display=state.measurements.length?'none':'block';$('measurementCount').textContent=state.measurements.length;$('summaryCount').textContent=state.measurements.length;
    state.measurements.forEach((m,i)=>{const v=measurementValues(m),el=document.createElement('article');el.className='result-item'+(state.selectedMeasurement===m.id?' selected':'');el.dataset.id=m.id;el.innerHTML=`<div class="result-head"><span class="result-color" style="background:${m.color}"></span><input class="result-name" value="${escapeHtml(m.name)}" aria-label="測定名"><button class="result-delete" title="削除">×</button></div><div class="result-distance">${fmt(v.d)} <small>${v.unit}</small></div><div class="result-components"><span>水平 ${fmt(v.dx)} ${v.unit}</span><span>垂直 ${fmt(v.dy)} ${v.unit}</span></div>${m.snapA||m.snapB?`<div class="snap-tags">${m.snapA?`<span>${escapeHtml(m.snapA)}</span>`:''}${m.snapB?`<span>${escapeHtml(m.snapB)}</span>`:''}</div>`:''}`;el.addEventListener('click',()=>{state.selectedMeasurement=m.id;state.selectedLogo=false;renderResults();render();});el.querySelector('.result-name').addEventListener('change',e=>{pushHistory();m.name=e.target.value;saveLocal();});el.querySelector('.result-delete').addEventListener('click',e=>{e.stopPropagation();pushHistory();state.measurements=state.measurements.filter(x=>x.id!==m.id);renderResults();render();saveLocal();});list.appendChild(el);});
  }
  function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

  function showLogoControls(){$('logoEmpty').hidden=true;$('logoControls').hidden=false;$('logoPreview').src=state.logoSrc;$('logoFileName').textContent=state.logoName;$('logoPixelSize').textContent=`${state.logoNaturalW} × ${state.logoNaturalH} px`;updateLogoInputs();}
  function updateLogoInputs(){
    if(!state.logo)return;const l=state.logoTransform,k=state.mmPerPx||1,unitScale=state.mmPerPx?1:k;
    $('logoX').value=fmt(l.x*k,2);$('logoY').value=fmt(l.y*k,2);$('logoW').value=fmt(l.w*k,2);$('logoH').value=fmt(l.h*k,2);$('logoRotation').value=Math.round(l.rotation);$('logoRotation').nextElementSibling.textContent=Math.round(l.rotation)+'°';$('logoOpacity').value=Math.round(l.opacity*100);$('logoOpacity').nextElementSibling.textContent=Math.round(l.opacity*100)+'%';$('logoVisible').checked=l.visible;$('logoKeepRatio').checked=l.keepRatio;$('lockPosition').checked=l.lockPosition;$('lockSize').checked=l.lockSize;
    document.querySelectorAll('#logoPanel .field-grid label').forEach(x=>{const span=x.querySelector('span');if(span)span.lastChild.textContent=state.mmPerPx?' mm':' px';});
  }

  function switchTab(name){document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));$(`${name}Panel`).classList.add('active');}

  function syncAllControls(){
    updateImageMeta();updateScaleUI();renderResults();updateColorUI();activateScaleMethod(state.scaleMethod,false);if(state.logo)showLogoControls();$('gridToggle').checked=state.grid;$('snapToggle').checked=state.snap;$('snapDistance').value=state.snapDistance;$('snapDistance').nextElementSibling.textContent=state.snapDistance+' px';$('gridSize').value=state.gridMm;$('snapImage').checked=state.snapImage;$('snapLogo').checked=state.snapLogo;$('snapPoints').checked=state.snapPoints;$('snapGrid').checked=state.snapGrid;$('loupeToggle').checked=state.loupe;$('precision').value=state.precision;updateHistoryButtons();
  }

  function download(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),500);}
  function exportProject(){if(!state.image){toast('先に画像を読み込んでください');return;}const data={version:1,createdAt:new Date().toISOString(),image:{name:state.imageName,src:state.imageSrc},logo:state.logo?{name:state.logoName,src:state.logoSrc,naturalW:state.logoNaturalW,naturalH:state.logoNaturalH,transform:state.logoTransform}:null,settings:{mmPerPx:state.mmPerPx,scaleMethod:state.scaleMethod,widthMm:state.widthMm,heightMm:state.heightMm,dpi:state.dpi,reference:state.reference,grid:state.grid,gridMm:state.gridMm,snap:state.snap,snapDistance:state.snapDistance,snapImage:state.snapImage,snapLogo:state.snapLogo,snapPoints:state.snapPoints,snapGrid:state.snapGrid,precision:state.precision},measurements:state.measurements,guides:state.guides,currentColor:state.currentColor,colorHistory:state.colorHistory};download(`measurelab-${Date.now()}.json`,new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));toast('プロジェクトを保存しました');}
  function importProject(file){const r=new FileReader();r.onload=async()=>{try{const d=JSON.parse(r.result);if(!d.image?.src)throw new Error();const img=await loadSrc(d.image.src);state.image=img;state.imageSrc=d.image.src;state.imageName=d.image.name||'project-image';state.imageW=img.naturalWidth;state.imageH=img.naturalHeight;Object.assign(state,d.settings||{});state.measurements=d.measurements||[];state.guides=d.guides||[];state.currentColor=d.currentColor||null;state.colorHistory=d.colorHistory||[];if(d.logo?.src){state.logo=await loadSrc(d.logo.src);state.logoSrc=d.logo.src;state.logoName=d.logo.name;state.logoNaturalW=d.logo.naturalW||state.logo.naturalWidth;state.logoNaturalH=d.logo.naturalH||state.logo.naturalHeight;Object.assign(state.logoTransform,d.logo.transform||{});}else{state.logo=null;}$('emptyState').style.display='none';syncAllControls();fitImage();toast('プロジェクトを読み込みました');}catch{toast('プロジェクトファイルを読み込めませんでした');}};r.readAsText(file);}
  function loadSrc(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});}
  function exportCsv(){if(!state.measurements.length){toast('測定結果がありません');return;}const rows=[['No','名前','距離','水平差','垂直差','単位','始点X','始点Y','終点X','終点Y','始点スナップ','終点スナップ']];state.measurements.forEach((m,i)=>{const v=measurementValues(m),k=state.mmPerPx||1;rows.push([i+1,m.name,fmt(v.d),fmt(v.dx),fmt(v.dy),v.unit,fmt(m.a.x*k),fmt(m.a.y*k),fmt(m.b.x*k),fmt(m.b.y*k),m.snapA||'',m.snapB||'']);});const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');download('measurements.csv',new Blob([csv],{type:'text/csv;charset=utf-8'}));}
  function exportPng(){if(!state.image){toast('画像がありません');return;}const prev={z:state.zoom,x:state.panX,y:state.panY,vw:state.viewportW,vh:state.viewportH,selectedLogo:state.selectedLogo};const out=document.createElement('canvas'),scale=Math.min(1,4000/Math.max(state.imageW,state.imageH));out.width=Math.round(state.imageW*scale);out.height=Math.round(state.imageH*scale);const octx=out.getContext('2d');const oldCtx=ctx;state.zoom=scale;state.panX=0;state.panY=0;state.viewportW=out.width;state.viewportH=out.height;state.selectedLogo=false;window.__exportCtx=octx;drawExport(octx);Object.assign(state,{zoom:prev.z,panX:prev.x,panY:prev.y,viewportW:prev.vw,viewportH:prev.vh,selectedLogo:prev.selectedLogo});out.toBlob(b=>download('measurelab-result.png',b),'image/png');render();}
  function drawExport(c){c.drawImage(state.image,0,0,state.imageW*state.zoom,state.imageH*state.zoom);if(state.logo&&state.logoTransform.visible){const l=state.logoTransform;c.save();c.translate((l.x+l.w/2)*state.zoom,(l.y+l.h/2)*state.zoom);c.rotate(l.rotation*Math.PI/180);c.globalAlpha=l.opacity;c.drawImage(state.logo,-l.w*state.zoom/2,-l.h*state.zoom/2,l.w*state.zoom,l.h*state.zoom);c.restore();}state.measurements.forEach((m,i)=>{const a={x:m.a.x*state.zoom,y:m.a.y*state.zoom},b={x:m.b.x*state.zoom,y:m.b.y*state.zoom},col=m.color||COLORS[i%COLORS.length],v=measurementValues(m);c.strokeStyle=col;c.lineWidth=Math.max(2,state.zoom*2);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();c.fillStyle=col;for(const p of[a,b]){c.beginPath();c.arc(p.x,p.y,Math.max(4,state.zoom*5),0,Math.PI*2);c.fill();}c.font=`700 ${Math.max(12,state.zoom*14)}px sans-serif`;c.textAlign='center';c.fillStyle='#182523';c.fillText(`${fmt(v.d)} ${v.unit}`,(a.x+b.x)/2,(a.y+b.y)/2-8);});}

  function workspaceRecord(){return{savedAt:Date.now(),image:state.image?{name:state.imageName,src:state.imageSrc}:null,logo:state.logo?{name:state.logoName,src:state.logoSrc,naturalW:state.logoNaturalW,naturalH:state.logoNaturalH}:null,settings:{mmPerPx:state.mmPerPx,scaleMethod:state.scaleMethod,widthMm:state.widthMm,heightMm:state.heightMm,dpi:state.dpi,reference:state.reference,grid:state.grid,gridMm:state.gridMm,snap:state.snap,snapDistance:state.snapDistance,snapImage:state.snapImage,snapLogo:state.snapLogo,snapPoints:state.snapPoints,snapGrid:state.snapGrid,precision:state.precision,loupe:state.loupe},measurements:state.measurements,guides:state.guides,logoTransform:state.logoTransform,currentColor:state.currentColor,colorHistory:state.colorHistory};}
  function openWorkspaceDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open('measurelab',1);req.onupgradeneeded=()=>req.result.createObjectStore('workspace');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  async function persistWorkspace(){try{const db=await openWorkspaceDb();const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put(workspaceRecord(),'latest');tx.oncomplete=()=>db.close();}catch{}}
  async function restoreWorkspace(){try{const db=await openWorkspaceDb();const data=await new Promise((resolve,reject)=>{const tx=db.transaction('workspace');const req=tx.objectStore('workspace').get('latest');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();if(!data?.image?.src)return;state.image=await loadSrc(data.image.src);state.imageSrc=data.image.src;state.imageName=data.image.name||'autosave-image';state.imageW=state.image.naturalWidth;state.imageH=state.image.naturalHeight;Object.assign(state,data.settings||{});state.measurements=data.measurements||[];state.guides=data.guides||[];state.currentColor=data.currentColor||null;state.colorHistory=data.colorHistory||[];Object.assign(state.logoTransform,data.logoTransform||{});if(data.logo?.src){state.logo=await loadSrc(data.logo.src);state.logoSrc=data.logo.src;state.logoName=data.logo.name||'logo';state.logoNaturalW=data.logo.naturalW||state.logo.naturalWidth;state.logoNaturalH=data.logo.naturalH||state.logo.naturalHeight;}$('emptyState').style.display='none';syncAllControls();fitImage();toast('前回の作業を自動復元しました');}catch{}}
  function saveLocal(){try{const d=workspaceRecord();delete d.image;delete d.logo;localStorage.setItem('measurelab-settings',JSON.stringify(d));clearTimeout(saveLocal.timer);saveLocal.timer=setTimeout(persistWorkspace,250);}catch{}}
  function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2200);}

  function bind(){
    window.addEventListener('resize',resizeCanvas);new ResizeObserver(resizeCanvas).observe(wrap);
    ['imageInput','emptyImageInput'].forEach(id=>$(id).addEventListener('change',e=>{loadImageFile(e.target.files[0]);e.target.value='';}));
    ['logoInput','logoInputAlt'].forEach(id=>$(id).addEventListener('change',e=>{loadImageFile(e.target.files[0],true);e.target.value='';}));
    document.querySelectorAll('.tool[data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
    document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
    document.querySelectorAll('#scaleMethod button').forEach(b=>b.addEventListener('click',()=>activateScaleMethod(b.dataset.method)));
    $('widthMm').addEventListener('change',e=>applyScale('width',+e.target.value));$('heightMm').addEventListener('change',e=>applyScale('height',+e.target.value));$('dpiInput').addEventListener('change',e=>{state.dpi=+e.target.value;applyScale('dpi',state.dpi);});
    $('startCalibrationBtn').addEventListener('click',()=>setTool('calibrate'));
    $('calibrationForm').addEventListener('submit',e=>{e.preventDefault();const mm=+$('calibrationMmInput').value,px=distance(state.reference.a,state.reference.b);pushHistory();state.reference.realMm=mm;state.mmPerPx=mm/px;state.widthMm=state.imageW*state.mmPerPx;state.heightMm=state.imageH*state.mmPerPx;activateScaleMethod('reference');$('calibrationModal').hidden=true;updateScaleUI();updateLogoInputs();renderResults();setTool('measure');toast('縮尺を設定しました');saveLocal();});
    $('cancelCalibrationBtn').addEventListener('click',()=>{$('calibrationModal').hidden=true;state.reference=null;setTool('select');});
    $('deleteReferenceBtn').addEventListener('click',()=>{if(!state.reference)return;pushHistory();state.reference=null;if(state.scaleMethod==='reference'){state.mmPerPx=null;state.widthMm=null;state.heightMm=null;}updateScaleUI();updateLogoInputs();renderResults();render();saveLocal();toast('基準線と基準線による縮尺を削除しました');});
    $('zoomInBtn').addEventListener('click',()=>setZoom(state.zoom*1.2));$('zoomOutBtn').addEventListener('click',()=>setZoom(state.zoom/1.2));$('fitBtn').addEventListener('click',fitImage);
    $('gridToggle').addEventListener('change',e=>{state.grid=e.target.checked;render();saveLocal();});$('snapToggle').addEventListener('change',e=>{state.snap=e.target.checked;render();saveLocal();});
    $('snapDistance').addEventListener('input',e=>{state.snapDistance=+e.target.value;e.target.nextElementSibling.textContent=e.target.value+' px';});$('gridSize').addEventListener('change',e=>{state.gridMm=Math.max(2,+e.target.value||10);render();saveLocal();});
    [['snapImage','snapImage'],['snapLogo','snapLogo'],['snapPoints','snapPoints'],['snapGrid','snapGrid'],['loupeToggle','loupe']].forEach(([id,key])=>$(id).addEventListener('change',e=>{state[key]=e.target.checked;saveLocal();}));$('precision').addEventListener('change',e=>{state.precision=+e.target.value;renderResults();render();saveLocal();});
    canvas.addEventListener('pointerdown',onPointerDown);canvas.addEventListener('pointermove',onPointerMove);canvas.addEventListener('pointerup',onPointerUp);canvas.addEventListener('pointercancel',onPointerUp);canvas.addEventListener('auxclick',e=>{if(e.button===1)e.preventDefault();});canvas.addEventListener('wheel',e=>{e.preventDefault();setZoom(state.zoom*(e.deltaY<0?1.12:.89),pointerPos(e));},{passive:false});
    wrap.addEventListener('dragover',e=>{e.preventDefault();$('dropHint').classList.add('show');});wrap.addEventListener('dragleave',()=> $('dropHint').classList.remove('show'));wrap.addEventListener('drop',e=>{e.preventDefault();$('dropHint').classList.remove('show');loadImageFile([...e.dataTransfer.files].find(f=>f.type.startsWith('image/')));});
    $('undoBtn').addEventListener('click',undo);$('redoBtn').addEventListener('click',redo);$('exportProjectBtn').addEventListener('click',exportProject);$('importProjectBtn').addEventListener('click',()=>$('projectInput').click());$('projectInput').addEventListener('change',e=>importProject(e.target.files[0]));
    $('csvBtn').addEventListener('click',exportCsv);$('pngBtn').addEventListener('click',exportPng);$('clearMeasurementsBtn').addEventListener('click',()=>{if(!state.measurements.length)return;pushHistory();state.measurements=[];renderResults();render();saveLocal();toast('測定結果をすべて削除しました');});
    $('activateColorPickerBtn').addEventListener('click',()=>setTool('color'));$('copyColorBtn').addEventListener('click',()=>copyColor());
    $('removeLogoBtn').addEventListener('click',()=>{pushHistory();state.logo=null;state.logoSrc='';state.selectedLogo=false;$('logoEmpty').hidden=false;$('logoControls').hidden=true;render();saveLocal();toast('ロゴを削除しました');});
    [['logoVisible','visible'],['logoKeepRatio','keepRatio'],['lockPosition','lockPosition'],['lockSize','lockSize']].forEach(([id,key])=>$(id).addEventListener('change',e=>{pushHistory();state.logoTransform[key]=e.target.checked;render();saveLocal();}));
    $('logoRotation').addEventListener('pointerdown',pushHistory);$('logoRotation').addEventListener('input',e=>{state.logoTransform.rotation=+e.target.value;e.target.nextElementSibling.textContent=e.target.value+'°';render();});$('logoRotation').addEventListener('change',saveLocal);$('logoOpacity').addEventListener('pointerdown',pushHistory);$('logoOpacity').addEventListener('input',e=>{state.logoTransform.opacity=+e.target.value/100;e.target.nextElementSibling.textContent=e.target.value+'%';render();});$('logoOpacity').addEventListener('change',saveLocal);
    [['logoX','x'],['logoY','y'],['logoW','w'],['logoH','h']].forEach(([id,key])=>$(id).addEventListener('change',e=>{pushHistory();const k=state.mmPerPx||1,old=state.logoTransform[key];state.logoTransform[key]=+e.target.value/k;if((key==='w'||key==='h')&&state.logoTransform.keepRatio){const ar=state.logoNaturalW/state.logoNaturalH;if(key==='w')state.logoTransform.h=state.logoTransform.w/ar;else state.logoTransform.w=state.logoTransform.h*ar;}if(!Number.isFinite(state.logoTransform[key]))state.logoTransform[key]=old;updateLogoInputs();render();saveLocal();}));
    document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if(e.code==='Space'){state.spaceDown=true;e.preventDefault();}if(e.key==='v')setTool('select');if(e.key==='m')setTool('measure');if(e.key==='c')setTool('calibrate');if(e.key==='g')setTool('guide');if(e.key==='i')setTool('color');if(e.key==='h')setTool('pan');if(e.key==='0')fitImage();if(e.key==='Escape'){state.draft=null;state.dragging=null;hideLoupe();render();}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){const step=e.shiftKey?10:1,dx=e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,dy=e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0;if(state.selectedLogo&&state.logo&&!state.logoTransform.lockPosition){pushHistory();state.logoTransform.x+=dx;state.logoTransform.y+=dy;updateLogoInputs();render();}else if(state.selectedMeasurement){const m=state.measurements.find(x=>x.id===state.selectedMeasurement);if(m){pushHistory();m.a.x+=dx;m.b.x+=dx;m.a.y+=dy;m.b.y+=dy;renderResults();render();}}e.preventDefault();}});
    document.addEventListener('keyup',e=>{if(e.code==='Space')state.spaceDown=false;});
  }

  bind();resizeCanvas();syncAllControls();restoreWorkspace();
})();
