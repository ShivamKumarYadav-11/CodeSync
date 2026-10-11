/* ============================================================
   viz-java.js — JAVA memory trace engine (NEW)
   usage: node viz-java.js   (code arrives on stdin)
   Requires: class must be named Main. javac must be installed.
============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

function out(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0); }

/* ---------- the helper class injected next to user code ---------- */
const VIZ_JAVA_SOURCE = String.raw`
import java.util.*;
import java.lang.reflect.Array;

public class Viz {
    private static final StringBuilder SB = new StringBuilder();
    private static int n = 0;
    private static final Map<Integer, String> HEAP_TYPE = new LinkedHashMap<Integer, String>();
    private static final Map<Integer, String> HEAP_PREV = new LinkedHashMap<Integer, String>();
    private static final Map<Object, Integer> HEAP_IDS = new IdentityHashMap<Object, Integer>();
    private static int heapCounter = 0;

    static {
        Runtime.getRuntime().addShutdownHook(new Thread(new Runnable() {
            public void run() { Viz.flush(); }
        }));
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            public void uncaughtException(Thread t, Throwable ex) {
                put("{\"type\":\"error\",\"text\":" + q(ex.getClass().getSimpleName() + ": " + String.valueOf(ex.getMessage())) + "}");
            }
        });
    }

    private static void put(String json) {
        if (n >= 2500) return;
        if (n > 0) SB.append(',');
        SB.append(json);
        n++;
    }

    public static String esc(String s) {
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c == '\n') b.append("\\n");
            else if (c == '\r') { }
            else if (c < 32) b.append(' ');
            else b.append(c);
        }
        return b.toString();
    }
    private static String q(String s) { return "\"" + esc(s) + "\""; }

    public static String kind(Object v) {
        if (v == null) return "null";
        if (v instanceof Integer || v instanceof Short || v instanceof Byte) return "int";
        if (v instanceof Long) return "long";
        if (v instanceof Double) return "double";
        if (v instanceof Float) return "float";
        if (v instanceof Boolean) return "boolean";
        if (v instanceof Character) return "char";
        if (v instanceof String) return "string";
        if (v.getClass().isArray()) return "array";
        if (v instanceof List) return "list";
        if (v instanceof Map) return "dict";
        if (v instanceof Set) return "set";
        return v.getClass().getSimpleName();
    }

    public static String prev(Object o) {
        try {
            if (o == null) return "null";
            if (o instanceof String) return q((String) o);
            if (o instanceof Character) return "'" + o + "'";
            if (o instanceof Number || o instanceof Boolean) return o.toString();
            if (o.getClass().isArray()) {
                int len = Array.getLength(o);
                StringBuilder b = new StringBuilder("[");
                for (int i = 0; i < len && i < 8; i++) {
                    if (i > 0) b.append(", ");
                    b.append(prev(Array.get(o, i)));
                }
                if (len > 8) b.append(", ...");
                return b.append(']').toString();
            }
            if (o instanceof List) {
                List<?> l = (List<?>) o;
                StringBuilder b = new StringBuilder("[");
                for (int i = 0; i < l.size() && i < 8; i++) {
                    if (i > 0) b.append(", ");
                    b.append(prev(l.get(i)));
                }
                if (l.size() > 8) b.append(", ...");
                return b.append(']').toString();
            }
            if (o instanceof Map) {
                Map<?, ?> mp = (Map<?, ?>) o;
                StringBuilder b = new StringBuilder("{ ");
                int i = 0;
                for (Map.Entry<?, ?> e : mp.entrySet()) {
                    if (i >= 5) break;
                    if (i++ > 0) b.append(", ");
                    b.append(prev(String.valueOf(e.getKey()))).append(": ").append(prev(e.getValue()));
                }
                return b.append(" }").toString();
            }
            String s = String.valueOf(o);
            return s.length() > 80 ? s.substring(0, 80) + "..." : s;
        } catch (Exception e) {
            return "?";
        }
    }

    private static String heapIdOf(Object o) {
        if (o == null || o instanceof String || o instanceof Number
                || o instanceof Boolean || o instanceof Character) return null;
        Integer id = HEAP_IDS.get(o);
        if (id == null) {
            id = ++heapCounter;
            HEAP_IDS.put(o, id);
            HEAP_TYPE.put(id, kind(o));
            HEAP_PREV.put(id, prev(o));
        }
        return "h" + id;
    }

    public static void decl(String name, int line, Object v) {
        String hid = heapIdOf(v);
        put("{\"type\":\"declare\",\"name\":" + q(name) + ",\"line\":" + line
          + ",\"kind\":\"" + kind(v) + "\"" + (hid != null ? ",\"heapId\":\"" + hid + "\"" : "")
          + ",\"preview\":" + q(prev(v)) + "}");
    }

    public static void asg(String name, int line, Object v) {
        String hid = heapIdOf(v);
        put("{\"type\":\"assign\",\"name\":" + q(name) + ",\"line\":" + line
          + ",\"kind\":\"" + kind(v) + "\"" + (hid != null ? ",\"heapId\":\"" + hid + "\"" : "")
          + ",\"preview\":" + q(prev(v)) + "}");
    }

    public static void f(String name, String[] names, Object[] values) {
        int count = Math.min(names == null ? 0 : names.length, values == null ? 0 : values.length);
        StringBuilder a = new StringBuilder();
        for (int i = 0; i < count; i++) {
            if (i > 0) a.append(',');
            a.append('"').append(esc(names[i] + "=" + prev(values[i]))).append('"');
        }
        put("{\"type\":\"call\",\"name\":" + q(name) + ",\"args\":[" + a + "]}");
    }

    public static void e(String name) {
        put("{\"type\":\"return\",\"name\":" + q(name) + "}");
    }

    public static <T> T ret(int line, T v) {
        String hid = heapIdOf(v);
        put("{\"type\":\"retval\",\"line\":" + line + ",\"kind\":\"" + kind(v) + "\""
          + (hid != null ? ",\"heapId\":\"" + hid + "\"" : "")
          + ",\"preview\":" + q(prev(v)) + "}");
        return v;
    }

    public static void println(Object... parts) {
        StringBuilder b = new StringBuilder();
        for (Object p : parts) b.append(display(p));
        put("{\"type\":\"log\",\"text\":" + q(b.toString()) + "}");
        System.out.println(b);
    }

    public static void print(Object... parts) {
        StringBuilder b = new StringBuilder();
        for (Object p : parts) b.append(display(p));
        put("{\"type\":\"log\",\"text\":" + q(b.toString()) + "}");
        System.out.print(b);
    }

    private static String display(Object o) {
        if (o == null) return "null";
        if (o instanceof String) return (String) o;
        return String.valueOf(o);
    }

    private static void flush() {
        try {
            StringBuilder o = new StringBuilder("{\"ok\":true,\"lang\":\"java\",\"events\":[");
            o.append(SB);
            o.append("],\"heap\":{");
            boolean first = true;
            for (Map.Entry<Integer, String> e : HEAP_TYPE.entrySet()) {
                if (!first) o.append(',');
                first = false;
                o.append("\"h").append(e.getKey()).append("\":{\"type\":\"")
                 .append(e.getValue()).append("\",\"preview\":")
                 .append(q(HEAP_PREV.get(e.getKey()))).append('}');
            }
            o.append("}}");
            java.io.PrintWriter w = new java.io.PrintWriter("__viz_trace.json", "UTF-8");
            w.print(o);
            w.close();
        } catch (Exception ignored) { }
    }
}
`;

