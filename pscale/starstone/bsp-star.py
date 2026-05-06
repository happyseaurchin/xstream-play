#!/usr/bin/env python3
"""
bsp.py — pure-form BSP for pscale JSON blocks.

No tree wrapper, no tuning field, no metadata. The block IS the tree.
Floor derived from the underscore chain. Digit 0 maps to key '_'.

Modes:
    bsp(block)                        → dir: full tree (depth-1 survey)
    bsp(block, number)                → spindle: root-to-target chain
    bsp(block, number, 'ring')        → ring: siblings at terminal
    bsp(block, number, 'dir')         → dir: subtree from target down
    bsp(block, number, pscale, 'point') → point: single node at pscale
    bsp(block, _, depth, 'disc')      → disc: all nodes at a depth
    bsp(block, number, '*')           → star: hidden directory at terminal

CLI:
    python bsp.py pscale-touchstone              # dir
    python bsp.py pscale-touchstone 2.1          # spindle
    python bsp.py pscale-touchstone 2.1 ring     # ring
    python bsp.py pscale-touchstone 2.1 dir      # subtree
    python bsp.py pscale-touchstone 3 -2 point   # point at pscale -2
    python bsp.py pscale-touchstone _ 3 disc     # disc at depth 3
    python bsp.py test-spatial 11 '*'            # star: hidden dir at blue house

Address conventions:
    1, 2, 3   Floor 1 (rendition). Whole numbers. Decimals from subnesting.
    100       Floor 3 (accumulation). Digit 0 walks the underscore spine.
    110.1     Hidden directory: digit 0 at pscale 0 enters underscore interior.
    Digit 0 always maps to key '_'.

Nested underscore collection:
    When _ is an object with its own _, follow the chain to the string.
    When _ is an object with no _, it's a zero-position interior (no spindle text).
    Digit children alongside nested _ are hidden directory content.
"""

import json, sys, os


def collect_underscore(node):
    """Follow the _._ chain to find the semantic text string.
    - If _ is a string: return it (normal case).
    - If _ is an object WITH its own _: recurse (hidden directory with text).
    - If _ is an object WITHOUT _: return None (zero-position interior, headless).
    """
    if not isinstance(node, dict) or '_' not in node:
        return None
    val = node['_']
    if isinstance(val, str):
        return val
    if isinstance(val, dict):
        if '_' in val:
            return collect_underscore(val)
        return None  # zero-position interior
    return None


def find_hidden_level(node):
    """Follow the underscore chain to find the level with digit children.
    Returns the object containing hidden content, or None.
    The hidden content is at the deepest underscore object that has digit children."""
    if not isinstance(node, dict) or '_' not in node:
        return None
    val = node['_']
    if not isinstance(val, dict):
        return None
    # Walk down the underscore chain, checking each level for digits
    current = val
    while isinstance(current, dict):
        if any(k in current for k in '123456789'):
            return current  # found the level with hidden content
        if '_' in current and isinstance(current['_'], dict):
            current = current['_']
        else:
            break
    return None


def has_hidden_directory(node):
    """Check if a node has a hidden directory (underscore subnested with digits)."""
    return find_hidden_level(node) is not None


def get_hidden_directory(node):
    """Extract the hidden directory contents from a node's underscore chain.
    Follows _._. ... to find the level with digit children.
    Returns dict of {digit: content} or None if no hidden directory."""
    level = find_hidden_level(node)
    if level is None:
        return None
    result = {}
    for k in '123456789':
        if k in level:
            result[k] = level[k]
    return result


def floor_depth(block):
    """Follow the underscore chain until a string. Count = floor.
    If chain hits an object with no _, it's a zero-position interior;
    floor is the count of _ keys traversed to reach it."""
    node = block
    depth = 0
    while isinstance(node, dict) and '_' in node:
        depth += 1
        node = node['_']
        if isinstance(node, str):
            return depth
    return depth


def parse_address(number):
    """Parse a pscale number into a list of digit characters to walk.
    The decimal point is a readability marker for the floor boundary, not structural.
    Strip it and walk all digits."""
    s = f'{number:.10f}' if isinstance(number, (int, float)) else str(number)
    # Remove decimal point — it's notation, not structure
    s = s.replace('.', '')
    # Strip trailing zeros from float formatting
    s = s.rstrip('0') or '0'
    return list(s)


