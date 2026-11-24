import { useEffect, useState } from 'react';

const API = import.meta.env.VITE_SERVER_URL || '';

const fmtSize = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);
const fmtDate = (d) => new Date(d).toLocaleString();

export default function FilesPanel({ roomId, username = 'me', isTeacher = false, onClose, onLoad, showToast }) {
    const [files, setFiles] = useState(null);
    const [allRooms, setAllRooms] = useState(null);
    const [view, setView] = useState('room');
    const [confirmDelete, setConfirmDelete] = useState(null); // {roomId, filename}


    /* hidden list — HAR USER ki apni alag list (username = alag storage key) */
    const storageKey = `hiddenFiles_${username}`;

    const [hiddenFiles, setHiddenFiles] = useState(() => {
        try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); }
        catch { return {}; }
    });

    const saveHidden = (next) => {
        setHiddenFiles(next);
        try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { }
    };

    const refresh = async () => {
        try {
            const [r1, r2] = await Promise.all([
                fetch(`${API}/api/saved/${roomId}`, { cache: 'no-store' }).then((r) => r.json()),
                fetch(`${API}/api/all-saved`, { cache: 'no-store' }).then((r) => r.json()),
            ]);
            // NOTE: "This Room" tab current roomId ke liye dikhata hai — folder delete ho
            // chuka ho to bhi empty list hi aayegi, koi error nahi.
            setFiles(r1.files || []);
            setAllRooms((r2.rooms || []).filter((room) => room.files.length > 0));  // safety double-filter
        } catch {
            setFiles([]);
            setAllRooms([]);
        }
    };

    useEffect(() => { refresh(); }, [roomId]); // eslint-disable-line

    const handleLoad = async (fileRoomId, filename) => {
        const res = await fetch(`${API}/api/saved/${fileRoomId}/${encodeURIComponent(filename)}`);
        const data = await res.json();
        if (data.ok) {
            onLoad(data.code, filename);
            showToast(`📂 Loaded "${filename}" (from room ${fileRoomId})`);
            onClose();
        }
    };

    const handleDelete = async (fileRoomId, filename) => {
        /* ── STUDENT: sirf apne browser se hide karo ── */
        if (!isTeacher) {
            const key = `${fileRoomId}/${filename}`;
            const next = { ...hiddenFiles, [key]: true };
            saveHidden(next);
            showToast(`🙈 Hidden "${filename}" (only for you — teacher can still see it)`);
            setConfirmDelete(null);
            setTimeout(() => refresh(), 150);   // server disk sync ho ne do, phir refresh
            // return;
        }

        /* ── TEACHER: server se permanently delete ── */
        try {
            const res = await fetch(
                `${API}/api/delete-file`,
                {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ roomId: fileRoomId, filename }),
                }
            );
            const data = await res.json().catch(() => ({}));

            if (!res.ok || data.ok === false) {
                showToast(`⚠️ Delete failed — ${data.message || 'error ' + res.status}`);
                return;
            }

            showToast(data.roomDeleted
                ? `🗑 Deleted "${filename}" — room ${fileRoomId} was empty, folder removed too`
                : `🗑 Deleted "${filename}"`);
            setConfirmDelete(null);
            refresh();
        } catch {
            showToast('⚠️ Delete failed — server not reachable');
        }
    };

    const isHidden = (fileRoomId, filename) => !!hiddenFiles[`${fileRoomId}/${filename}`];

    /* ek room ki files render karne ka helper (hidden filter ke saath) */
    const renderFileRow = (fileRoomId, f) => {
        if (isHidden(fileRoomId, f.name)) return null;      // student ne hide ki → skip
        const pending = confirmDelete?.roomId === fileRoomId && confirmDelete.filename === f.name;
        return (
            <li key={`${fileRoomId}-${f.name}`}>
                <div className="file-info" onClick={() => handleLoad(fileRoomId, f.name)}
                    title="Click to load into the editor">
                    <span className="file-name">{f.name}</span>
                    <span className="file-meta">{fmtSize(f.size)} • {fmtDate(f.modified)}</span>
                </div>
                {pending ? (
                    <span className="file-confirm">
                        <span className="file-confirm-text">Delete?</span>
                        <button className="file-yes" onClick={() => handleDelete(fileRoomId, f.name)}>Yes</button>
                        <button className="file-no" onClick={() => setConfirmDelete(null)}>No</button>
                    </span>
                ) : (
                    <button className="file-del"
                        onClick={() => setConfirmDelete({ roomId: fileRoomId, filename: f.name })}
                        title={isTeacher ? 'Delete this file permanently' : 'Hide this file (only for you)'}>
                        🗑
                    </button>
                )}
            </li>
        );
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal files-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>📁 Saved code {!isTeacher && <span className="student-badge">Student — hide only</span>}</h3>
                    <button className="modal-x" onClick={onClose}>✕</button>
                </div>

                {/* toggle */}
                <div className="files-tabs">
                    <button className={`files-tab ${view === 'room' ? 'active' : ''}`} onClick={() => setView('room')}>
                        This Room ({files ? files.filter((f) => !isHidden(roomId, f.name)).length : '…'})
                    </button>
                    <button className={`files-tab ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}>
                        🌐 All Rooms ({allRooms ? allRooms.reduce((n, r) => n + r.files.filter((f) => !isHidden(r.roomId, f.name)).length, 0) : '…'})
                    </button>
                </div>

                {/* view 1: this room */}
                {view === 'room' && (
                    files === null ? <p className="modal-hint">Loading…</p>
                        : files.filter((f) => !isHidden(roomId, f.name)).length === 0
                            ? <p className="modal-hint">No saved files yet — click 💾 Save to create one</p>
                            : <ul className="file-list">{files.map((f) => renderFileRow(roomId, f))}</ul>
                )}

                {/* view 2: all rooms */}
                {view === 'all' && (
                    allRooms === null ? <p className="modal-hint">Loading…</p>
                        : allRooms.length === 0
                            ? <p className="modal-hint">No rooms with saved files yet</p>
                            : allRooms.map((room) => {
                                const visible = room.files.filter((f) => !isHidden(room.roomId, f.name));
                                return (
                                    <div key={room.roomId} className="room-group">
                                        <div className="room-group-head">
                                            🏠 Room {room.roomId}
                                            {room.roomId === roomId && <span className="current-room-tag">current</span>}
                                            <span className="file-count">{visible.length} file{visible.length !== 1 ? 's' : ''}</span>
                                        </div>
                                        {visible.length === 0
                                            ? <p className="modal-hint" style={{ padding: '0.3rem 0 0.3rem 0.6rem' }}>(hidden by you)</p>
                                            : <ul className="file-list">{room.files.map((f) => renderFileRow(room.roomId, f))}</ul>}
                                    </div>
                                );
                            })
                )}
            </div>
        </div>
    );
}