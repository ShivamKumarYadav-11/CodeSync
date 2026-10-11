import { useState, useEffect, useMemo, useRef } from 'react';
import './MemoryVisualizer.css';

const SPEEDS = [
    { label: '0.5×', ms: 1400 },
    { label: '1×', ms: 800 },
    { label: '2×', ms: 400 },
    { label: '4×', ms: 150 },
];

const KIND_ICON = {
    number: '🔢', int: '🔢', uint: '🔢', long: '🔢', float: '🔢', double: '🔢',
    string: '✏️', str: '✏️', char: '✏️',
    boolean: '⚖️', bool: '⚖️',
    null: '⭕', undefined: '❔', none: '⭕',
    array: '🗂️', list: '🗂️', vector: '🗂️', tuple: '📦', set: '🗃️',
    object: '🧱', dict: '🧱', function: '⚙️', pointer: '📍', block: '📦',
};
const KIND_COLOR = {
    number: '#89b4fa', int: '#89b4fa', uint: '#89dceb', long: '#89dceb',
    float: '#89dceb', double: '#89dceb',
    string: '#a6e3a1', str: '#a6e3a1', char: '#a6e3a1',
    boolean: '#f9e2af', bool: '#f9e2af',
    null: '#585b70', undefined: '#585b70', none: '#585b70',
    array: '#cba6f7', list: '#cba6f7', vector: '#cba6f7', tuple: '#a6adc8', set: '#f9e2af',
    object: '#94e2d5', dict: '#94e2d5',
    function: '#f5c2e7', pointer: '#f5a97f', block: '#fab387',
};

/* replay events[0..upto] → full memory picture for that moment */
function computeState(events, heapMeta, upto, lang) {
    const manual = lang === 'c' || lang === 'cpp';
    const frames = [{ name: 'Global', args: [], vars: {} }];
    const logs = [];
    const heap = new Map(); // id -> { type, preview, freed }
    let action = { icon: '🧠', text: 'Press ▶ to play the memory animation' };
    let pendingReturn = null;
    let lastPopped = null;

    const linkHeap = (id, kind, preview) => {
        if (id && !heap.has(id)) {
            heap.set(id, {
                type: kind || heapMeta[id]?.type || 'object',
                preview: preview || heapMeta[id]?.preview || '',
                freed: false,
            });
        }
    };

    for (let i = 0; i < upto; i++) {
        const e = events[i];
        const top = frames[frames.length - 1];
        lastPopped = null;

        if (e.type === 'declare' || e.type === 'assign') {
            top.vars[e.name] = { kind: e.kind, heapId: e.heapId || null, preview: e.preview };
            linkHeap(e.heapId, e.kind, e.preview);
            action = e.kind === 'pointer' && e.heapId
                ? { icon: '📍', text: `${e.name} points to heap block ${e.heapId} — the STACK stores the pointer, the data lives in the HEAP` }
                : e.heapId
                    ? { icon: KIND_ICON[e.kind] || '📦', text: `${e.name} → ${e.kind} created in the HEAP (${e.heapId}) — the STACK keeps only a reference` }
                    : { icon: KIND_ICON[e.kind] || '📦', text: `${e.name} = ${e.preview} stored directly in the STACK (${top.name} frame)` };
        } else if (e.type === 'call') {
            frames.push({ name: e.name, args: e.args || [], vars: {} });
            action = { icon: '📞', text: `${e.name}() called — a new frame is pushed onto the STACK` };
        } else if (e.type === 'retval') {
            pendingReturn = e;
        } else if (e.type === 'return') {
            if (frames.length > 1) {
                const f = frames.pop();
                lastPopped = {
                    ...f,
                    ret: pendingReturn ? (pendingReturn.heapId ?? pendingReturn.preview) : null,
                };
            }
            pendingReturn = null;
            const ret = lastPopped?.ret;
            action = { icon: '↩️', text: `${e.name}() finished — its frame is popped from the STACK` + (ret !== null && ret !== undefined ? ` and returned ${ret}` : '') };
        } else if (e.type === 'heap-alloc') {
            heap.set(e.heapId, { type: 'block', preview: e.preview, freed: false });
            action = { icon: '📦', text: `malloc/new → block ${e.heapId} allocated in the HEAP (${e.preview})` };
        } else if (e.type === 'free') {
            const b = heap.get(e.heapId) || { type: 'block', preview: '', freed: false };
            b.freed = true;
            heap.set(e.heapId, b);
            action = { icon: '🗑', text: `free/delete → block ${e.heapId} released manually — there is NO garbage collector in C/C++!` };
        } else if (e.type === 'log') {
            logs.push({ type: 'out', text: e.text });
            action = { icon: '🖨️', text: `output printed: ${e.text}` };
        } else if (e.type === 'error') {
            logs.push({ type: 'err', text: e.text });
            action = { icon: '💥', text: `Runtime error: ${e.text}` };
        }
    }

    // heap blocks with no reference = garbage collected (JS/Python)
    const referenced = new Set();
    for (const f of frames)
        for (const v of Object.values(f.vars)) if (v.heapId) referenced.add(v.heapId);

    const heapArr = [...heap.entries()].map(([id, b]) => ({
        id, type: b.type, preview: b.preview,
        collected: manual ? b.freed : (b.freed || !referenced.has(id)),
    }));

    return { frames, heap: heapArr, logs, action, ghost: lastPopped };
}

