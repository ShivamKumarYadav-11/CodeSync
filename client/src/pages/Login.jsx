import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import './Login.css';

/* random 6-char room id — same alphabet as the server (no 0/O, 1/I/L) */
function generateRoomId() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
}

export default function Login() {
    const navigate = useNavigate();

    const [loginType, setLoginType] = useState('student');   // student | teacher
    const [username, setUsername] = useState('');
    const [roomId, setRoomId] = useState('');               // empty — generated on click
    const [copied, setCopied] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!socket.connected) socket.connect();
    }, []);

    // const generate = () => {
    //     setRoomId(generateRoomId());
    //     setCopied(false);
    // };
   
    //Here new add a security (do not enter your user name utill not create room id)
    const generate = () => {
        if (!username.trim()) {
            setError('Please enter your username first');
            return;
        }
        setError('');
        setRoomId(generateRoomId());
        setCopied(false);
    };


    const copyRoomId = () => {
        if (!roomId) return;
        navigator.clipboard.writeText(roomId).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    const handleLogin = (e) => {
        e.preventDefault();
        const u = username.trim();
        const room = roomId.trim().toUpperCase();

        if (!u) return setError('Please enter your username');
        if (!room || room.length !== 6) return setError('Please enter a valid 6-character Room ID');
        setError('');

        sessionStorage.setItem('user', JSON.stringify({
            username: u,
            userId: loginType === 'teacher' ? 'Teacher' : 'Student',
            roomId: room,
        }));
        navigate('/editor');
    };

    return (
        <div className="login-page">

            <div className="login-card">

                {/* ============ LEFT PANEL (large screens only) ============ */}
                <div className="card-left">
                    <div className="brand-logo">
                        <span className="brand-mark">&lt;/&gt;</span> CodeSync
                    </div>

                    <h1 className="brand-title">
                        Code together.<br />
                        <span className="brand-title-accent">Learn better.</span>
                    </h1>

                    <ul className="brand-points">
                        <li><span className="check">✓</span> Student Login</li>
                        <li><span className="check">✓</span> Teacher Login</li>
                        <li><span className="check">✓</span> Secure Coding Environment</li>
                    </ul>

                    <div className="card-left-footer">Real-time collaborative coding</div>
                </div>

                {/* ============ RIGHT PANEL — the form ============ */}
                <div className="card-right">
                    <h2>Welcome back</h2>
                    <p className="login-sub">Choose your login type</p>

                    <div className="type-buttons">
                        <button type="button"
                            className={`type-btn ${loginType === 'student' ? 'active' : ''}`}
                            onClick={() => setLoginType('student')}>
                            🎓 Student
                        </button>
                        <button type="button"
                            className={`type-btn ${loginType === 'teacher' ? 'active' : ''}`}
                            onClick={() => setLoginType('teacher')}>
                            👨‍🏫 Teacher
                        </button>
                    </div>

                    <form onSubmit={handleLogin}>
                        <label htmlFor="username">Username / Name</label>
                        <input
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="Enter your username / Name"
                            maxLength={20}
                            autoComplete="off"
                        />

                        <label htmlFor="roomId">Room ID</label>
                        <div className="roomid-row">
                            <input
                                id="roomId"
                                value={roomId}
                                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                                placeholder="ENTER ROOM ID"
                                maxLength={6}
                                autoComplete="off"
                            />
                            <button type="button" className="icon-btn" onClick={copyRoomId}
                                title="Copy Room ID" disabled={!roomId}>
                                {copied ? '✅' : '📋'}
                            </button>
                        </div>

                        {/* generate button — room id is created ONLY when clicked */}
                        <button type="button" className="generate-btn" onClick={generate}>
                            🎲 Generate Room ID
                        </button>

                        <p className="roomid-hint">
                            Teacher: click <b>Generate Room ID</b> → 📋 copy it → share with the class.<br />
                            Student: paste the Room ID your teacher shared.
                        </p>

                        <button type="submit" className="login-btn">Login</button>
                    </form>

                    {error && <p className="login-error">⚠️ {error}</p>}
                </div>
            </div>
        </div>
    );
}