def walk(block, digits):
    """Walk the tree collecting texts. Digit 0 maps to key '_'.
    Uses collect_underscore to follow nested _._ chains transparently.
    Returns (chain, terminal_node, parent_node, terminal_key)
    where chain is list of {'text': str, 'depth': int}."""
    chain = []
    node = block
    parent = None
    last_key = None
    depth = 0

    # Collect root text via collect_underscore (handles nested chains).
    root_text = collect_underscore(node)
    if root_text is not None:
        chain.append({'text': root_text, 'depth': depth})

    for d in digits:
        key = '_' if d == '0' else d
        if not isinstance(node, dict) or key not in node:
            break
        target = node[key]
        # Walking '0' into a string '_' means we've hit the floor spine —
        # this text was already collected when we arrived at this node.
        if d == '0' and isinstance(target, str):
            break
        parent = node
        last_key = key
        node = target
        depth += 1
        if isinstance(node, str):
            chain.append({'text': node, 'depth': depth})
            break
        elif isinstance(node, dict):
            # Use collect_underscore to follow nested _._ chains
            text = collect_underscore(node)
            if text is not None:
                chain.append({'text': text, 'depth': depth})

    return chain, node, parent, last_key


def bsp(block, number=None, point=None, mode=None):
    """Pure-form BSP. Block is the tree — no wrapper."""
    fl = floor_depth(block)

    # Dir (full) — no args
    if number is None and point is None and mode is None:
        return {'mode': 'dir', 'tree': block}

    # Disc — bsp(block, None, depth, 'disc')
    if mode == 'disc' and point is not None:
        target = int(point) if isinstance(point, str) else point
        nodes = []
        def collect(node, depth, path):
            if depth == target:
                if isinstance(node, str):
                    text = node
                elif isinstance(node, dict):
                    # Resolve underscore chain to floor string
                    inner = node.get('_')
                    while isinstance(inner, dict) and '_' in inner:
                        inner = inner['_']
                    text = inner if isinstance(inner, str) else None
                else:
                    text = None
                nodes.append({'path': path, 'text': text})
                return
            if not isinstance(node, dict):
                return
            # Walk both underscore and digit children
            if '_' in node and isinstance(node['_'], dict):
                collect(node['_'], depth + 1, f'{path}.0' if path else '0')
            for d in '123456789':
                if d in node:
                    collect(node[d], depth + 1, f'{path}.{d}' if path else d)
        collect(block, 0, '')
        return {'mode': 'disc', 'depth': target, 'nodes': nodes}

    # Parse address and walk
    digits = parse_address(number)
    chain, terminal, parent, last_key = walk(block, digits)

    # Star — hidden directory at terminal
    if point == '*':
        hd = get_hidden_directory(terminal)
        semantic = collect_underscore(terminal) if isinstance(terminal, dict) else None
        return {
            'mode': 'star',
            'address': str(number),
            'semantic': semantic,
            'hidden': hd,
        }

    # Ring — siblings at terminal
    if point == 'ring':
        if parent is None or not isinstance(parent, dict):
            return {'mode': 'ring', 'siblings': []}
        siblings = []
        # Include '_' as a navigable sibling (digit 0) if it's an object
        if last_key != '_' and '_' in parent and isinstance(parent['_'], dict):
            text = collect_underscore(parent)
            siblings.append({'digit': '0', 'text': text, 'branch': True})
        for d in '123456789':
            if d == last_key or d not in parent:
                continue
            v = parent[d]
            text = v if isinstance(v, str) else collect_underscore(v)
            siblings.append({'digit': d, 'text': text, 'branch': isinstance(v, dict)})
        return {'mode': 'ring', 'siblings': siblings}

    # Dir (subtree)
    if point == 'dir':
        return {'mode': 'dir', 'subtree': terminal}

    # Annotate chain with pscale: pscale = (floor - 1) - depth
    def pscale_at(depth):
        return (fl - 1) - depth

    # Point — content at a specific pscale
    if mode == 'point' and point is not None:
        ps = int(point) if isinstance(point, str) else point
        for entry in chain:
            if pscale_at(entry['depth']) == ps:
                return {'mode': 'point', 'pscale': ps, 'text': entry['text']}
        last = chain[-1] if chain else None
        return {'mode': 'point', 'pscale': ps, 'text': last['text'] if last else None}

    # Spindle (default) — annotate with pscale
    nodes = []
    for entry in chain:
        nodes.append({'pscale': pscale_at(entry['depth']), 'text': entry['text']})
    return {'mode': 'spindle', 'nodes': nodes}