export default function MemoryVisualizer({ trace, loading, onActiveLine, onClose }) {
    const [step, setStep] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [speedIdx, setSpeedIdx] = useState(1);
    const [arrows, setArrows] = useState([]);

    const bodyRef = useRef(null);  // scroll container
    const svgRef = useRef(null);

    const events = useMemo(() => (trace?.ok ? trace.events : []), [trace]);
    const total = events.length;
    const lang = trace?.lang;

    // new trace → reset + auto-play
    useEffect(() => {
        setStep(0);
        setPlaying(events.length > 0);
        setSpeedIdx(events.length > 300 ? 3 : 1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trace]);

    // playback timer
    useEffect(() => {
        if (!playing) return;
        if (step >= total) { setPlaying(false); return; }
        const t = setTimeout(() => setStep((s) => s + 1), SPEEDS[speedIdx].ms);
        return () => clearTimeout(t);
    }, [playing, step, total, speedIdx]);

    const state = useMemo(
        () => computeState(events, trace?.heap || {}, step, lang),
        [events, trace, step, lang]
    );
    // previous step — needed to know what JUST changed (for animations)
    const prevState = useMemo(
        () => computeState(events, trace?.heap || {}, Math.max(0, step - 1), lang),
        [events, trace, step, lang]
    );
    const curEvent = step > 0 ? events[step - 1] : null;

    // highlight current line in the editor
    useEffect(() => {
        onActiveLine?.(step > 0 ? events[step - 1]?.line ?? null : null);
    }, [step, events, onActiveLine]);

    /* what changed THIS step → drives the animations */
    const newFrameIdx = curEvent?.type === 'call' ? state.frames.length - 1 : -1;
    const changedVar = (curEvent?.type === 'declare' || curEvent?.type === 'assign') ? curEvent.name : null;
    const allocedHeap = curEvent?.type === 'heap-alloc' ? curEvent.heapId : null;
    const freedHeap = curEvent?.type === 'free' ? curEvent.heapId : null;
    const prevCollected = new Set(prevState.heap.filter((h) => h.collected).map((h) => h.id));
    const justCollected = new Set(
        state.heap.filter((h) => h.collected && !prevCollected.has(h.id)).map((h) => h.id)
    );

    /* draw curved reference arrows: stack variable ──▶ heap block */
    useEffect(() => {
        const body = bodyRef.current;
        if (!body) return;
        const bodyRect = body.getBoundingClientRect();
        const list = [];

        state.frames.forEach((f, fi) => {
            Object.entries(f.vars).forEach(([name, v]) => {
                if (!v.heapId) return;
                const a = body.querySelector(`[data-svar="${fi}:${name}"]`);
                const b = body.querySelector(`[data-heap="${v.heapId}"]`);
                if (!a || !b) return;
                const ra = a.getBoundingClientRect();
                const rb = b.getBoundingClientRect();
                const x1 = ra.right - bodyRect.left;
                const y1 = ra.top + ra.height / 2 - bodyRect.top + body.scrollTop;
                const x2 = rb.left - bodyRect.left - 2;
                const y2 = rb.top + rb.height / 2 - bodyRect.top + body.scrollTop;
                const mx = (x1 + x2) / 2;
                list.push({
                    id: `${fi}:${name}`,
                    d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
                });
            });
        });

        setArrows(list);
        if (svgRef.current) svgRef.current.style.height = `${body.scrollHeight}px`;
    }, [state]);

    const atEnd = step >= total;
    const togglePlay = () => {
        if (atEnd) { setStep(0); setPlaying(true); return; }
        setPlaying((p) => !p);
    };

    /* display frames: newest on top (like a real call stack read top-down) */
    const displayFrames = state.frames.map((f, i) => ({ f, i })).reverse();
    const ghost = state.ghost && state.ghost.name !== 'Global' ? state.ghost : null;

    return (
        <aside className="viz-panel">
            <div className="viz-header">
                <span className="viz-title">🧠 Memory Visualizer</span>
                {loading && <span className="viz-loading">analyzing…</span>}
                <button className="viz-close" onClick={onClose} title="Hide panel">✕</button>
            </div>

            {total === 0 ? (
                <div className="viz-placeholder">
                    {trace && !trace.ok
                        ? <p className="viz-error">⚠️ {trace.error}</p>
                        : <p>Run JavaScript, Python, C or C++ code (▶ Run)<br />
                            to watch variables, functions,<br />Stack &amp; Heap in action.</p>}
                </div>
            ) : (
                <>
                    <div className="viz-controls">
                        <button onClick={() => { setStep(0); setPlaying(false); }} title="Reset">⏮</button>
                        <button onClick={togglePlay} title="Play / Pause">{playing ? '⏸' : '▶'}</button>
                        <button onClick={() => { setPlaying(false); setStep((s) => Math.min(s + 1, total)); }}
                            disabled={atEnd} title="One step forward">⏭</button>
                        <select value={speedIdx} onChange={(e) => setSpeedIdx(+e.target.value)} title="Speed">
                            {SPEEDS.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
                        </select>
                        <span className="viz-step">{step}/{total}</span>
                    </div>

                    <input
                        className="viz-range"
                        type="range" min="0" max={total} value={step}
                        onChange={(e) => { setPlaying(false); setStep(+e.target.value); }}
                        title="Drag to scrub through time"
                    />

                    {/* narration — what is happening right now */}
                    <div className="viz-action">
                        <span className="viz-action-icon">{state.action.icon}</span>
                        <span>{state.action.text}</span>
                    </div>

                    <div className="viz-legend">⟶ dotted arrow = reference / pointer from STACK to HEAP</div>

                    {/* ============ scrollable STACK | HEAP area ============ */}
                    <div className="viz-scroll" ref={bodyRef}>

                        {/* reference arrows overlay */}
                        <svg ref={svgRef} className="viz-arrows">
                            <defs>
                                <marker id="viz-ah" viewBox="0 0 10 10" refX="8" refY="5"
                                    markerWidth="7" markerHeight="7" orient="auto">
                                    <path d="M 0 1 L 9 5 L 0 9 z" fill="#89b4fa" />
                                </marker>
                            </defs>
                            {arrows.map((a) => (
                                <path key={a.id} className="flow-arrow" d={a.d} markerEnd="url(#viz-ah)" />
                            ))}
                        </svg>

                        <div className="viz-columns">

                            {/* ---------- STACK column ---------- */}
                            <div className="viz-col">
                                <div className="col-title">
                                    STACK <span className="col-sub">grows ↓ · LIFO · depth {state.frames.length}</span>
                                </div>
                                <div className="stack-frames">
                                    {displayFrames.map(({ f, i }) => {
                                        const isTop = i === state.frames.length - 1;
                                        const isChangedFrame = changedVar && isTop;
                                        return (
                                            <div key={`${i}-${f.name}`}
                                                className={`frame ${isTop ? 'frame-top' : ''} ${newFrameIdx === i ? 'frame-enter' : ''}`}>
                                                <div className="frame-head">
                                                    <span className="frame-name">{f.name}</span>
                                                    <span className="frame-args">({f.args.join(', ')})</span>
                                                    {isTop && <span className="sp-badge">◀ top</span>}
                                                </div>
                                                {Object.keys(f.vars).length === 0 && (
                                                    <div className="frame-empty">(no variables yet)</div>
                                                )}
                                                {Object.entries(f.vars).map(([name, v]) => (
                                                    <div key={isChangedFrame && changedVar === name ? `${name}-s${step}` : name}
                                                        data-svar={`${i}:${name}`}
                                                        className={`var-row ${isChangedFrame && changedVar === name ? 'var-flash' : ''}`}>
                                                        <span className="var-name">{name}</span>
                                                        <span className="var-kind" style={{ color: KIND_COLOR[v.kind] || '#a6adc8' }}>
                                                            {KIND_ICON[v.kind] || '📦'}
                                                        </span>
                                                        {v.heapId
                                                            ? <span className="var-ref" style={{ color: KIND_COLOR[v.kind] }}>● → {v.heapId}</span>
                                                            : <span className="var-value" title={v.preview}>{v.preview}</span>}
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })}

                                    {/* ghost frame — the one that just returned, fading away */}
                                    {ghost && (
                                        <div className="frame ghost">
                                            <div className="frame-head">
                                                <span className="frame-name">{ghost.name}</span>
                                                <span className="frame-args">({ghost.args.join(', ')})</span>
                                                {ghost.ret !== null && ghost.ret !== undefined &&
                                                    <span className="ret-badge">↩ {ghost.ret}</span>}
                                            </div>
                                            {Object.entries(ghost.vars).map(([name, v]) => (
                                                <div key={name} className="var-row">
                                                    <span className="var-name">{name}</span>
                                                    <span className="var-kind" style={{ color: KIND_COLOR[v.kind] || '#a6adc8' }}>
                                                        {KIND_ICON[v.kind] || '📦'}
                                                    </span>
                                                    <span className="var-value">{v.heapId ? `→ ${v.heapId}` : v.preview}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    <div className="stack-base" title="bottom of the stack" />
                                </div>
                            </div>

                            {/* ---------- HEAP column ---------- */}
                            <div className="viz-col">
                                <div className="col-title">
                                    HEAP <span className="col-sub">dynamic memory</span>
                                </div>
                                <div className="heap-blocks">
                                    {state.heap.length === 0 && (
                                        <div className="frame-empty">(heap is empty)</div>
                                    )}
                                    {state.heap.map((h) => (
                                        <div key={h.id}
                                            data-heap={h.id}
                                            className={[
                                                'heap-block',
                                                h.collected ? 'collected' : '',
                                                justCollected.has(h.id) ? 'just-collected' : '',
                                                allocedHeap === h.id ? 'heap-drop' : '',
                                                freedHeap === h.id ? 'heap-freed' : '',
                                            ].join(' ')}
                                            style={{ '--hc': KIND_COLOR[h.type] || '#fab387' }}>
                                            <div className="heap-head">
                                                <span className="heap-id">{h.id}</span>
                                                <span className="heap-type">{h.type}</span>
                                                {h.collected && <span className="heap-gc">🗑 {lang === 'c' || lang === 'cpp' ? 'freed' : 'collected'}</span>}
                                            </div>
                                            <div className="heap-body" title={h.preview}>{h.preview}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ============ OUTPUT — fixed at the bottom ============ */}
                    <div className="viz-output">
                        <div className="viz-section-title">OUTPUT — console.log</div>
                        {state.logs.length === 0 && <div className="frame-empty">(nothing printed yet)</div>}
                        {state.logs.map((l, i) => (
                            <div key={i}
                                className={`viz-log ${l.type} ${curEvent?.type === 'log' && i === state.logs.length - 1 ? 'log-flash' : ''}`}>
                                {l.text}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </aside>
    );
}