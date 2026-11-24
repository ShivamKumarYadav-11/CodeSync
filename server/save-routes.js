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

// DELETE one file (with debugging logs)
router.delete('/saved/:roomId/:filename', (req, res) => {
    const roomDir = path.join(SAVED_DIR, String(req.params.roomId).toUpperCase());
    const filePath = path.join(roomDir, path.basename(req.params.filename));

    console.log('🗑 DELETE request →', filePath, '| exists:', fs.existsSync(filePath));

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        try {
            fs.unlinkSync(filePath);
            console.log('✅ File deleted successfully');
            return res.json({ ok: true });
        } catch (e) {
            console.error('❌ Delete failed:', e.message);
            return res.json({ ok: false, message: e.message });
        }
    }
    console.log('⚠️ File not found on server (path mismatch?)');
    res.json({ ok: false, message: 'File not found on server' });
});

// LIST ALL rooms and their files (global viewer)
router.get('/all-saved', (req, res) => {
    if (!fs.existsSync(SAVED_DIR)) return res.json({ rooms: [] });

    const rooms = fs.readdirSync(SAVED_DIR)
        .filter((name) => {
            const p = path.join(SAVED_DIR, name);
            return fs.statSync(p).isDirectory();
        })
        .filter((roomName) => {                      // ← NAYA: empty rooms hide karo
            const roomDir = path.join(SAVED_DIR, roomName);
            try { return fs.readdirSync(roomDir).length > 0; } catch { return false; }
        })
        .map((roomName) => {
            const roomDir = path.join(SAVED_DIR, roomName);
            const files = fs.readdirSync(roomDir)
                .map((name) => {
                    const stat = fs.statSync(path.join(roomDir, name));
                    return { name, size: stat.size, modified: stat.mtime };
                })
                .sort((a, b) => new Date(b.modified) - new Date(a.modified));
            return { roomId: roomName, files };
        })
        .sort((a, b) => {
            const aT = a.files[0] ? new Date(a.files[0].modified) : 0;
            const bT = b.files[0] ? new Date(b.files[0].modified) : 0;
            return bT - aT;
        });

    res.json({ rooms });
});

// ── TEACHER: delete a file + (if last file) delete the whole room folder ──
router.delete('/delete-file', async (req, res) => {
    const { roomId, filename } = req.body || {};

    if (!roomId || !filename) {
        return res.json({ ok: false, message: 'Missing roomId or filename' });
    }

    const roomDir = path.join(SAVED_DIR, String(roomId).toUpperCase());
    const filePath = path.join(roomDir, path.basename(String(filename)));

    console.log('🗑 [Teacher] delete →', filePath, '| exists:', fs.existsSync(filePath));

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        try {
            fs.unlinkSync(filePath);
        } catch (e) {
            console.error('❌ Delete failed:', e.message);
            return res.json({ ok: false, message: e.message });
        }

        // room ki LAST file thi? → poora folder hata do (empty + hidden-junk dono check)
        let remaining = [];
        try { remaining = fs.readdirSync(roomDir); } catch { remaining = []; }

        if (remaining.length === 0) {
            try {
                fs.rmSync(roomDir, { recursive: true, force: true });   // force + recursive (safer than rmdirSync)
                console.log(`🏠 Room ${roomId} folder removed (was empty)`);
                return res.json({ ok: true, roomDeleted: true });
            } catch (e) {
                console.error('⚠️ Folder remove failed:', e.message);
                return res.json({ ok: true, roomDeleted: false });
            }
        }

        return res.json({ ok: true, roomDeleted: false });
    }

    res.json({ ok: false, message: 'File not found on server' });
});

module.exports = router;