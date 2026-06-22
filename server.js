const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map();
const WORDS = ['moonlight', 'cupcake', 'volcano', 'penguin', 'rainbow', 'spaceship', 'popcorn', 'jellyfish', 'campfire', 'snowman', 'treasure', 'guitar', 'tornado', 'pancake', 'octopus'];

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

const body = req => new Promise((resolve, reject) => {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
});

const clean = (value, max = 24) => String(value || '').trim().replace(/[<>]/g, '').slice(0, max);
const code = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out;
  do { out = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms.has(out));
  return out;
};
const player = name => ({ id: crypto.randomUUID(), token: crypto.randomUUID(), name: clean(name) || 'Player', score: 0, guessed: false });
const publicRoom = (room, who) => ({
  code: room.code, phase: room.phase, round: room.round, maxRounds: room.maxRounds,
  players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, guessed: p.guessed })),
  hostId: room.hostId, drawerId: room.drawerId, drawerName: room.players.find(p => p.id === room.drawerId)?.name || '',
  word: who?.id === room.drawerId || room.phase !== 'playing' ? room.word : '', hint: room.phase === 'playing' ? room.word.replace(/[a-z]/gi, '_') : room.word,
  secondsLeft: room.phase === 'playing' ? Math.max(0, Math.ceil((room.endsAt - Date.now()) / 1000)) : 0,
  messages: room.messages.slice(-40), strokes: room.strokes, winner: room.winner || ''
});
const auth = (room, token) => room?.players.find(p => p.token === token);
const addMessage = (room, text, type = 'system', name = '') => room.messages.push({ id: crypto.randomUUID(), text, type, name, at: Date.now() });

function nextRound(room) {
  room.round += 1;
  if (room.round > room.maxRounds || room.players.length < 2) {
    room.phase = 'finished';
    room.word = '';
    room.winner = [...room.players].sort((a, b) => b.score - a.score)[0]?.name || '';
    addMessage(room, `${room.winner} wins the game!`, 'win');
    return;
  }
  room.phase = 'playing';
  room.drawerIndex = (room.drawerIndex + 1) % room.players.length;
  room.drawerId = room.players[room.drawerIndex].id;
  room.word = WORDS[Math.floor(Math.random() * WORDS.length)];
  room.strokes = [];
  room.players.forEach(p => { p.guessed = false; });
  room.endsAt = Date.now() + 60000;
  addMessage(room, `Round ${room.round}: ${room.players[room.drawerIndex].name} is drawing!`);
}

setInterval(() => {
  for (const [key, room] of rooms) {
    if (room.phase === 'playing' && Date.now() >= room.endsAt) {
      addMessage(room, `Time's up! The word was ${room.word}.`, 'reveal');
      room.phase = 'reveal';
      room.revealUntil = Date.now() + 3500;
    } else if (room.phase === 'reveal' && Date.now() >= room.revealUntil) nextRound(room);
    if (Date.now() - room.updatedAt > 1000 * 60 * 60 * 6) rooms.delete(key);
  }
}, 500);

async function api(req, res, pathname) {
  const data = req.method === 'POST' ? await body(req) : {};
  if (pathname === '/api/create' && req.method === 'POST') {
    const p = player(data.name); const c = code();
    rooms.set(c, { code: c, players: [p], hostId: p.id, phase: 'lobby', round: 0, maxRounds: 6, drawerIndex: -1, drawerId: '', word: '', endsAt: 0, messages: [], strokes: [], updatedAt: Date.now() });
    return json(res, 200, { code: c, token: p.token, playerId: p.id });
  }
  if (pathname === '/api/join' && req.method === 'POST') {
    const room = rooms.get(clean(data.code, 4).toUpperCase());
    if (!room) return json(res, 404, { error: 'Room not found. Check that code?' });
    if (room.phase !== 'lobby') return json(res, 409, { error: 'That game has already started.' });
    const p = player(data.name); room.players.push(p); room.updatedAt = Date.now();
    addMessage(room, `${p.name} joined the room.`);
    return json(res, 200, { code: room.code, token: p.token, playerId: p.id });
  }
  const match = pathname.match(/^\/api\/room\/([A-Z]{4})(?:\/(start|stroke|clear|guess|restart))?$/);
  if (!match) return json(res, 404, { error: 'Not found' });
  const room = rooms.get(match[1]);
  if (!room) return json(res, 404, { error: 'Room expired.' });
  const token = req.headers.authorization?.replace('Bearer ', '') || new URL(req.url, 'http://x').searchParams.get('token');
  const who = auth(room, token);
  if (!who) return json(res, 401, { error: 'Player not recognized.' });
  room.updatedAt = Date.now();
  const action = match[2];
  if (!action && req.method === 'GET') return json(res, 200, publicRoom(room, who));
  if (action === 'start' && req.method === 'POST') {
    if (who.id !== room.hostId) return json(res, 403, { error: 'Only the host can start.' });
    if (room.players.length < 2) return json(res, 409, { error: 'Invite at least one friend first.' });
    room.round = 0; room.drawerIndex = -1; room.players.forEach(p => p.score = 0); room.messages = []; room.winner = '';
    nextRound(room); return json(res, 200, publicRoom(room, who));
  }
  if (action === 'restart' && req.method === 'POST') {
    if (who.id !== room.hostId) return json(res, 403, { error: 'Only the host can restart.' });
    room.phase = 'lobby'; room.round = 0; room.messages = []; room.strokes = []; room.winner = '';
    return json(res, 200, publicRoom(room, who));
  }
  if (action === 'stroke' && req.method === 'POST') {
    if (who.id !== room.drawerId || room.phase !== 'playing') return json(res, 403, { error: 'Not drawing now.' });
    if (room.strokes.length < 12000 && data.stroke) room.strokes.push(data.stroke);
    return json(res, 200, { ok: true });
  }
  if (action === 'clear' && req.method === 'POST') {
    if (who.id === room.drawerId) room.strokes = [];
    return json(res, 200, { ok: true });
  }
  if (action === 'guess' && req.method === 'POST') {
    const guess = clean(data.guess, 48);
    if (!guess || room.phase !== 'playing') return json(res, 200, { ok: true });
    if (who.id === room.drawerId) return json(res, 403, { error: 'Keep drawing—no hints in chat!' });
    if (guess.toLowerCase() === room.word.toLowerCase() && !who.guessed) {
      who.guessed = true;
      const bonus = Math.max(20, Math.ceil((room.endsAt - Date.now()) / 1000));
      who.score += 100 + bonus; const drawer = room.players.find(p => p.id === room.drawerId); if (drawer) drawer.score += 25;
      addMessage(room, `${who.name} guessed it! +${100 + bonus}`, 'correct');
      const guessers = room.players.filter(p => p.id !== room.drawerId);
      if (guessers.every(p => p.guessed)) { room.phase = 'reveal'; room.revealUntil = Date.now() + 2500; }
    } else if (!who.guessed) addMessage(room, guess, 'guess', who.name);
    return json(res, 200, { ok: true });
  }
  return json(res, 405, { error: 'Nope.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/health') return json(res, 200, { status: 'ok' });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const full = path.resolve(PUBLIC, file);
    if (!(full === PUBLIC || full.startsWith(PUBLIC + path.sep)) || !fs.existsSync(full)) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(full); const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); fs.createReadStream(full).pipe(res);
  } catch (e) { json(res, 500, { error: 'Something went sideways.' }); }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Doodle Dash is running on port ${PORT}`));
