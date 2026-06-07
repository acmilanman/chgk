const express = require('express');
const path = require('path');
const { WebSocketServer } = require('ws');
const logger = require('./lib/logger');
const state = require('./lib/state');
const { createRouter: createAdminHttpRouter } = require('./api/admin-http');
const { handle: handleAdmin } = require('./api/admin-ws');
const { handle: handleCaptain } = require('./api/captain-ws');
const { handle: handlePlayer } = require('./api/player-ws');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const SOUNDS_DIR = path.join(DATA_DIR, 'sounds');
const IMAGES_DIR = path.join(DATA_DIR, 'images');

app.use(express.static(path.join(__dirname, 'public')));
app.use('/sounds', express.static(SOUNDS_DIR, { maxAge: '1d' }));
app.use('/i', express.static(IMAGES_DIR, { maxAge: '1d' }));

app.get('/', (req, res) => res.redirect('/captain'));
app.get('/captain', (req, res) => res.sendFile(path.join(__dirname, 'public', 'captain.html')));
app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use(express.json({ limit: '10mb' }));
app.use('/admin', createAdminHttpRouter(state));

const server = app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
});

module.exports = server;

const wss = new WebSocketServer({ server });

function getWebSocketRole(req) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    return (url.searchParams.get('role') || '').toLowerCase();
  } catch {
    return '';
  }
}

wss.on('connection', (ws, req) => {
  const role = getWebSocketRole(req);
  ws.role = role;
  ws.teamId = null;
  ws.deviceId = null;
  ws._remoteIp = req.socket.remoteAddress;
  ws._remoteUA = req.headers['user-agent'] || '';

  if (role === 'admin') state.clients.admin.add(ws);
  else if (role === 'captain') state.clients.captains.add(ws);
  else if (role === 'player') state.clients.players.add(ws);
  else { ws.close(); return; }

  ws.on('close', () => {
    if (ws.role === 'admin') state.clients.admin.delete(ws);
    if (ws.role === 'player') state.clients.players.delete(ws);
    if (ws.role === 'captain') {
      state.clients.captains.delete(ws);
      if (ws.deviceId) {
        const assignedTeam = state.deviceToTeam.get(ws.deviceId);
        if (assignedTeam != null) {
          state.deviceToTeam.delete(ws.deviceId);
          const t = state.game.teams.find(x => x.id === assignedTeam);
          if (t) t.activeCaptain = false;
        }
      }
      if (ws.teamId != null) {
        const boundDev = state.teamToDevice.get(ws.teamId);
        if (boundDev === ws.deviceId) state.teamToDevice.delete(ws.teamId);
        ws.teamId = null;
      }
      state.broadcast('teams_update', { teams: state.game.teams });
      state.autoSave();
    }
  });

  if (role === 'captain') {
    const capPayload = {
      teams: state.game.teams,
      shown: state.getCachedShown(),
      timer: state.game.timer,
      soundEnabled: state.game.soundEnabledCaptains
    };
    if (state.game.soundEnabledCaptains) capPayload.sounds = state.cachedSounds;
    state.safeSend(ws, { type: 'init_for_captain', payload: capPayload });
  }

  if (role === 'player') {
    const plyPayload = {
      shown: state.getCachedShown(),
      timer: state.game.timer,
      soundEnabled: state.game.soundEnabledScreens
    };
    if (state.game.soundEnabledScreens) plyPayload.sounds = state.cachedSounds;
    state.safeSend(ws, { type: 'init_for_player', payload: plyPayload });
    state.safeSend(ws, { type: 'break_table', payload: state.getCachedScores() });
  }

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || !msg.type) return;

    if (ws.role === 'admin') handleAdmin(ws, msg, state);
    else if (ws.role === 'captain') handleCaptain(ws, msg, state);
    else if (ws.role === 'player') handlePlayer(ws, msg, state);
  });
});

// Timer tick
setInterval(() => state.tickTimer(), 250);

// Heartbeat
setInterval(() => {
  state.clients.admin.forEach(ws => { if (ws.readyState === 1) ws.ping(); });
  state.clients.captains.forEach(ws => { if (ws.readyState === 1) ws.ping(); });
  state.clients.players.forEach(ws => { if (ws.readyState === 1) ws.ping(); });
}, 10000);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing server...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
});
