export default function MembersPanel({ members, mySocketId }) {
    return (
        <aside className="members-panel">
            <h3>Members ({members.length})</h3>
            <ul>
                {members.map((m) => (
                    <li key={m.socketId}>
                        <span className="dot" style={{ background: m.color }} />
                        <span className="name">{m.username}</span>
                        <span className="user-id">{m.userId}</span>
                        {m.socketId === mySocketId && <span className="you-tag">You</span>}
                    </li>
                ))}
            </ul>
        </aside>
    );
}