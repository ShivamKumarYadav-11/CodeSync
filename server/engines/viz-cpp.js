/* ============================================================
   viz-cpp.js — C/C++ memory trace engine
   FIXED: frame "return/pop" is emitted exactly once (at the
   closing brace). return X; only captures the value now.
   usage: node viz-cpp.js c|cpp   (code arrives on stdin)
============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

function out(obj) { process.stdout.write(JSON.stringify(obj)); process.exit(0); }

function buildPrelude(lang) {
    const cpp = lang === 'cpp';

    const includes = `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <signal.h>
` + (cpp ? `
#include <sstream>
#include <string>
#include <vector>
#include <typeinfo>
` : '');

    const core = String.raw`
#define VIZ_HEAP_MAX 64
#define VIZ_MAX_EVENTS 2500

static char __viz_store[500000];
static char* __viz_w = __viz_store;
static int  __viz_n = 0;

static void __viz_put(const char* s) {
    int L = (int)strlen(s);
    if (__viz_n >= VIZ_MAX_EVENTS) return;
    if (__viz_w + L + 2 >= __viz_store + sizeof(__viz_store)) { __viz_n = VIZ_MAX_EVENTS; return; }
    if (__viz_n) *__viz_w++ = ',';
    memcpy(__viz_w, s, (size_t)L); __viz_w += L; __viz_n++;
}

static const char* __viz_q(const char* s) {
    static char b[512]; char* d = b; *d++ = '"';
    const unsigned char* c;
    for (c = (const unsigned char*)s; *c && d < b + 500; c++) {
        if (*c == '"' || *c == '\\') { *d++ = '\\'; *d++ = (char)*c; }
        else if (*c == '\n') { *d++ = '\\'; *d++ = 'n'; }
        else if (*c == '\r') { }
        else if (*c < 32) { *d++ = ' '; }
        else *d++ = (char)*c;
    }
    *d++ = '"'; *d = 0; return b;
}

static void __viz_ev(const char* ev, const char* name, int line, const char* kind, const char* preview, int hid) {
    char b[900]; int n = sprintf(b, "{\"type\":\"%s\"", ev);
    if (name) n += sprintf(b + n, ",\"name\":%s", __viz_q(name));
    if (line > 0) n += sprintf(b + n, ",\"line\":%d", line);
    if (kind) n += sprintf(b + n, ",\"kind\":\"%s\"", kind);
    if (hid > 0) n += sprintf(b + n, ",\"heapId\":\"h%d\"", hid);
    if (preview) n += sprintf(b + n, ",\"preview\":%s", __viz_q(preview));
    strcat(b + n, "}");
    __viz_put(b);
}

/* function call tracking */
static char __viz_cb[500];
static int  __viz_cfirst = 1;
static int  __viz_cline = 0;
static void __viz_carg(const char* p) {
    if (!__viz_cfirst) strcat(__viz_cb, ", ");
    strcat(__viz_cb, __viz_q(p)); __viz_cfirst = 0;
}
static void __viz_f(const char* n, int l) {
    sprintf(__viz_cb, "{\"type\":\"call\",\"name\":%s,\"args\":[", __viz_q(n));
    __viz_cfirst = 1; __viz_cline = l;
}
static void __viz_fend(void) {
    char b[560]; sprintf(b, "%s],\"line\":%d}", __viz_cb, __viz_cline); __viz_put(b);
}
static void __viz_e(const char* n) { __viz_ev("return", n, 0, 0, 0, 0); }