# ---- CLI ----

def fmt_spindle(r):
    return '\n'.join(f"  [{n['pscale']:>3}] {n['text'][:200]}{'...' if len(n['text']) > 200 else ''}" for n in r['nodes'])

def fmt_ring(r):
    if not r.get('siblings'):
        return '  (no siblings)'
    return '\n'.join(f"  {s['digit']}: {(s.get('text') or '(branch)')[:120]}{'...' if len(s.get('text','')) > 120 else ''}{' +' if s.get('branch') else ''}" for s in r['siblings'])

def fmt_disc(r):
    if not r.get('nodes'):
        return '  (no nodes at this depth)'
    return '\n'.join(f"  [{n['path']}] {(n.get('text') or '(no text)')[:150]}" for n in r['nodes'])

def fmt_dir(r):
    tree = r.get('subtree') or r.get('tree', {})
    if 'subtree' in r:
        return json.dumps(tree, indent=2, ensure_ascii=False)
    lines = []
    def show_underscore(node, prefix=''):
        """Show underscore chain for floor > 1 blocks."""
        if isinstance(node, str):
            return node
        if isinstance(node, dict):
            inner = node.get('_')
            if isinstance(inner, str):
                return inner
            if isinstance(inner, dict):
                return f"(floor chain) → {show_underscore(inner)}"
        return str(node)
    root = tree.get('_', '')
    if isinstance(root, str) and root:
        lines.append(f"  _: {root[:200]}{'...' if len(root) > 200 else ''}")
    elif isinstance(root, dict):
        lines.append(f"  _: {show_underscore(root)[:200]}")
    for k in sorted(k for k in tree if k != '_'):
        v = tree[k]
        text = v if isinstance(v, str) else (v.get('_', '(branch)') if isinstance(v, dict) else str(v))
        lines.append(f"  {k}: {text[:120]}{'...' if len(text) > 120 else ''}")
    return '\n'.join(lines)


def main():
    if len(sys.argv) < 2:
        print("Usage: python tidy-up/bsp.py <block> [number|_] [ring|dir|pscale] [point|disc]")
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    block_name = sys.argv[1]
    path = os.path.join(script_dir, f'{block_name}.json')
    if not os.path.exists(path):
        print(f"Block not found: {path}")
        sys.exit(1)
    with open(path) as f:
        block = json.load(f)

    args = sys.argv[2:]
    number = None
    point = None
    mode = None

    if args:
        if args[0] == '_':
            number = None
        else:
            try:
                number = float(args[0])
            except ValueError:
                print(f"Invalid number: {args[0]}")
                sys.exit(1)

    if len(args) > 1:
        a = args[1]
        if a in ('ring', 'dir', '*'):
            point = a
        elif a == 'disc':
            mode = 'disc'
        else:
            try:
                point = int(a)
            except ValueError:
                point = a

    if len(args) > 2:
        a = args[2]
        if a in ('point', 'disc'):
            mode = a

    result = bsp(block, number, point, mode)
    m = result.get('mode')

    if m == 'star':
        print(f"[{block_name} {number} *]")
        if result.get('semantic'):
            print(f"  semantic: {result['semantic'][:150]}")
        if result.get('hidden'):
            for k, v in sorted(result['hidden'].items()):
                text = v if isinstance(v, str) else (collect_underscore(v) if isinstance(v, dict) else str(v))
                print(f"  {k}: {text[:150] if text else '(block)'}{'...' if text and len(text) > 150 else ''}")
        else:
            print("  (no hidden directory)")
        sys.exit(0)

    if m == 'spindle':
        print(f"[{block_name} {number}] spindle")
        print(fmt_spindle(result))
    elif m == 'ring':
        print(f"[{block_name} {number} ring]")
        print(fmt_ring(result))
    elif m == 'dir':
        label = f"{block_name} {number} dir" if number else f"{block_name} dir"
        print(f"[{label}]")
        print(fmt_dir(result))
    elif m == 'point':
        print(f"[{block_name} {number} point @ pscale {result.get('pscale')}]")
        print(f"  {result.get('text')}")
    elif m == 'disc':
        print(f"[{block_name} disc @ depth {result.get('depth')}]")
        print(fmt_disc(result))
    else:
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
