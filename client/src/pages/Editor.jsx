import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import CodeEditor from '../components/CodeEditor';
import MembersPanel from '../components/MembersPanel';
import TypingIndicator from '../components/TypingIndicator';
import Terminal from '../components/Terminal';
import SaveModal from '../components/SaveModal';
import FilesPanel from '../components/FilesPanel';
import MemoryVisualizer from '../components/MemoryVisualizer';
import './Editor.css';

const toLines = (text, type) =>
    text.replace(/\n+$/, '').split('\n').map((t) => ({ type, text: t }));

const EXT_TO_LANG = { js: 'javascript', py: 'python', c: 'c', cpp: 'cpp', java: 'java' };

export default function EditorPage() {
    const navigate = useNavigate();

    const [user] = useState(() => {
        const stored = sessionStorage.getItem('user');
        return stored ? JSON.parse(stored) : null;
    });

    const [members, setMembers] = useState([]);
    const [typingUser, setTypingUser] = useState(null);
    const [roomCode, setRoomCode] = useState('');
    const [joined, setJoined] = useState(false);
    const [toastMsg, setToastMsg] = useState(null);
    const [copied, setCopied] = useState(false);

    const [language, setLanguage] = useState('javascript');
    const [terminalLines, setTerminalLines] = useState([
        { type: 'info', text: 'CodeLive terminal ready — ▶ Run or Ctrl+Enter' },
    ]);
    const [isRunning, setIsRunning] = useState(false);
    const [terminalOpen, setTerminalOpen] = useState(true);

    const [showSaveModal, setShowSaveModal] = useState(false);
    const [showFilesPanel, setShowFilesPanel] = useState(false);
    const [loadRequest, setLoadRequest] = useState(null);

    /* NEW: visualizer state */
    const [vizTrace, setVizTrace] = useState(null);
    const [vizOpen, setVizOpen] = useState(false);
    const [vizLoading, setVizLoading] = useState(false);
    const [activeLine, setActiveLine] = useState(null);

    const typingTimer = useRef(null);
    const toastTimer = useRef(null);
    const codeRef = useRef('');

    const showToast = (msg) => {
        setToastMsg(msg);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToastMsg(null), 2500);
    };

    useEffect(() => {
        if (!user) navigate('/', { replace: true });
    }, [user, navigate]);

    useEffect(() => {
        if (!user) return;

        socket.emit('join-room', user, (res) => {
            if (!res.ok) { alert(res.message); navigate('/', { replace: true }); return; }
            setRoomCode(res.code);
            setLanguage(res.language || 'javascript');
            setJoined(true);
        });

        const onMembers = ({ members }) => setMembers(members);
        socket.on('members-update', onMembers);

        const onCodeChange = ({ username, color }) => {
            setTypingUser({ username, color });
            clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(() => setTypingUser(null), 1300);
        };
        socket.on('code-change', onCodeChange);

        const onJoined = ({ username }) => showToast(`🎉 ${username} joined the room`);
        const onLeft = ({ username }) => showToast(`👋 ${username} left the room`);
        socket.on('user-joined', onJoined);
        socket.on('user-left', onLeft);

        const onLanguageChange = ({ language, username }) => {
            setLanguage(language);
            showToast(`🛠 ${username} switched the language to ${language}`);
        };
        socket.on('language-change', onLanguageChange);

        const onRunStarted = ({ username, file }) => {
            setTerminalLines((prev) => [...prev, { type: 'cmd', text: `$ ${file} — run by ${username}` }]);
            setIsRunning(true);
            setVizLoading(true);                       // NEW
        };
        socket.on('run-started', onRunStarted);

        const onRunResult = (res) => {
            setTerminalLines((prev) => {
                const next = [...prev];
                if (res.compileStderr?.trim()) next.push(...toLines(res.compileStderr, 'err'));
                if (res.stdout?.trim()) next.push(...toLines(res.stdout, 'out'));
                if (res.stderr?.trim()) next.push(...toLines(res.stderr, 'err'));
                if (!res.stdout?.trim() && !res.stderr?.trim() && !res.compileStderr?.trim())
                    next.push({ type: 'info', text: '(program finished with no output)' });
                next.push(
                    res.exitCode === 0
                        ? { type: 'ok', text: '✓ finished — exit code 0' }
                        : { type: 'err', text: `✖ exited with code ${res.exitCode}` }
                );
                return next;
            });
            setIsRunning(false);
            setVizLoading(false);                      // NEW (non-JS runs stop here)
        };
        socket.on('run-result', onRunResult);

        /* NEW: memory trace arrived → open panel & animate */
        /* memory trace arrived → open panel (success AND failure — never silent) */
        const onVizTrace = (payload) => {
            setVizLoading(false);
            if (payload?.ok && payload.events?.length) {
                setVizTrace(payload);
                setVizOpen(true);
            } else {
                // show the REASON inside the panel instead of a short toast
                setVizTrace({
                    ok: false,
                    error: payload?.error || 'No memory events were produced for this code',
                });
                setVizOpen(true);
            }
        };
        socket.on('viz-trace', onVizTrace);

        return () => {
            socket.off('members-update', onMembers);
            socket.off('code-change', onCodeChange);
            socket.off('user-joined', onJoined);
            socket.off('user-left', onLeft);
            socket.off('language-change', onLanguageChange);
            socket.off('run-started', onRunStarted);
            socket.off('run-result', onRunResult);
            socket.off('viz-trace', onVizTrace);
            clearTimeout(typingTimer.current);
            clearTimeout(toastTimer.current);
            socket.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleRun = () => {
        if (isRunning) return;
        if (!['javascript', 'python', 'c', 'cpp', 'java'].includes(language) && vizOpen) {
            showToast(' Memory visualizer supports JavaScript, Python, C, C++ and Java');
        }
        socket.emit('run-code', { code: codeRef.current, language });
    };

    const handleSave = async (name) => {
        try {
            const res = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId: user.roomId, name, code: codeRef.current, language }),
            });
            const data = await res.json();
            if (data.ok) { showToast(`💾 Saved as ${data.filename}`); return true; }
            showToast('⚠️ Save failed');
            return false;
        } catch {
            showToast('⚠️ Save failed — is the server running?');
            return false;
        }
    };

    const handleLoadFile = (code, filename) => {
        setLoadRequest({ code, ts: Date.now() });
        const ext = filename.split('.').pop();
        const lang = EXT_TO_LANG[ext];
        if (lang && lang !== language) {
            setLanguage(lang);
            socket.emit('language-change', { language: lang });
        }
    };

    const handleLanguageChange = (e) => {
        const lang = e.target.value;
        setLanguage(lang);
        socket.emit('language-change', { language: lang });
    };

    const handleLeave = () => {
        sessionStorage.removeItem('user');
        navigate('/', { replace: true });
    };

    const copyRoomId = () => {
        navigator.clipboard.writeText(user.roomId).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    return (
        <div className="editor-page">
            <header className="topbar">
                <div className="brand">&lt;/&gt; CodeLive</div>
                <div className="room-info">
                    Room: <strong>{user?.roomId}</strong>
                    <button className="copy-btn" onClick={copyRoomId}>{copied ? '✅' : '📋'}</button>
                </div>
                <button className="btn-leave" onClick={handleLeave}>Leave Room</button>
            </header>

            <div className="main">
                <MembersPanel members={members} mySocketId={socket.id} />

                <section className="editor-area">
                    <div className="toolbar">
                        <button className="run-btn" onClick={handleRun} disabled={isRunning}>
                            {isRunning ? '⏳ Running…' : '▶ Run'}
                        </button>
                        <span className="shortcut-hint">Ctrl+Enter</span>
                        <button className="tool-btn" onClick={() => setShowSaveModal(true)}>💾 Save</button>
                        <button className="tool-btn" onClick={() => setShowFilesPanel(true)}>📁 Files</button>
                        <button className="tool-btn" onClick={() => setVizOpen((o) => !o)}>🧠 Memory</button>
                        <div className="spacer" />
                        <label className="lang-label">Language:</label>
                        <select className="lang-select" value={language} onChange={handleLanguageChange}>
                            <option value="javascript">JavaScript</option>
                            <option value="python">Python</option>
                            <option value="c">C</option>
                            <option value="cpp">C++</option>
                            <option value="java">Java</option>
                        </select>
                    </div>

                    <div className="editor-holder">
                        {joined && <TypingIndicator typingUser={typingUser} />}
                        {joined && (
                            <CodeEditor
                                initialCode={roomCode}
                                language={language}
                                loadRequest={loadRequest}
                                activeLine={activeLine}
                                onCodeChange={(code) => (codeRef.current = code)}
                                onRun={handleRun}
                            />
                        )}
                    </div>

                    <Terminal
                        lines={terminalLines}
                        isRunning={isRunning}
                        open={terminalOpen}
                        onClear={() => setTerminalLines([])}
                        onToggle={() => setTerminalOpen((o) => !o)}
                    />
                </section>

                {/* NEW: memory visualizer (right side) */}
                {vizOpen && (
                    <MemoryVisualizer
                        trace={vizTrace}
                        loading={vizLoading}
                        onActiveLine={setActiveLine}
                        onClose={() => { setVizOpen(false); setActiveLine(null); }}
                    />
                )}
            </div>

            {showSaveModal && (
                <SaveModal roomId={user.roomId} onClose={() => setShowSaveModal(false)} onSave={handleSave} />
            )}
            {showFilesPanel && (
                <FilesPanel
                    roomId={user.roomId}
                    username={user.username}
                    isTeacher={user.userId === 'Teacher'}
                    onClose={() => setShowFilesPanel(false)}
                    onLoad={handleLoadFile}
                    showToast={showToast}
                />
            )}

            <div className={`toast ${toastMsg ? 'show' : ''}`}>{toastMsg}</div>
        </div>
    );
}