/* heap registry */
static struct { void* a; unsigned long sz; int id; int freed; } __viz_hp[VIZ_HEAP_MAX];
static int __viz_hn = 0;
static int __viz_hfind(void* p) { int i; for (i = 0; i < __viz_hn; i++) if (__viz_hp[i].a == p) return i; return -1; }
static int __viz_hreg_quiet(void* p, unsigned long sz) {
    int i = __viz_hfind(p);
    if (i >= 0) { __viz_hp[i].freed = 0; __viz_hp[i].sz = sz; return __viz_hp[i].id; }
    if (!p || __viz_hn >= VIZ_HEAP_MAX) return 0;
    __viz_hp[__viz_hn].a = p; __viz_hp[__viz_hn].sz = sz;
    __viz_hp[__viz_hn].id = __viz_hn + 1; __viz_hp[__viz_hn].freed = 0;
    return __viz_hp[__viz_hn++].id;
}
static void* __viz_alloc_raw(unsigned long sz) {
    void* p = malloc(sz);
    int id = __viz_hreg_quiet(p, sz);
    if (id) { char pv[48]; sprintf(pv, "%lu bytes", sz); __viz_ev("heap-alloc", 0, 0, 0, pv, id); }
    return p;
}
static void __viz_free_raw(void* p) {
    int i = __viz_hfind(p);
    if (i >= 0 && !__viz_hp[i].freed) { __viz_hp[i].freed = 1; __viz_ev("free", 0, 0, 0, 0, __viz_hp[i].id); }
    free(p);
}
static void* __viz_calloc_raw(unsigned long n, unsigned long sz) {
    void* p = __viz_alloc_raw(n * sz);
    if (p) memset(p, 0, (size_t)(n * sz));
    return p;
}
static void* __viz_realloc_raw(void* p, unsigned long sz) {
    int i = __viz_hfind(p);
    if (i >= 0 && !__viz_hp[i].freed) { __viz_hp[i].freed = 1; __viz_ev("free", 0, 0, 0, 0, __viz_hp[i].id); }
    void* q = realloc(p, (size_t)sz);
    int id = __viz_hreg_quiet(q, sz);
    if (id) { char pv[48]; sprintf(pv, "%lu bytes", sz); __viz_ev("heap-alloc", 0, 0, 0, pv, id); }
    return q;
}

/* typed value hooks — ret captures the VALUE only; pop comes from __viz_e at the closing brace */
#define VIZ_NUM(SUF, KIND, PARAM, FMT) \
    static void __viz_decl_##SUF(const char* n, int l, PARAM v) { char p[40]; sprintf(p, FMT, v); __viz_ev("declare", n, l, KIND, p, 0); } \
    static void __viz_asg_##SUF(const char* n, int l, PARAM v) { char p[40]; sprintf(p, FMT, v); __viz_ev("assign", n, l, KIND, p, 0); } \
    static void __viz_arg_##SUF(const char* n, PARAM v) { char p[72]; sprintf(p, "%s=" FMT, n, v); __viz_carg(p); } \
    static PARAM __viz_ret_##SUF(int l, PARAM v) { char p[40]; sprintf(p, FMT, v); __viz_ev("retval", 0, l, KIND, p, 0); return v; }

VIZ_NUM(int,    "int",    int,       "%d")
VIZ_NUM(uint,   "uint",   unsigned,  "%u")
VIZ_NUM(long,   "long",   long long, "%lld")
VIZ_NUM(float,  "float",  double,    "%g")
VIZ_NUM(double, "double", double,    "%g")
VIZ_NUM(char,   "char",   char,      "%c")

static void __viz_decl_bool(const char* n, int l, int v) { __viz_ev("declare", n, l, "bool", v ? "true" : "false", 0); }
static void __viz_asg_bool(const char* n, int l, int v) { __viz_ev("assign", n, l, "bool", v ? "true" : "false", 0); }
static void __viz_arg_bool(const char* n, int v) { char p[72]; sprintf(p, "%s=%s", n, v ? "true" : "false"); __viz_carg(p); }
static int  __viz_ret_bool(int l, int v) { __viz_ev("retval", 0, l, "bool", v ? "true" : "false", 0); return v; }

