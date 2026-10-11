import { useEffect, useRef } from 'react';

export default function Terminal({ lines, isRunning, open, onClear, onToggle }) {
    const bodyRef = useRef(null);

    // auto-scroll to the bottom when new output arrives (like a real terminal)
    useEffect(() => {
        const el = bodyRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [lines, isRunning]);

    return (
        <div className={`terminal ${open ? '' : 'collapsed'}`}>
            <div className="terminal-header">
                <span className="terminal-title">TERMINAL</span>
                {isRunning && <span className="terminal-running">● running…</span>}
                <div className="terminal-actions">
                    <button className="term-btn" onClick={onClear}>🗑 Clear</button>
                    <button className="term-btn" onClick={onToggle} title="Show / hide terminal">
                        {open ? '▼' : '▲'}
                    </button>
                </div>
            </div>

            {open && (
                <div className="terminal-body" ref={bodyRef}>
                    {lines.map((line, i) => (
                        <div key={i} className={`term-line ${line.type}`}>{line.text}</div>
                    ))}
                    {isRunning && <div className="term-line info cursor">▌</div>}
                </div>
            )}
        </div>
    );
}