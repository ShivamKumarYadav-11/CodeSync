#!/usr/bin/env python3
"""
viz-runner.py — memory visualizer engine for PYTHON
(reads code from stdin, prints JSON trace — same format as viz-runner.js)
"""
import ast
import json
import sys

MAX_EVENTS = 3000

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

def output(obj):
    sys.stdout.write(json.dumps(obj))
    sys.exit(0)

try:
    src = sys.stdin.read()
except Exception:
    output({'ok': False, 'error': 'no input'})

# ---------------- events & heap ----------------
EVENTS = []
HEAP = {}        # 'h1' -> {'type': ..., 'preview': ...}
HEAP_IDS = {}    # id(obj) -> 'h1'
heap_counter = 0

def emit(ev):
    if len(EVENTS) < MAX_EVENTS:
        EVENTS.append(ev)

def kind_of(v):
    if v is None: return 'none'
    if isinstance(v, bool): return 'bool'
    if isinstance(v, int): return 'int'
    if isinstance(v, float): return 'float'
    if isinstance(v, str): return 'str'
    if isinstance(v, list): return 'list'
    if isinstance(v, tuple): return 'tuple'
    if isinstance(v, dict): return 'dict'
    if isinstance(v, set): return 'set'
    if callable(v): return 'function'
    return type(v).__name__          # custom class → shows its own name!

def preview(v, depth=0):
    try:
        if v is None: return 'None'
        if isinstance(v, bool): return 'True' if v else 'False'
        if isinstance(v, str): return json.dumps(v)
        if isinstance(v, (int, float)): return str(v)
        if callable(v): return 'ƒ %s()' % getattr(v, '__name__', 'anonymous')
        if isinstance(v, (list, tuple)):
            if depth >= 2: return '[…]'
            items = [preview(x, depth + 1) for x in list(v)[:6]]
            extra = ', …' if len(v) > 6 else ''
            return '[' + ', '.join(items) + extra + ']'
        if isinstance(v, dict):
            if depth >= 2: return '{…}'
            inner = ', '.join('%s: %s' % (k, preview(v[k], depth + 1))
                              for k in list(v.keys())[:5])
            return '{ ' + inner + ' }'
        if isinstance(v, set):
            return '{' + ', '.join(preview(x, depth + 1) for x in list(v)[:5]) + '}'
        return '<%s>' % type(v).__name__
    except Exception:
        return '?'

def snap(value):
    global heap_counter
    primitive = value is None or isinstance(value, (bool, int, float, str))
    if not primitive:                      # list/dict/set/custom object → HEAP
        hid = HEAP_IDS.get(id(value))
        if hid is None:
            heap_counter += 1
            hid = 'h%d' % heap_counter
            HEAP_IDS[id(value)] = hid
            HEAP[hid] = {'type': kind_of(value), 'preview': preview(value)}
        return {'kind': HEAP[hid]['type'], 'heapId': hid, 'preview': HEAP[hid]['preview']}
    return {'kind': kind_of(value), 'heapId': None, 'preview': preview(value)}

# ---------------- hooks injected into user code ----------------
def __d(name, value):
    emit({'type': 'declare', 'name': name,
          'line': sys._getframe(1).f_lineno, **snap(value)})
    return value

def __f(name, args, def_line):
    emit({'type': 'call', 'name': name, 'args': args, 'line': def_line})

def __e(name):
    emit({'type': 'return', 'name': name})

def __r(value):
    emit({'type': 'retval', 'line': sys._getframe(1).f_lineno, **snap(value)})
    return value

def __print(*args, **kwargs):
    sep = kwargs.get('sep', ' ')
    emit({'type': 'log', 'text': sep.join(preview(a, 1) for a in args)})

# ---------------- AST instrumentation ----------------
class Instrumentor(ast.NodeTransformer):

    def visit_Assign(self, node):
        self.generic_visit(node)
        if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            node.value = ast.Call(
                func=ast.Name(id='__d', ctx=ast.Load()),
                args=[ast.Constant(value=name), node.value], keywords=[])
        return node

    def visit_AnnAssign(self, node):            # x: int = 5
        self.generic_visit(node)
        if node.value is not None and isinstance(node.target, ast.Name):
            node.value = ast.Call(
                func=ast.Name(id='__d', ctx=ast.Load()),
                args=[ast.Constant(value=node.target.id), node.value], keywords=[])
        return node

    def visit_FunctionDef(self, node):
        self.generic_visit(node)
        fname = node.name
        argnames = [a.arg for a in node.args.args]
        push = ast.Expr(value=ast.Call(
            func=ast.Name(id='__f', ctx=ast.Load()),
            args=[ast.Constant(value=fname),
                  ast.List(elts=[ast.Name(id=a, ctx=ast.Load()) for a in argnames],
                           ctx=ast.Load()),
                  ast.Constant(value=node.lineno)],
            keywords=[]))
        pop = ast.Expr(value=ast.Call(
            func=ast.Name(id='__e', ctx=ast.Load()),
            args=[ast.Constant(value=fname)], keywords=[]))
        node.body = [push, ast.Try(body=node.body or [ast.Pass()],
                                   handlers=[], orelse=[], finalbody=[pop])]
        return node

    def visit_Return(self, node):
        self.generic_visit(node)
        if node.value is not None:
            node.value = ast.Call(
                func=ast.Name(id='__r', ctx=ast.Load()),
                args=[node.value], keywords=[])
        return node

try:
    tree = ast.parse(src)
except SyntaxError as e:
    output({'ok': False, 'error': 'Syntax error: %s (line %s)' % (e.msg, e.lineno or 0)})

Instrumentor().visit(tree)
ast.fix_missing_locations(tree)

try:
    code_obj = compile(tree, '<UserCode>', 'exec')
except SyntaxError as e:
    output({'ok': False, 'error': 'Compile error: %s' % e.msg})

sys.setrecursionlimit(2000)
G = {'__d': __d, '__f': __f, '__e': __e, '__r': __r,
     'print': __print, '__name__': '__main__',
     '__builtins__': __builtins__}

try:
    exec(code_obj, G)
except BaseException as e:
    emit({'type': 'error', 'text': '%s: %s' % (type(e).__name__, e)})

output({'ok': True, 'events': EVENTS, 'heap': HEAP})