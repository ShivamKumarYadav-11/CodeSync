export default function TypingIndicator({ typingUser }) {
    // React conditional rendering = show/hide, no CSS classes needed
    if (!typingUser) return null;

    return (
        <div className="typing-indicator" style={{ borderLeftColor: typingUser.color }}>
            <span className="dot" style={{ background: typingUser.color }} />
            <span>{typingUser.username} is typing…</span>
        </div>
    );
}