static void __viz_decl_str(const char* n, int l, const char* v) { __viz_ev("declare", n, l, "string", v ? v : "(null)", 0); }
static void __viz_asg_str(const char* n, int l, const char* v) { __viz_ev("assign", n, l, "string", v ? v : "(null)", 0); }
static void __viz_arg_str(const char* n, const char* v) { char p[120]; snprintf(p, 120, "%s=%s", n, v ? v : "(null)"); __viz_carg(p); }

#define VIZ_ARR(SUF, PARAM, FMT) \
    static void __viz_arr_##SUF(const char* n, int l, int c, PARAM* a) { \
        char p[172]; int L = 1, i; strcpy(p, "["); \
        for (i = 0; i < c && i < 8; i++) { char t[40]; sprintf(t, FMT, a[i]); \
            if (L + (int)strlen(t) + 8 > 165) { strcat(p, ", ..."); break; } \
            if (i) { strcat(p, ", "); L += 2; } strcat(p, t); L += (int)strlen(t); } \
        strcat(p, "]"); __viz_ev("declare", n, l, "array", p, 0); }

VIZ_ARR(int,    int,       "%d")
VIZ_ARR(long,   long long, "%lld")
VIZ_ARR(float,  float,     "%g")
VIZ_ARR(double, double,    "%g")
static void __viz_arr_uninit(const char* n, int l, const char* kind) { __viz_ev("declare", n, l, kind, "(uninitialized)", 0); }

static void __viz_ptr_preview(void* p, char* pv) {
    int i = __viz_hfind(p);
    if (i >= 0 && !__viz_hp[i].freed) sprintf(pv, "heap h%d (%lu bytes)", __viz_hp[i].id, __viz_hp[i].sz);
    else sprintf(pv, "%p", p);
}
static void __viz_decl_ptr(const char* n, int l, void* p, const char* target) {
    char pv[96]; int i;
    if (target && *target) sprintf(pv, "-> %s", target); else __viz_ptr_preview(p, pv);
    i = __viz_hfind(p);
    __viz_ev("declare", n, l, "pointer", pv, (i >= 0) ? __viz_hp[i].id : 0);
}
static void __viz_asg_ptr(const char* n, int l, void* p, const char* target) {
    char pv[96]; int i;
    if (target && *target) sprintf(pv, "-> %s", target); else __viz_ptr_preview(p, pv);
    i = __viz_hfind(p);
    __viz_ev("assign", n, l, "pointer", pv, (i >= 0) ? __viz_hp[i].id : 0);
}
static void* __viz_ret_ptr(int l, void* p) {
    char pv[96]; int i = __viz_hfind(p);
    __viz_ptr_preview(p, pv);
    __viz_ev("retval", 0, l, "pointer", pv, (i >= 0) ? __viz_hp[i].id : 0);
    return p;
}

static void __viz_flush(void) {
    FILE* f = fopen("__viz_trace.json", "w");
    int i;
    if (!f) return;
    fputs("{\"ok\":true,\"lang\":\"__LANG__\",\"events\":[", f);
    fwrite(__viz_store, 1, (size_t)(__viz_w - __viz_store), f);
    fputs("],\"heap\":{", f);
    for (i = 0; i < __viz_hn; i++) {
        char p[48]; sprintf(p, "%lu bytes", __viz_hp[i].sz);
        fprintf(f, "%s\"h%d\":{\"type\":\"block\",\"preview\":\"%s\"}", i ? "," : "", __viz_hp[i].id, p);
    }
    fputs("}}", f);
    fclose(f);
}
static void __viz_crash(int s) { __viz_flush(); signal(s, SIG_DFL); raise(s); }
__attribute__((constructor)) static void __viz_init(void) {
    atexit(__viz_flush);
    signal(SIGSEGV, __viz_crash);
    signal(SIGABRT, __viz_crash);
}
`;

    const cppExtra = cpp ? String.raw`
