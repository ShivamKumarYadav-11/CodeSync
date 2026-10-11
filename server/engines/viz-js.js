/* ============================================================
   VIZ-RUNNER — instruments & runs JavaScript, prints JSON trace
   Reads code from stdin → prints { ok, events, heap }
============================================================ */
const fs = require('fs');
const vm = require('vm');
const acorn = require('acorn');
const walk = require('acorn-walk');

function output(obj) {
    process.stdout.write(JSON.stringify(obj));
    process.exit(0);
}

let src = '';
try { src = fs.readFileSync(0, 'utf8'); } catch { output({ ok: false, error: 'no input' }); }

/* ---------- value helpers ---------- */
const heapMap = new Map(); // id -> { value, type, preview }
let heapCounter = 0;

function preview(v, depth = 0) {
    try {
        if (v === null) return 'null';
        if (v === undefined) return 'undefined';
        if (typeof v === 'string') return JSON.stringify(v);
        if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
        if (typeof v === 'function') return `ƒ ${v.name || 'anonymous'}()`;
        if (Array.isArray(v)) {
            if (depth >= 2) return '[…]';
            const items = v.slice(0, 6).map((x) => preview(x, depth + 1));
            return '[' + items.join(', ') + (v.length > 6 ? ', …' : '') + ']';
        }
        if (depth >= 2) return '{…}';
        const keys = Object.keys(v).slice(0, 5);
        return '{ ' + keys.map((k) => `${k}: ${preview(v[k], depth + 1)}`).join(', ') + ' }';
    } catch { return '?'; }
}

function snap(value) {
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
        let id = null;
        for (const [hid, entry] of heapMap) if (entry.value === value) { id = hid; break; }
        if (!id) {
            id = 'h' + (++heapCounter);
            heapMap.set(id, {
                value,
                type: typeof value === 'function' ? 'function'
                    : Array.isArray(value) ? 'array' : 'object',
                preview: preview(value),
            });
        }
        const meta = heapMap.get(id);
        return { kind: meta.type, heapId: id, preview: meta.preview };
    }
    return { kind: typeof value, heapId: null, preview: preview(value) };
}

/* ---------- parse & instrument ---------- */
let ast;
try {
    ast = acorn.parse(src, { ecmaVersion: 2022 });
} catch (e) {
    output({ ok: false, error: 'Syntax error: ' + e.message });
}

const inserts = [];

walk.full(ast, (node) => {
    // let/const/var NAME = EXPR   →   NAME = __d("NAME", EXPR)
    if (node.type === 'VariableDeclarator' && node.init && node.id.type === 'Identifier') {
        inserts.push({ pos: node.init.start, text: `__d(${JSON.stringify(node.id.name)}, ` });
        inserts.push({ pos: node.init.end, text: `)` });

        // const f = function (...) {...}  → also track its calls
        if (node.init.type === 'FunctionExpression' && node.init.body.type === 'BlockStatement') {
            const fname = JSON.stringify(node.id.name);
            inserts.push({ pos: node.init.body.start + 1, text: `__f(${fname}, arguments);try{` });
            inserts.push({ pos: node.init.body.end - 1, text: `}finally{__e(${fname})}` });
        }
    }

    // NAME = EXPR (plain assignment)
    if (node.type === 'AssignmentExpression' &&
        node.left.type === 'Identifier' && node.operator === '=') {
        inserts.push({ pos: node.right.start, text: `__a(${JSON.stringify(node.left.name)}, ` });
        inserts.push({ pos: node.right.end, text: `)` });
    }

    // function NAME(...) { BODY }  →  frame push + try/finally frame pop
    if (node.type === 'FunctionDeclaration' && node.body && node.id) {
        const name = JSON.stringify(node.id.name);
        inserts.push({ pos: node.body.start + 1, text: `__f(${name}, arguments);try{` });
        inserts.push({ pos: node.body.end - 1, text: `}finally{__e(${name})}` });
    }

    // return EXPR → capture the returned value
    if (node.type === 'ReturnStatement' && node.argument) {
        inserts.push({ pos: node.argument.start, text: `__r(` });
        inserts.push({ pos: node.argument.end, text: `)` });
    }
});

// apply from the END backwards so earlier offsets stay valid
inserts.sort((a, b) => b.pos - a.pos);
let code = src;
for (const i of inserts) code = code.slice(0, i.pos) + i.text + code.slice(i.pos);
// (all inserts are single-line → line numbers stay the same as the user's code!)

/* ---------- hooks the instrumented code calls ---------- */
const events = [];
const frameStack = [];

function __line() {
    try {
        const frames = (new Error().stack || '').split('\n');
        for (let i = frames.length - 1; i >= 0; i--) {
            const m = frames[i].match(/UserCode:(\d+):\d+/);
            if (m) return +m[1];
        }
    } catch { }
    return null;
}

function __d(name, value) { events.push({ type: 'declare', name, line: __line(), ...snap(value) }); return value; }
function __a(name, value) { events.push({ type: 'assign', name, line: __line(), ...snap(value) }); return value; }
function __f(name, args) {
    frameStack.push(name);
    const shown = [];
    try { for (const a of args) shown.push(preview(a)); } catch { }
    events.push({ type: 'call', name, args: shown, line: __line() });
}
function __e(name) { frameStack.pop(); events.push({ type: 'return', name }); }
function __r(value) { events.push({ type: 'retval', line: __line(), ...snap(value) }); return value; }

const sandbox = {
    __d, __a, __f, __e, __r,
    Math, Date, JSON, Number, String, Boolean, Array, Object,
    Map, Set, Symbol, RegExp, Error, parseInt, parseFloat, isNaN, isFinite, BigInt,
    console: {
        log: (...a) => events.push({ type: 'log', text: a.map((x) => preview(x, 1)).join(' ') }),
        error: (...a) => events.push({ type: 'error', text: a.map((x) => preview(x, 1)).join(' ') }),
    },
};

try {
    vm.runInNewContext(code, sandbox, { timeout: 3000, filename: 'UserCode' });
} catch (e) {
    events.push({ type: 'error', text: e.message });
}

// heap WITHOUT live values — the client only needs type + preview
const heap = {};
for (const [id, e] of heapMap) heap[id] = { type: e.type, preview: e.preview };

output({ ok: true, events, heap });