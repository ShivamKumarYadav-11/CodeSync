import { useState } from 'react';

export default function SaveModal({ roomId, onClose, onSave }) {
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        if (!name.trim() || saving) return;
        setSaving(true);
        const ok = await onSave(name.trim());
        setSaving(false);
        if (ok) onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <h3>💾 Save code</h3>
                <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && save()}
                    placeholder="File name (e.g. bubble-sort)"
                    maxLength={60}
                />
                <p className="modal-hint">
                    Saves to <code>saved-code/{roomId}/</code> — date is added automatically
                </p>
                <div className="modal-actions">
                    <button className="modal-btn cancel" onClick={onClose}>Cancel</button>
                    <button className="modal-btn primary" onClick={save} disabled={!name.trim() || saving}>
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}