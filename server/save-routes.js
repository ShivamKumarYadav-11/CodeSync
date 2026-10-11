/* ============================================================
   save-routes.js — REST endpoints for the Files feature
   Saves code as real files on disk (no database).
   Mounted in index.js as:  app.use('/api', saveRoutes)
     POST   /api/save
     GET    /api/saved/:roomId            (list)
     GET    /api/saved/:roomId/:filename  (load)
     DELETE /api/saved/:roomId/:filename  (delete)
============================================================ */
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// saved files → project root (same folder as before the refactor,
// so your previously saved files keep showing in the Files panel)
const SAVED_DIR = path.join(__dirname, '..', 'saved-code');
fs.mkdirSync(SAVED_DIR, { recursive: true });

const EXTENSIONS = { javascript: 'js', python: 'py', c: 'c', cpp: 'cpp', java: 'java' };

// keep only safe characters — blocks ../ and weird file names
function safeName(name) {
    return String(name || '').trim().replace(/[^a-zA-Z0-9-_ ]/g, '-').slice(0, 60) || 'untitled';
}

// SAVE (same name + same date = update the file)
router.post('/save', (req, res) => {
    const { roomId, name, code, language } = req.body || {};
    if (!roomId || typeof code !== 'string') {
        return res.status(400).json({ ok: false, message: 'Missing roomId or code' });
    }

    const roomDir = path.join(SAVED_DIR, String(roomId).toUpperCase());
    fs.mkdirSync(roomDir, { recursive: true });

    const date = new Date().toISOString().slice(0, 10); // 2026-02-20
    const filename = `${safeName(name)}_${date}.${EXTENSIONS[language] || 'txt'}`;

    fs.writeFileSync(path.join(roomDir, filename), code);
    res.json({ ok: true, filename });
});

// LIST files in a room folder
router.get('/saved/:roomId', (req, res) => {
    const roomDir = path.join(SAVED_DIR, String(req.params.roomId).toUpperCase());
    if (!fs.existsSync(roomDir)) return res.json({ files: [] });

    const files = fs.readdirSync(roomDir)
        .map((name) => {
            const stat = fs.statSync(path.join(roomDir, name));
            return { name, size: stat.size, modified: stat.mtime };
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));

    res.json({ files });
});

// LOAD one file
router.get('/saved/:roomId/:filename', (req, res) => {
    const filePath = path.join(SAVED_DIR, String(req.params.roomId).toUpperCase(),
        path.basename(req.params.filename));
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return res.status(404).json({ ok: false, message: 'File not found' });
    }
    res.json({ ok: true, code: fs.readFileSync(filePath, 'utf-8') });
});

// DELETE one file
router.delete('/saved/:roomId/:filename', (req, res) => {
    const filePath = path.join(SAVED_DIR, String(req.params.roomId).toUpperCase(),
        path.basename(req.params.filename));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ ok: true });
});

module.exports = router;