/* C++ extras */
template<class T> const char* __viz_typename() { return typeid(T).name(); }
template<> const char* __viz_typename<int>() { return "int"; }
template<> const char* __viz_typename<long>() { return "long"; }
template<> const char* __viz_typename<float>() { return "float"; }
template<> const char* __viz_typename<double>() { return "double"; }
template<> const char* __viz_typename<char>() { return "char"; }
template<> const char* __viz_typename<bool>() { return "bool"; }
template<> const char* __viz_typename<std::string>() { return "string"; }

template<class T> void __viz_decl_gen(const char* n, int l, const T& v) {
    std::ostringstream o; o << v;
    __viz_ev("declare", n, l, __viz_typename<T>(), o.str().c_str(), 0);
}
template<class T> void __viz_asg_gen(const char* n, int l, const T& v) {
    std::ostringstream o; o << v;
    __viz_ev("assign", n, l, __viz_typename<T>(), o.str().c_str(), 0);
}
template<class T> void __viz_arg_gen(const char* n, const T& v) {
    std::ostringstream o; o << n << "=" << v;
    __viz_carg(o.str().c_str());
}
template<class T> T __viz_ret_gen(int l, const T& v) {
    std::ostringstream o; o << v;
    __viz_ev("retval", 0, l, __viz_typename<T>(), o.str().c_str(), 0);
    return v;
}

/* vector: show contents + link its internal HEAP buffer */
template<class T> void __viz_vec_out(const char* ev, const char* n, int l, const std::vector<T>& v) {
    std::ostringstream o; o << "[";
    int c = 0;
    for (typename std::vector<T>::const_iterator it = v.begin(); it != v.end() && c < 8; ++it, ++c) { if (c) o << ", "; o << *it; }
    if ((int)v.size() > 8) o << ", ...";
    o << "]";
    void* d = (void*)v.data();
    int hid = d ? __viz_hreg_quiet(d, (unsigned long)(v.capacity() * sizeof(T))) : 0;
    __viz_ev(ev, n, l, "vector", o.str().c_str(), hid);
}
template<class T> void __viz_decl_vec(const char* n, int l, const std::vector<T>& v) { __viz_vec_out("declare", n, l, v); }
template<class T> void __viz_asg_vec(const char* n, int l, const std::vector<T>& v) { __viz_vec_out("assign", n, l, v); }

struct __VizOut {
    std::ostringstream b;
    template<class T> __VizOut& operator<<(const T& v) { b << v; return *this; }
    __VizOut& operator<<(std::ostream& (*m)(std::ostream&)) {
        std::string s = b.str();
        __viz_ev("log", 0, 0, 0, s.c_str(), 0);
        b.str(std::string());
        std::cout << m;
        return *this;
    }
};
static __VizOut __viz_out;
inline std::ostream& __viz_endl(std::ostream& o) { return std::endl(o); }

void* operator new(size_t sz) { return __viz_alloc_raw((unsigned long)sz); }
void* operator new[](size_t sz) { return __viz_alloc_raw((unsigned long)sz); }
void operator delete(void* p) noexcept { __viz_free_raw(p); }
void operator delete[](void* p) noexcept { __viz_free_raw(p); }
void operator delete(void* p, size_t) noexcept { __viz_free_raw(p); }
void operator delete[](void* p, size_t) noexcept { __viz_free_raw(p); }
` : '';

    const macros = (cpp ? '' : `#define malloc(sz) __viz_alloc_raw((unsigned long)(sz))