/* ---------------- instrumentation ---------------- */
const RESERVED = new Set(['if', 'for', 'while', 'switch', 'else', 'do', 'try', 'catch', 'finally', 'return', 'new', 'throw',
    'class', 'interface', 'enum', 'record', 'synchronized', 'assert', 'break', 'continue', 'case', 'default', 'this', 'super', 'instanceof']);
const CONTROL = /^(if|for|while|switch|else|do|try|catch|synchronized|return|new|throw|assert)\b/;

function paramName(a) {
    a = a.split('=')[0].trim();
    const m = a.match(/([A-Za-z_]\w*)\s*$/);
    return m && !RESERVED.has(m[1]) ? m[1] : null;
}

function splitArgs(s) {
    const parts = []; let cur = '', angle = 0;
    for (const ch of (s || '').trim()) {
        if (ch === '<') angle++; if (ch === '>') angle--;
        if (ch === ',' && angle === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((p) => p.trim()).filter(Boolean);
}

function instrument(src) {
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const lines = noBlock.split('\n');
    const clean = (s) => s.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])*'/g, "''").replace(/\/\/.*$/, '');
    const braces = (s) => (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;

    const outLines = [];
    const varTypes = new Set();
    let depth = 0;
    let curFn = null;

    lines.forEach((origLine, idx) => {
        let line = origLine;
        const ln = idx + 1;
        const t = line.trim();
        const t2 = t.replace(/\/\/.*$/, '');
        const cs = clean(line);
        const delta = braces(cs);

        // System.out → Viz
        line = line
            .replace(/System\.out\.println\s*\(/g, 'Viz.println(')
            .replace(/System\.out\.print\s*\(/g, 'Viz.print(');

        /* ---- method opens (class-body depth = 1) ---- */
        if (depth === 1 && /\{\s*$/.test(t2) && !CONTROL.test(t)) {
            const m = t2.match(/^(?:[\w<>\[\],.\s]+\s+)?([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:throws\s+[\w.,\s]+)?\s*\{$/);
            if (m && !RESERVED.has(m[1])) {
                const name = m[1];
                const names = splitArgs(m[2]).map(paramName).filter(Boolean);
                const inject = ` Viz.f("${name}", new String[]{${names.map((x) => `"${x}"`).join(',')}}, new Object[]{${names.join(',')}}); try {`;
                outLines.push(line.replace(/\{\s*$/, '{' + inject));
                depth += delta;
                curFn = { name, bodyDepth: depth };
                return;
            }
        }

        /* ---- method closes → prepend finally before the original } ---- */
        if (curFn && delta < 0 && depth === curFn.bodyDepth && /\}/.test(cs)) {
            outLines.push(`} finally { Viz.e("${curFn.name}"); }` + line);
            depth += delta;
            curFn = null;
            return;
        }

        /* ---- returns → wrap value ---- */
        if (curFn && /\breturn\b/.test(cs) && /return\s+[^;]+;/.test(t2)) {
            line = line.replace(/return\s+([^;]+);/, `return Viz.ret(${ln}, ${`$1`});`);
        }

        /* ---- declarations & assignments ---- */
        let m;
        if (!CONTROL.test(t2) && (m = t2.match(/^(?:final\s+)?([A-Za-z_][\w.<>\[\], ]*?)\s+([a-z_]\w*)\s*=\s*(.+);$/)) && !RESERVED.has(m[2])) {
            line += ` Viz.decl("${m[2]}", ${ln}, ${m[2]});`;
            varTypes.add(m[2]);
        } else if (!CONTROL.test(t2) && (m = t2.match(/^([a-z_]\w*)\s*=\s*([^=].*);$/)) && varTypes.has(m[1])) {
            line += ` Viz.asg("${m[1]}", ${ln}, ${m[1]});`;
        }

        outLines.push(line);
        depth += delta;
    });

    return outLines.join('\n') + '\n';
}

/* ---------------- main ---------------- */
(async () => {
    let code = '';
    await new Promise((res) => {
        process.stdin.on('data', (c) => (code += c));
        process.stdin.on('end', res);
    });

    try { execFileSync('javac', ['-version'], { stdio: 'ignore' }); }
    catch {
        return out({ ok: false, error: 'javac not found — install the JDK and restart the server' });
    }
    if (!/\bclass\s+Main\b/.test(code)) {
        return out({ ok: false, error: 'Java visualizer needs your code inside: public class Main { ... }' });
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelive-j-'));
    try {
        fs.writeFileSync(path.join(dir, 'Main.java'), instrument(code));
        fs.writeFileSync(path.join(dir, 'Viz.java'), VIZ_JAVA_SOURCE);

        let compileErr = '';
        try {
            execFileSync('javac', ['-encoding', 'UTF-8', 'Main.java', 'Viz.java'],
                { cwd: dir, timeout: 15000 });
        } catch (e) { compileErr = String(e.stderr || e.message || ''); }
        if (compileErr) {
            return out({ ok: false, error: 'Compile error: ' + compileErr.split('\n').filter(Boolean).slice(0, 3).join(' | ') });
        }

        await new Promise((resolve) => {
            const child = spawn('java', ['Main'], { cwd: dir, windowsHide: true, stdio: 'ignore' });
            const timer = setTimeout(() => { try { child.kill(); } catch { } }, 8000);
            child.on('error', () => { });
            child.on('close', () => { clearTimeout(timer); resolve(); });
        });

        const traceFile = path.join(dir, '__viz_trace.json');
        if (fs.existsSync(traceFile)) {
            return out(JSON.parse(fs.readFileSync(traceFile, 'utf-8')));
        }
        return out({ ok: false, error: 'No trace produced — program may be waiting for input (Scanner)' });
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
    }
})();