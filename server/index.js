/* ============================================================
   index.js — server entry point
   - express + REST (save routes)
   - socket.io rooms / sync / run / visualizer events
   - wires rooms.js (data) + runner.js (execution) + engines (traces)
============================================================ */
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Server } = require('socket.io');
const router = express.Router();

const rooms = require('./rooms');
const { LANGUAGES, getPythonCmd, runCodeLocally } = require('./runner');
const saveRoutes = require('./save-routes');

const app = express();
app.use(express.json());
app.use('/api', saveRoutes); // /api/save, /api/saved/...

// React production build (created later with: cd client && npm run build)
const dist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(dist)) app.use(express.static(dist));

const server = http.createServer(app);
const io = new Server(server);

/* ---------- memory visualizer engines ---------- */
const ENGINE_JS = path.join(__dirname, 'engines', 'viz-js.js');
const ENGINE_PY = path.join(__dirname, 'engines', 'viz-python.py');
const ENGINE_CPP = path.join(__dirname, 'engines', 'viz-cpp.js');
const ENGINE_JAVA = path.join(__dirname, 'engines', 'viz-java.js');

function runViz(roomId, code, language) {
    let child;
    let timeoutMs = 6000;
    if (language === 'python') {
        child = spawn(getPythonCmd(), [ENGINE_PY], { cwd: __dirname, windowsHide: true });
    } else if (language === 'c' || language === 'cpp') {
        child = spawn(process.execPath, [ENGINE_CPP, language], { cwd: __dirname, windowsHide: true });
        timeoutMs = 15000;
    } else if (language === 'java') {
        child = spawn(process.execPath, [ENGINE_JAVA], { cwd: __dirname, windowsHide: true });
        timeoutMs = 25000;
    } else {
        child = spawn(process.execPath, [ENGINE_JS], { cwd: __dirname, windowsHide: true });
    }

    let out = '';
    let finished = false;
    const done = (payload) => {
        if (finished) return;
        finished = true;
        io.to(roomId).emit('viz-trace', payload);
    };

    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => done({ ok: false, error: 'Could not start the visualizer' }));
    child.on('close', () => {
        try { done(JSON.parse(out)); }
        catch { done({ ok: false, error: 'Visualizer could not analyze this code' }); }
    });
    child.stdin.on('error', () => { });
    child.stdin.write(code);
    child.stdin.end();

    setTimeout(() => {
        try { child.kill(); } catch { }
        done({ ok: false, error: 'Visualizer timed out' });
    }, timeoutMs);
}

/* ---------- sockets ---------- */
io.on('connection', (socket) => {
    console.log('🔌 User connected:', socket.id);

    socket.on('create-room', (callback) => {
        if (typeof callback === 'function') callback(rooms.generateRoomId());
    });

    socket.on('join-room', (payload, callback) => {
        const res = rooms.joinRoom(socket.id, payload);
        if (!res.ok) return callback({ ok: false, message: res.message });

        socket.join(res.roomId);
        socket.data.roomId = res.roomId;
        socket.data.user = res.user;

        callback({ ok: true, code: res.code, language: res.language });
        io.to(res.roomId).emit('members-update', { members: res.members });
        socket.to(res.roomId).emit('user-joined', { username: res.user.username, color: res.user.color });
    });

    socket.on('code-change', ({ code }) => {
        const { roomId, user } = socket.data;
        if (!roomId || !user || !rooms.updateCode(roomId, code)) return;
        socket.to(roomId).emit('code-change', { code, username: user.username, color: user.color });
    });

    socket.on('language-change', ({ language }) => {
        const { roomId, user } = socket.data;
        if (!roomId || !user) return;
        if (!rooms.setLanguage(roomId, language)) return;
        socket.to(roomId).emit('language-change', { language, username: user.username });
    });

    socket.on('run-code', async ({ code, language }) => {
        const { roomId, user } = socket.data;
        if (!roomId || !user || !rooms.roomExists(roomId)) return;

        const file = (LANGUAGES[language] || LANGUAGES.javascript).file;
        io.to(roomId).emit('run-started', { username: user.username, file });

        const result = await runCodeLocally(code, language);
        io.to(roomId).emit('run-result', {
            username: user.username,
            stdout: result.stdout,
            stderr: result.stderr,
            compileStderr: result.compileStderr,
            exitCode: result.exitCode,
        });

        // JavaScript / Python / C / C++ / Java → animate memory for the whole room
        if (['javascript', 'python', 'c', 'cpp', 'java'].includes(language)) {
            runViz(roomId, code, language);
        }
    });

    socket.on('disconnect', () => {
        const { roomId, user } = socket.data;
        if (!roomId || !user) return;

        const res = rooms.leaveRoom(roomId, socket.id);
        if (!res) return;

        socket.to(roomId).emit('user-left', { username: user.username });
        io.to(roomId).emit('members-update', { members: res.members });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Server running → http://localhost:${PORT}`));

module.exports = router;