#define calloc(n, sz) __viz_calloc_raw((unsigned long)(n), (unsigned long)(sz))
#define realloc(p, sz) __viz_realloc_raw((p), (unsigned long)(sz))
#define free(p) __viz_free_raw(p)
`) + `
static int __viz_printf_(int line, const char* fmt, ...) {
    char b[1024]; va_list ap; va_start(ap, fmt);
    int n = vsnprintf(b, sizeof b, fmt, ap); va_end(ap);
    __viz_ev("log", 0, line, 0, b, 0);
    return n;
}
#define printf(...) __viz_printf_(__LINE__, __VA_ARGS__)
` + (cpp ? `#define cout __viz_out
#define endl __viz_endl
` : '');

    return (includes + core + cppExtra + macros).replace(/__LANG__/g, lang);
}

/* ---------------- instrumentation ---------------- */
const C_SCALARS = {
    'int': 'int', 'short': 'int', 'long': 'long', 'long long': 'long',
    'unsigned': 'uint', 'unsigned int': 'uint', 'unsigned long': 'long',
    'float': 'float', 'double': 'double', 'char': 'char', 'bool': 'bool'
};
const RESERVED = new Set(['int', 'long', 'short', 'unsigned', 'float', 'double', 'char', 'bool', 'void', 'const',
    'struct', 'class', 'union', 'enum', 'static', 'extern', 'signed', 'auto', 'string', 'vector', 'size_t', 'FILE',
    'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'new', 'delete', 'this',
    'true', 'false', 'nullptr', 'NULL']);

function splitArgs(s) {
    const parts = []; let cur = '', angle = 0;
    for (const ch of (s || '').trim()) {
        if (ch === '<') angle++; if (ch === '>') angle--;
        if (ch === ',' && angle === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((p) => p.trim()).filter(Boolean);
}

function parseArg(a) {
    a = a.split('=')[0].trim();
    if (/\[[^\]]*\]/.test(a)) return null;
    const nameM = a.match(/([A-Za-z_]\w*)\s*$/);
    if (!nameM || RESERVED.has(nameM[1])) return null;
    const name = nameM[1];
    const isPtr = /\*/.test(a);
    const toks = a.replace(/[&*]/g, ' ').split(/\s+/).filter(Boolean);
    const has = (w) => toks.includes(w);
    if (isPtr) return has('char') ? { name, hook: 'str' } : null;
    if (has('int') || has('short')) return { name, hook: 'int' };
    if (has('long')) return { name, hook: 'long' };
    if (has('unsigned')) return { name, hook: 'uint' };
    if (has('double')) return { name, hook: 'double' };
    if (has('float')) return { name, hook: 'float' };
    if (has('bool')) return { name, hook: 'bool' };
    if (has('char')) return { name, hook: 'char' };
    if (has('string')) return { name, hook: 'gen' };
    if (has('vector')) return { name, hook: 'gen' };
    return null;
}

function retHookFor(curRet, isCpp) {
    const ret = String(curRet || '')
        .replace(/^(const|static|inline|virtual)\s+/g, '')
        .replace(/^(const|static|inline|virtual)\s+/g, '').trim();
    if (!ret || ret === 'void') return null;
    if (ret.includes('*')) return 'ptr';
    if (isCpp && /string/.test(ret)) return 'gen';
    return C_SCALARS[ret] || null;
}

function instrument(code, lang) {
    const isCpp = lang === 'cpp';
    const src = code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

    const includes = [], body = [];
    src.split('\n').forEach((l, idx) => {
        if (/^\s*#include/.test(l)) includes.push(l);
        else body.push({ l, ln: idx + 1 });
    });

    const outLines = [];
    const varTypes = new Map();
    let depth = 0, curRet = null, curFn = null;

    const clean = (s) => s.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])*'/g, "''").replace(/\/\/.*$/, '');
    const braces = (s) => (s.match(/\{/g) || []).length - (s.match(/\}/g) || []).length;

    for (const { l: origLine, ln } of body) {
        let line = origLine;
        const t = line.trim();
        const t2 = t.replace(/\/\/.*$/, '');
        const cs = clean(line);
        const delta = braces(cs);

        if (isCpp) {
            line = line.replace(/std::cout/g, '__viz_out').replace(/std::endl/g, '__viz_endl');
        }

        /* ---- function opens (depth 0) ---- */
        if (depth === 0 && /\{\s*$/.test(t2) && !/^(if|for|while|switch|else|do)\b/.test(t)) {
            const m = t2.match(/^([A-Za-z_][\w:<>,&*\s]*?)\s*([A-Za-z_]\w*)\s*\(([^;(){}]*)\)\s*\{$/);
            if (m) {
                curRet = m[1].trim();
                let h = ` __viz_f("${m[2]}", ${ln});`;
                for (const a of splitArgs(m[3])) {
                    const p = parseArg(a);
                    if (p) h += ` __viz_arg_${p.hook}("${p.name}", ${p.name});`;
                }
                h += ' __viz_fend();';
                line = line.replace(/\{\s*$/, '{' + h);
                outLines.push(line);
                depth += delta;
                curFn = { name: m[2], bodyDepth: depth };
                continue;
            }
        }

        /* ---- function closes → inject the ONE pop event ---- */
        if (curFn && delta < 0 && depth === curFn.bodyDepth && /\}/.test(cs)) {
            outLines.push(`__viz_e("${curFn.name}"); ` + line);
            depth += delta;
            curFn = null; curRet = null;
            continue;
        }

        /* ---- returns → capture the VALUE only (pop comes at the closing brace) ---- */
        if (curFn && /\breturn\b/.test(cs)) {
            const hook = retHookFor(curRet, isCpp);
            if (hook && /return\s+[^;]+;/.test(t2)) {
                line = line.replace(/return\s+([^;]+);/, `return __viz_ret_${hook}(${ln}, $1);`);
            }
        }

        /* ---- declarations & assignments ---- */
        let m;
        if ((m = t2.match(/^(?:const\s+)?char\s+(\w+)\s*\[\s*\d*\s*\]\s*=\s*".*";$/))) {
            line += ` __viz_decl_str("${m[1]}", ${ln}, ${m[1]});`; varTypes.set(m[1], 'str');
        } else if ((m = t2.match(/^(?:const\s+)?(int|long long|long|float|double)\s+(\w+)\s*\[\s*(\d*)\s*\]\s*=\s*\{(.*)\};$/))) {
            const cnt = m[4].length ? m[4].split(',').length : (+m[3] || 0);
            line += ` __viz_arr_${m[1] === 'long long' ? 'long' : m[1]}("${m[2]}", ${ln}, ${cnt}, ${m[2]});`; varTypes.set(m[2], 'arr');
        } else if ((m = t2.match(/^(int|long long|long|float|double|char)\s+(\w+)\s*\[\s*\d+\s*\];$/))) {
            line += ` __viz_arr_uninit("${m[2]}", ${ln}, "${m[1] === 'long long' ? 'long' : m[1]}");`; varTypes.set(m[2], 'arr');
        } else if ((m = t2.match(/^(?:const\s+)?(?:unsigned\s+)?(?:int|long|short|float|double|char|bool)\s*\*\s*(\w+)\s*=\s*(.+);$/))) {
            const init = m[2].trim();
            const target = init.startsWith('&') ? `"${init.slice(1).replace(/[^A-Za-z0-9_].*$/, '')}"` : '0';
            line += init.startsWith('"')
                ? ` __viz_decl_str("${m[1]}", ${ln}, ${m[1]});`
                : ` __viz_decl_ptr("${m[1]}", ${ln}, (void*)${m[1]}, ${target});`;
            varTypes.set(m[1], 'ptr');
        } else if ((m = t2.match(/^(?:const\s+)?(int|long long|long|short|unsigned|unsigned int|unsigned long|float|double|char|bool)\s+(\w+)\s*=\s*(.+);$/))) {
            const key = m[1] === 'unsigned int' ? 'unsigned' : m[1];
            line += ` __viz_decl_${C_SCALARS[key] || 'int'}("${m[2]}", ${ln}, ${m[2]});`;
            varTypes.set(m[2], C_SCALARS[key] || 'int');
        } else if (isCpp && (m = t2.match(/^(?:const\s+)?(?:std::)?string\s+(\w+)\s*(?:=[^;]+)?;$/))) {
            line += ` __viz_decl_gen("${m[1]}", ${ln}, ${m[1]});`; varTypes.set(m[1], 'gen');
        } else if (isCpp && (m = t2.match(/^(?:const\s+)?(?:std::)?vector\s*<[^;=]+>\s+(\w+)\s*(?:=[^;]+)?;$/))) {
            line += ` __viz_decl_vec("${m[1]}", ${ln}, ${m[1]});`; varTypes.set(m[1], 'vec');
        }

        if ((m = t2.match(/^(\w+)\s*=\s*([^=].*);$/)) && varTypes.has(m[1])) {
            const v = varTypes.get(m[1]);
            line += v === 'ptr' ? ` __viz_asg_ptr("${m[1]}", ${ln}, (void*)${m[1]}, 0);`
                : v === 'gen' ? ` __viz_asg_gen("${m[1]}", ${ln}, ${m[1]});`
                    : v === 'vec' ? ` __viz_asg_vec("${m[1]}", ${ln}, ${m[1]});`
                        : v === 'str' ? ` __viz_asg_str("${m[1]}", ${ln}, ${m[1]});`
                            : ` __viz_asg_${v}("${m[1]}", ${ln}, ${m[1]});`;
        }
        if (isCpp && (m = t2.match(/^(\w+)\.(?:push_back|pop_back|clear)\s*\(.+\);$/)) && varTypes.get(m[1]) === 'vec') {
            line += ` __viz_asg_vec("${m[1]}", ${ln}, ${m[1]});`;
        }

        outLines.push(line);
        depth += delta;
        if (depth <= 0) { depth = 0; curFn = null; curRet = null; }
    }

    const firstLine = body.length ? body[0].ln : 1;
    return includes.join('\n') + '\n' + buildPrelude(lang) +
        `\n#line ${firstLine} "UserCode"\n` + outLines.join('\n') + '\n';
}

