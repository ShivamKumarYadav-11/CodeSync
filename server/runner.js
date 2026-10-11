/* ============================================================
   runner.js — executes user code LOCALLY (the terminal runs)
   node / python / gcc / g++ / javac — whatever is installed
   on this machine. Each run gets its own temp folder.
============================================================ */
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';

// temp run folders → project root (same place as before the refactor)
const SANDBOX_DIR = path.join(__dirname, '..', 'sandbox');
fs.mkdirSync(SANDBOX_DIR, { recursive: true });

// Windows often has "py" instead of "python" — detect once at startup
let pythonCmd = 'python';
exec('python --version', (err) => {
    if (err) { pythonCmd = 'py'; console.log('🐍 Python command: "py"'); }
    else console.log('🐍 Python command: "python"');
});
function getPythonCmd() { return pythonCmd; }

const LANGUAGES = {
    javascript: { file: 'main.js', compile: null, run: 'node main.js' },
    python: { file: 'main.py', compile: null, run: null },
    c: { file: 'main.c', compile: 'gcc main.c -o program', run: IS_WIN ? 'program' : './program' },
    cpp: { file: 'main.cpp', compile: 'g++ main.cpp -o program', run: IS_WIN ? 'program' : './program' },
    java: { file: 'Main.java', compile: 'javac Main.java', run: 'java -cp . Main' },
};

/* run one shell command — 10s timeout, 1MB output cap */
function runCommand(cmd, cwd) {
    return new Promise((resolve) => {
        exec(cmd, { cwd, timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true },
            (error, stdout, stderr) => {
                let errText = (stderr || '').trim();
                if (error) {
                    if (error.killed) {
                        errText += (errText ? '\n' : '') +
                            '⏱ Program stopped — exceeded the 10 second limit (infinite loop?)';
                    } else if (!errText && !stdout) {
                        errText = error.message; // e.g. "'gcc' is not recognized..."
                    }
                }
                const exitCode = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
                resolve({ stdout: stdout || '', stderr: errText, exitCode });
            });
    });
}

/* write code to a temp folder → compile if needed → run → clean up */
async function runCodeLocally(code, language) {
    const lang = LANGUAGES[language] || LANGUAGES.javascript;
    const runDir = path.join(SANDBOX_DIR, `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, lang.file), code);

    try {
        if (lang.compile) {
            const c = await runCommand(lang.compile, runDir);
            if (c.exitCode !== 0) {
                return { compileStderr: c.stderr, stdout: '', stderr: '', exitCode: c.exitCode };
            }
        }
        const runCmd = lang.run === null ? `${pythonCmd} ${lang.file}` : lang.run;
        const r = await runCommand(runCmd, runDir);
        return { compileStderr: '', stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
    } finally {
        try { fs.rmSync(runDir, { recursive: true, force: true }); } catch { }
    }
}

module.exports = { LANGUAGES, getPythonCmd, runCodeLocally };