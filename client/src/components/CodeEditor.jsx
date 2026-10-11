import { useRef, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { socket } from '../socket';
import { registerSuggestions } from '../monaco-suggestions';

const MONACO_LANG = {
    javascript: 'javascript', python: 'python', c: 'c', cpp: 'cpp', java: 'java',
};

export default function CodeEditor({
    initialCode, language = 'javascript',
    onCodeChange, onRun, loadRequest, activeLine,
}) {
    const editorRef = useRef(null);
    const monacoRef = useRef(null);
    const decoRef = useRef(null);
    const isRemote = useRef(false);               // echo-loop guard!
    const onRunRef = useRef(onRun);
    const onCodeChangeRef = useRef(onCodeChange);

    /* NEW: placeholder state — true while the editor is empty */
    const [isEmpty, setIsEmpty] = useState(!initialCode);

    useEffect(() => { onRunRef.current = onRun; }, [onRun]);
    useEffect(() => { onCodeChangeRef.current = onCodeChange; }, [onCodeChange]);

    const handleMount = (editor, monaco) => {
        registerSuggestions(monaco);   // C/C++/Python IntelliSense

        editorRef.current = editor;
        monacoRef.current = monaco;

        // existing code in the room (late joiners) → no placeholder
        if (initialCode) {
            isRemote.current = true;
            editor.setValue(initialCode);
            isRemote.current = false;
            onCodeChangeRef.current?.(initialCode);
            setIsEmpty(false);
        }

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current());

        editor.onDidChangeModelContent(() => {
            const code = editor.getValue();

            // NEW: placeholder logic — runs for BOTH my typing and remote changes
            setIsEmpty(code === '');

            if (isRemote.current) return;   // remote change → don't re-send
            onCodeChangeRef.current?.(code);
            socket.emit('code-change', { code });
        });
    };

    // language changed (by me or by anyone) → switch Monaco highlighting
    useEffect(() => {
        const ed = editorRef.current;
        if (ed && monacoRef.current) {
            monacoRef.current.editor.setModelLanguage(ed.getModel(), MONACO_LANG[language] || 'javascript');
        }
    }, [language]);

    // a saved file was loaded → put it in the editor
    useEffect(() => {
        if (loadRequest && editorRef.current) {
            editorRef.current.setValue(loadRequest.code);
        }
    }, [loadRequest]);

    // highlight the line the visualizer is currently on
    useEffect(() => {
        const ed = editorRef.current;
        if (!ed) return;
        if (decoRef.current) decoRef.current.clear();
        if (activeLine != null && monacoRef.current) {
            decoRef.current = ed.createDecorationsCollection([
                {
                    range: new monacoRef.current.Range(activeLine, 1, activeLine, 1),
                    options: { isWholeLine: true, className: 'viz-active-line' },
                },
            ]);
        }
    }, [activeLine]);

    // another user types → apply their code, keep my cursor position
    useEffect(() => {
        const onRemoteCode = ({ code }) => {
            const ed = editorRef.current;
            if (!ed) return;
            const pos = ed.getPosition();
            isRemote.current = true;
            ed.setValue(code);
            if (pos) ed.setPosition(pos);
            isRemote.current = false;

            setIsEmpty(code === '');              // NEW: placeholder follows remote edits too
            onCodeChangeRef.current?.(code);
        };
        socket.on('code-change', onRemoteCode);
        return () => socket.off('code-change', onRemoteCode);
    }, []);

    return (
        <div className="editor-wrap">
            <Editor
                height="100%"
                defaultLanguage="javascript"
                theme="vs-dark"
                onMount={handleMount}
                options={{
                    fontSize: 15,
                    minimap: { enabled: false },
                    automaticLayout: true,
                    quickSuggestions: true,
                    wordBasedSuggestions: 'currentDocument',
                    tabCompletion: 'on',
                }}
            />

            {/* NEW: placeholder overlay — pure visual, never synced as code */}
            {isEmpty && <div className="editor-placeholder"> Write a code Here…</div>}
        </div>
    );
}