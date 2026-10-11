/* ============================================================
   monaco-suggestions.js
   IntelliSense-style suggestions for C, C++ and Python
   (Monaco ships full smart suggestions only for JavaScript)
============================================================ */
let registered = false;

export function registerSuggestions(monaco) {
    if (registered) return; // register only ONCE ever
    registered = true;

    const K = monaco.languages.CompletionItemKind;
    const SNIPPET = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;

    function provider(defs, triggers) {
        return {
            triggerCharacters: triggers,
            provideCompletionItems(model, position) {
                const word = model.getWordUntilPosition(position);
                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn,
                };
                return {
                    suggestions: defs.map(([label, kind, detail, insert, isSnip]) => ({
                        label, kind, detail, documentation: detail,
                        insertText: insert || label,
                        insertTextRules: isSnip ? SNIPPET : undefined,
                        range,
                    })),
                };
            },
        };
    }

    /* ------------------------- C ------------------------- */
    const C = [
        // keywords
        ['int', K.Keyword, 'int — integer type'],
        ['float', K.Keyword, 'float — decimal number'],
        ['double', K.Keyword, 'double — big decimal number'],
        ['char', K.Keyword, 'char — single character'],
        ['void', K.Keyword, 'void — no return value'],
        ['long', K.Keyword, 'long — bigger integer'],
        ['unsigned', K.Keyword, 'unsigned — only positive numbers'],
        ['const', K.Keyword, 'const — value cannot change'],
        ['static', K.Keyword, 'static — keeps value between calls'],
        ['struct', K.Keyword, 'struct — group of variables'],
        ['enum', K.Keyword, 'enum — named constants'],
        ['typedef', K.Keyword, 'typedef — create a type name'],
        ['sizeof', K.Keyword, 'sizeof — size in bytes'],
        ['return', K.Keyword, 'return — exit function / give value'],
        ['if', K.Keyword, 'if — condition'],
        ['else', K.Keyword, 'else — otherwise'],
        ['switch', K.Keyword, 'switch — multi-way branch'],
        ['case', K.Keyword, 'case — switch branch'],
        ['break', K.Keyword, 'break — exit loop/switch'],
        ['continue', K.Keyword, 'continue — next loop round'],
        // stdio.h
        ['printf', K.Function, 'printf(fmt, ...) — print to console [stdio.h]', 'printf("${1}", ${2});', true],
        ['scanf', K.Function, 'scanf(fmt, &var) — read input [stdio.h]', 'scanf("${1}", &${2});', true],
        ['puts', K.Function, 'puts(str) — print line + \\n [stdio.h]'],
        ['putchar', K.Function, 'putchar(c) — print one character [stdio.h]'],
        ['getchar', K.Function, 'getchar() — read one character [stdio.h]'],
        ['fgets', K.Function, 'fgets(buf, size, stdin) — read a line [stdio.h]'],
        ['fopen', K.Function, 'fopen(path, mode) — open a file [stdio.h]'],
        ['fclose', K.Function, 'fclose(file) — close a file [stdio.h]'],
        // stdlib.h
        ['malloc', K.Function, 'malloc(bytes) — allocate HEAP memory [stdlib.h]', '(${1:int}*) malloc(${2:n} * sizeof(${1:int}));', true],
        ['calloc', K.Function, 'calloc(count, size) — allocate + zero [stdlib.h]'],
        ['realloc', K.Function, 'realloc(ptr, bytes) — resize HEAP block [stdlib.h]'],
        ['free', K.Function, 'free(ptr) — release HEAP memory [stdlib.h]'],
        ['exit', K.Function, 'exit(code) — stop the program [stdlib.h]'],
        ['rand', K.Function, 'rand() — random number [stdlib.h]'],
        ['srand', K.Function, 'srand(seed) — seed random [stdlib.h]'],
        ['abs', K.Function, 'abs(n) — absolute value [stdlib.h]'],
        // string.h
        ['strlen', K.Function, 'strlen(str) — length of string [string.h]'],
        ['strcpy', K.Function, 'strcpy(dst, src) — copy string [string.h]'],
        ['strcmp', K.Function, 'strcmp(a, b) — compare strings [string.h]'],
        ['strcat', K.Function, 'strcat(dst, src) — join strings [string.h]'],
        ['strchr', K.Function, 'strchr(str, c) — find character [string.h]'],
        // math.h
        ['sqrt', K.Function, 'sqrt(x) — square root [math.h]'],
        ['pow', K.Function, 'pow(x, y) — x to the power y [math.h]'],
        ['fabs', K.Function, 'fabs(x) — absolute value of float [math.h]'],
        // snippets
        ['#include', K.Snippet, 'include a header file', '#include <${1:stdio.h}>', true],
        ['main', K.Snippet, 'main function template', 'int main() {\n\t${1}\n\treturn 0;\n}', true],
        ['for', K.Snippet, 'for loop', 'for (int i = 0; i < ${1:n}; i++) {\n\t${2}\n}', true],
        ['while', K.Snippet, 'while loop', 'while (${1:condition}) {\n\t${2}\n}', true],
    ];

    /* ------------------------- C++ ------------------------- */
    const CPP = [
        ...C, // everything from C works in C++ too
        // keywords
        ['class', K.Keyword, 'class — blueprint for objects'],
        ['public', K.Keyword, 'public — visible everywhere'],
        ['private', K.Keyword, 'private — visible inside class only'],
        ['protected', K.Keyword, 'protected — class + children'],
        ['namespace', K.Keyword, 'namespace — named scope'],
        ['using', K.Keyword, 'using — e.g. using namespace std;'],
        ['template', K.Keyword, 'template — generic code'],
        ['new', K.Keyword, 'new — allocate on the HEAP'],
        ['delete', K.Keyword, 'delete — free HEAP memory'],
        ['bool', K.Keyword, 'bool — true / false'],
        ['true', K.Keyword, 'true'],
        ['false', K.Keyword, 'false'],
        ['nullptr', K.Keyword, 'nullptr — empty pointer'],
        ['try', K.Keyword, 'try — risky code block'],
        ['catch', K.Keyword, 'catch — handle exception'],
        ['throw', K.Keyword, 'throw — raise an exception'],
        // iostream
        ['cout', K.Variable, 'cout << value — print to console [iostream]', 'cout << ${1} << endl;', true],
        ['cin', K.Variable, 'cin >> var — read input [iostream]', 'cin >> ${1};', true],
        ['endl', K.Variable, 'endl — newline + flush [iostream]'],
        ['getline', K.Function, 'getline(cin, s) — read a whole line [iostream]'],
        // STL
        ['vector', K.Class, 'vector<T> — dynamic array (lives on HEAP)'],
        ['string', K.Class, 'string — text type [std]'],
        ['map', K.Class, 'map<K,V> — key → value pairs'],
        ['set', K.Class, 'set<T> — unique values'],
        ['pair', K.Class, 'pair<A,B> — two values together'],
        ['push_back', K.Method, 'push_back(x) — add item at the end'],
        ['size', K.Method, 'size() — number of items'],
        ['empty', K.Method, 'empty() — is the container empty?'],
        ['sort', K.Function, 'sort(v.begin(), v.end()) — sort [algorithm]'],
        ['find', K.Method, 'find(x) — search in container'],
        ['append', K.Method, 'append(s) — add to string'],
        // snippets
        ['cpphello', K.Snippet, 'C++ hello world program',
            '#include <iostream>\nusing namespace std;\n\nint main() {\n\tcout << "${1:Hello World}" << endl;\n\treturn 0;\n}', true],
        ['vec', K.Snippet, 'declare a vector + add item',
            'vector<${1:int}> ${2:v};\n${2:v}.push_back(${3});', true],
    ];

    /* ------------------------- PYTHON ------------------------- */
    const PY = [
        // keywords
        ['def', K.Snippet, 'def — define a function', 'def ${1:name}(${2}):\n\t${3:pass}', true],
        ['class', K.Snippet, 'class — define a class', 'class ${1:Name}:\n\t${2:pass}', true],
        ['return', K.Keyword, 'return — exit function / give value'],
        ['if', K.Snippet, 'if — condition', 'if ${1:condition}:\n\t${2:pass}', true],
        ['elif', K.Keyword, 'elif — else if'],
        ['else', K.Keyword, 'else — otherwise'],
        ['for', K.Snippet, 'for loop', 'for ${1:i} in range(${2:n}):\n\t${3:pass}', true],
        ['while', K.Snippet, 'while loop', 'while ${1:condition}:\n\t${2:pass}', true],
        ['import', K.Keyword, 'import — load a module'],
        ['from', K.Keyword, 'from X import Y'],
        ['with', K.Keyword, 'with — context manager (auto close)'],
        ['try', K.Keyword, 'try — risky code block'],
        ['except', K.Keyword, 'except — handle error'],
        ['finally', K.Keyword, 'finally — always runs'],
        ['lambda', K.Keyword, 'lambda — tiny inline function'],
        ['pass', K.Keyword, 'pass — do nothing'],
        ['break', K.Keyword, 'break — exit loop'],
        ['continue', K.Keyword, 'continue — next loop round'],
        ['global', K.Keyword, 'global — use outer variable'],
        ['in', K.Keyword, 'in — membership test'],
        ['not', K.Keyword, 'not — logical NOT'],
        ['and', K.Keyword, 'and — logical AND'],
        ['or', K.Keyword, 'or — logical OR'],
        ['None', K.Keyword, 'None — no value'],
        ['True', K.Keyword, 'True'],
        ['False', K.Keyword, 'False'],
        // builtins
        ['print', K.Function, 'print(...) — print to console', 'print(${1})', true],
        ['len', K.Function, 'len(x) — length / item count'],
        ['range', K.Function, 'range(n) — 0..n-1 numbers'],
        ['input', K.Function, 'input(prompt) — read from user'],
        ['int', K.Function, 'int(x) — convert to integer'],
        ['float', K.Function, 'float(x) — convert to decimal'],
        ['str', K.Function, 'str(x) — convert to string'],
        ['list', K.Function, 'list(...) — create a list'],
        ['dict', K.Function, 'dict(...) — create a dict'],
        ['set', K.Function, 'set(...) — unique items'],
        ['tuple', K.Function, 'tuple(...) — immutable list'],
        ['abs', K.Function, 'abs(x) — absolute value'],
        ['min', K.Function, 'min(...) — smallest value'],
        ['max', K.Function, 'max(...) — biggest value'],
        ['sum', K.Function, 'sum(list) — add all values'],
        ['sorted', K.Function, 'sorted(x) — sorted copy'],
        ['enumerate', K.Function, 'enumerate(x) — index + value pairs'],
        ['zip', K.Function, 'zip(a, b) — pair up two lists'],
        ['type', K.Function, 'type(x) — the type of x'],
        ['isinstance', K.Function, 'isinstance(x, T) — check type'],
        ['round', K.Function, 'round(x, digits) — round number'],
        // common methods
        ['append', K.Method, 'append(x) — add item at the end (list)'],
        ['extend', K.Method, 'extend(list) — add many items'],
        ['insert', K.Method, 'insert(pos, x) — add at position'],
        ['pop', K.Method, 'pop() — remove & return last item'],
        ['remove', K.Method, 'remove(x) — remove first match'],
        ['sort', K.Method, 'sort() — sort in place'],
        ['keys', K.Method, 'keys() — all dict keys'],
        ['values', K.Method, 'values() — all dict values'],
        ['items', K.Method, 'items() — (key, value) pairs'],
        ['get', K.Method, 'get(key) — safe dict lookup'],
        ['split', K.Method, 'split(sep) — string → list'],
        ['join', K.Method, 'join(list) — list → string'],
        ['strip', K.Method, 'strip() — remove spaces at ends'],
        ['upper', K.Method, 'upper() — UPPERCASE'],
        ['lower', K.Method, 'lower() — lowercase'],
        ['format', K.Method, 'format(...) — insert values into string'],
        // snippets
        ['main', K.Snippet, 'if __name__ == "__main__" block',
            "if __name__ == '__main__':\n\t${1:main()}", true],
    ];

    monaco.languages.registerCompletionItemProvider('c', provider(C, ['.']));
    monaco.languages.registerCompletionItemProvider('cpp', provider(CPP, ['.', '>']));
    monaco.languages.registerCompletionItemProvider('python', provider(PY, ['.']));
}