/* ---------------- main ---------------- */
(async () => {
    const lang = process.argv[2] === 'cpp' ? 'cpp' : 'c';
    const cc = lang === 'cpp' ? 'g++' : 'gcc';
    let code = '';
    await new Promise((res) => {
        process.stdin.on('data', (c) => (code += c));
        process.stdin.on('end', res);
    });

    try { execFileSync(cc, ['--version'], { stdio: 'ignore' }); }
    catch {
        return out({ ok: false, error: `${cc} not found — install a C/C++ compiler (MinGW-w64 on Windows) and restart the server` });
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelive-c-'));
    try {
        fs.writeFileSync(path.join(dir, lang === 'cpp' ? 'main.cpp' : 'main.c'), instrument(code, lang));

        let compileErr = '';
        try {
            execFileSync(cc, ['-w', '-O0', '-o', 'program', lang === 'cpp' ? 'main.cpp' : 'main.c'],
                { cwd: dir, timeout: 30000 });
        } catch (e) { compileErr = String(e.stderr || e.message || ''); }
        if (compileErr) {
            return out({ ok: false, error: 'Compile error: ' + compileErr.split('\n').filter(Boolean).slice(0, 4).join(' | ') });
        }

        const exe = path.join(dir, process.platform === 'win32' ? 'program.exe' : 'program');
        await new Promise((resolve) => {
            const child = spawn(exe, [], { cwd: dir, windowsHide: true, stdio: 'ignore' });
            const timer = setTimeout(() => { try { child.kill(); } catch { } }, 6000);
            child.on('error', () => { });
            child.on('close', () => { clearTimeout(timer); resolve(); });
        });

        const traceFile = path.join(dir, '__viz_trace.json');
        if (fs.existsSync(traceFile)) {
            const trace = JSON.parse(fs.readFileSync(traceFile, 'utf-8'));
            trace.lang = lang;
            return out(trace);
        }
        return out({ ok: false, error: 'No trace produced — program may have crashed or is waiting for input (scanf/cin)' });
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { }
    }
})();