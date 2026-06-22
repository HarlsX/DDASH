const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = { code: localStorage.ddCode || '', token: localStorage.ddToken || '', playerId: localStorage.ddPlayer || '', room: null, lastStrokeCount: 0, drawing: false, color: '#212626', size: 5 };
const colors = ['#212626','#ef5b4c','#286cc4','#f4c84c','#4a9a75','#9b5bb5'];
const canvas = $('#canvas'), ctx = canvas.getContext('2d');
ctx.lineCap = 'round'; ctx.lineJoin = 'round';

async function request(path, data) {
  const opts = { headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) } };
  if (data !== undefined) { opts.method = 'POST'; opts.body = JSON.stringify(data); }
  const res = await fetch(path, opts); const out = await res.json();
  if (!res.ok) throw new Error(out.error || 'Something went wrong.'); return out;
}
function saveSession(out) { Object.assign(state, out); localStorage.ddCode = out.code; localStorage.ddToken = out.token; localStorage.ddPlayer = out.playerId; }
function show(id) { $$('.screen').forEach(x => x.classList.add('hidden')); $(id).classList.remove('hidden'); }
function initials(name) { return name.split(/\s+/).map(x => x[0]).join('').slice(0,2).toUpperCase(); }

$('#create').onclick = async () => { try { saveSession(await request('/api/create', { name: $('#name').value })); renderLobby(); } catch(e){ $('#home-error').textContent=e.message; } };
$('#join').onclick = async () => { try { saveSession(await request('/api/join', { name: $('#name').value, code: $('#code').value })); renderLobby(); } catch(e){ $('#home-error').textContent=e.message; } };
$('#code').addEventListener('input', e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g,''));
$('#code').addEventListener('keydown', e => { if(e.key==='Enter') $('#join').click(); });
$('#copy-code').onclick = async () => { await navigator.clipboard?.writeText(state.code); $('#copy-code small').textContent='COPIED!'; setTimeout(()=>$('#copy-code small').textContent='CLICK TO COPY',1200); };
$('#start').onclick = async () => { try { await request(`/api/room/${state.code}/start`, {}); poll(); } catch(e){ $('#lobby-error').textContent=e.message; } };
$('#clear').onclick = () => request(`/api/room/${state.code}/clear`, {});
$('#guess-form').onsubmit = async e => { e.preventDefault(); const input=$('#guess'), guess=input.value.trim(); if(!guess)return; input.value=''; try{await request(`/api/room/${state.code}/guess`,{guess});}catch(err){} };

function renderLobby() {
  show('#lobby'); $('#lobby-code').textContent = $('#big-code').textContent = state.code;
  const room=state.room; if(!room)return;
  $('#lobby-players').innerHTML=room.players.map(p=>`<div class="player-card"><div class="avatar">${initials(p.name)}</div>${p.name}${p.id===room.hostId?'<small><br>HOST</small>':''}</div>`).join('');
  const host=state.playerId===room.hostId; $('#start').classList.toggle('hidden',!host); $('#waiting').classList.toggle('hidden',host);
}
function drawStroke(s) { ctx.strokeStyle=s.color; ctx.lineWidth=s.size; ctx.beginPath(); ctx.moveTo(s.x1*canvas.width,s.y1*canvas.height); ctx.lineTo(s.x2*canvas.width,s.y2*canvas.height); ctx.stroke(); }
function redraw(strokes){ctx.clearRect(0,0,canvas.width,canvas.height);strokes.forEach(drawStroke);state.lastStrokeCount=strokes.length;}
function renderGame() {
  const r=state.room, me=r.players.find(p=>p.id===state.playerId), drawer=state.playerId===r.drawerId;
  show('#game'); $('#game-code').textContent=r.code; $('#round').textContent=`ROUND ${r.round} / ${r.maxRounds}`; $('#timer').textContent=r.secondsLeft;
  $('#status-word').textContent=drawer?r.word:r.hint.split('').join(' '); $('#turn-label').textContent=drawer?`Your word is “${r.word}” — draw it!`:`${r.drawerName} is drawing…`;
  $('#tools').classList.toggle('hidden',!drawer); $('#game').classList.toggle('drawer-mode',drawer);
  $('#scores').innerHTML=[...r.players].sort((a,b)=>b.score-a.score).map((p,i)=>`<div class="score-row ${p.id===r.drawerId?'drawer':''}"><span>${i+1}</span><span><i class="mini-avatar">${initials(p.name)}</i>${p.name}${p.id===r.drawerId?' ✎':''}</span><b>${p.score}</b></div>`).join('');
  $('#messages').innerHTML=r.messages.map(m=>`<div class="message ${m.type}">${m.name?`<strong>${m.name}</strong>`:''}${m.text}</div>`).join(''); $('#messages').scrollTop=$('#messages').scrollHeight;
  if(r.strokes.length<state.lastStrokeCount) redraw(r.strokes); else { r.strokes.slice(state.lastStrokeCount).forEach(drawStroke); state.lastStrokeCount=r.strokes.length; }
  const overlay=$('#overlay'); overlay.classList.toggle('hidden',r.phase==='playing');
  if(r.phase==='reveal') overlay.innerHTML=`The word was<br>“${r.word}”`;
  if(r.phase==='finished') overlay.innerHTML=`🏆 ${r.winner} wins!<br><button id="again" class="primary">Back to lobby</button>`;
  $('#again')?.addEventListener('click',async()=>{await request(`/api/room/${state.code}/restart`,{});poll();});
}
async function poll(){
  if(!state.code||!state.token)return;
  try { state.room=await request(`/api/room/${state.code}?token=${encodeURIComponent(state.token)}`); if(state.room.phase==='lobby')renderLobby();else renderGame(); }
  catch(e){ if(e.message.includes('expired')||e.message.includes('recognized')){localStorage.removeItem('ddCode');localStorage.removeItem('ddToken');} }
}
setInterval(poll,500);

colors.forEach((c,i)=>{const b=document.createElement('button');b.className='color'+(!i?' active':'');b.style.background=c;b.onclick=()=>{$$('.color').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.color=c};$('#colors').appendChild(b)});
$$('.size').forEach(b=>b.onclick=()=>{$$('.size').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.size=+b.dataset.size});
function pos(e){const r=canvas.getBoundingClientRect();const t=e.touches?.[0]||e;return{x:(t.clientX-r.left)/r.width,y:(t.clientY-r.top)/r.height}}
let last;
canvas.addEventListener('pointerdown',e=>{if(state.playerId!==state.room?.drawerId||state.room.phase!=='playing')return;state.drawing=true;last=pos(e);canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(!state.drawing)return;const now=pos(e),stroke={x1:last.x,y1:last.y,x2:now.x,y2:now.y,color:state.color,size:state.size};drawStroke(stroke);last=now;request(`/api/room/${state.code}/stroke`,{stroke}).catch(()=>{})});
canvas.addEventListener('pointerup',()=>state.drawing=false);canvas.addEventListener('pointercancel',()=>state.drawing=false);
if(state.code&&state.token)poll();
