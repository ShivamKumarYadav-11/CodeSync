/* ============================================================
   rooms.js — room & user management (in-memory — NO database)
   Pure data layer: never touches sockets or express.
   index.js calls these functions and does the actual emitting.
============================================================ */
const rooms = new Map(); // roomId → { users: Map<socketId, user>, code, language }

const USER_COLORS = ['#f97316', '#22c55e', '#38bdf8', '#eab308',
    '#a855f7', '#ec4899', '#14b8a6', '#ef4444'];
let colorIndex = 0;

const VALID_LANGUAGES = ['javascript', 'python', 'c', 'cpp', 'java'];

function generateRoomId() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
    let id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

function getMembers(roomId) {
    const room = rooms.get(roomId);
    if (!room) return [];
    return [...room.users.values()].map((u) => ({
        socketId: u.socketId,
        username: u.username,
        userId: u.userId,
        color: u.color,
    }));
}

/* join: validate → create room if needed → register user.
   Returns everything index.js needs (members INCLUDE the new user). */
function joinRoom(socketId, { roomId, username, userId }) {
    roomId = String(roomId || '').trim().toUpperCase();
    username = String(username || '').trim();

    if (!roomId || !username) {
        return { ok: false, message: 'Username and Room ID are required' };
    }

    if (!rooms.has(roomId)) {
        rooms.set(roomId, { users: new Map(), code: '', language: 'javascript' });
    }
    const room = rooms.get(roomId);

    const user = {
        socketId,
        username,
        userId: userId || '—',
        color: USER_COLORS[colorIndex++ % USER_COLORS.length],
    };
    room.users.set(socketId, user);

    return {
        ok: true,
        roomId,
        user,
        code: room.code,          // late joiners catch up
        language: room.language,
        members: getMembers(roomId),
    };
}

/* leave: remove user → returns info for the goodbye emits */
function leaveRoom(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room) return null;
    const user = room.users.get(socketId);
    if (!user) return null;

    room.users.delete(socketId);
    const members = getMembers(roomId);

    if (room.users.size === 0) rooms.delete(roomId); // free memory
    return { user, members };
}

function updateCode(roomId, code) {
    const room = rooms.get(roomId);
    if (!room) return false;
    room.code = code;
    return true;
}

function setLanguage(roomId, language) {
    const room = rooms.get(roomId);
    if (!room || !VALID_LANGUAGES.includes(language)) return false;
    room.language = language;
    return true;
}

function roomExists(roomId) {
    return rooms.has(roomId);
}

module.exports = { generateRoomId, getMembers, joinRoom, leaveRoom, updateCode, setLanguage, roomExists };