import { useEffect, useState } from 'react';

const fmtSize = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);
const fmtDate = (d) => new Date(d).toLocaleString();

export default function FilesPanel({ roomId, onClose, onLoad, showToast }) {
    const [files, setFiles] = useState(null);

    const refresh = async () => {
        try {
            const res = await fetch(`/api/saved/${roomId}`);
            const data = await res.json();
            setFiles(data.files || []);
        } catch {
            setFiles([]);
        }
    };

    useEffect(() => { refresh(); }, [roomId]); // eslint-disable-line

    const handleLoad = async (filename) => {
        const res = await fetch(`/api/saved/${roomId}/${encodeURIComponent(filename)}`);
        const data = await res.json();
        if (data.ok) {
            onLoad(data.code, filename);   // loads into editor → syncs to whole room
            showToast(`📂 Loaded "${filename}"`);
            onClose();
        }
    };

    const handleDelete = async (filename) => {
        await fetch(`/api/saved/${roomId}/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        showToast(`🗑 Deleted "${filename}"`);
        refresh();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal files-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>📁 Saved code ({roomId})</h3>
                    <button className="modal-x" onClick={onClose}>✕</button>
                </div>

                {files === null ? (
                    <p className="modal-hint">Loading…</p>
                ) : files.length === 0 ? (
                    <p className="modal-hint">No saved files yet — click 💾 Save to create one</p>
                ) : (
                    <ul className="file-list">
                        {files.map((f) => (
                            <li key={f.name}>
                                <div className="file-info" onClick={() => handleLoad(f.name)}
                                    title="Click to load into the editor">
                                    <span className="file-name">{f.name}</span>
                                    <span className="file-meta">{fmtSize(f.size)} • {fmtDate(f.modified)}</span>
                                </div>
                                <button className="file-del" onClick={() => handleDelete(f.name)} title="Delete">🗑</button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}