#!/usr/bin/env python3
# pairs.py <tip-workspace> — enumerate (test, closure) pairs at a tip.
# A test's closure is the sorted def-closure of exactly the names it
# imports from its module (per-def Tarjan hashes from the platform
# ledger): adding an unrelated def re-pairs nothing; a test importing
# a name that does not exist yet has NO pair (pending — born red is
# really born UNPAIRED). Namespace imports pair with the whole module.
# Prints JSON: [{test, testHash, module, closure|null}]
import hashlib, json, os, re, subprocess, sys, glob

RW = sys.argv[1]
mods = sorted(d for d in os.listdir(f"{RW}/modules") if os.path.isdir(f"{RW}/modules/{d}")) \
       if os.path.isdir(f"{RW}/modules") else []
led = {}
if mods:
    out = subprocess.run(["node", "platform/ledger/ledger.js", *[f"modules/{m}" for m in mods]],
                         cwd=RW, capture_output=True, text=True)
    if out.returncode == 0:
        led = json.loads(out.stdout).get("modules", {})

IMP_NAMED = re.compile(r"import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['\"]#modules/([a-z0-9-]+)/")
IMP_NS = re.compile(r"import\s*\*\s*as\s+\w+\s*from\s*['\"]#modules/([a-z0-9-]+)/")

def closure(mod, names):
    defs = led.get(mod, {}).get("definitions", {})
    if not defs: return None
    if names is None:  # namespace import: whole module
        items = sorted(f"{n}:{v['closureHash']}" for n, v in defs.items())
    else:
        missing = [n for n in names if n not in defs]
        if missing: return None
        items = sorted(f"{n}:{defs[n]['closureHash']}" for n in names)
    return hashlib.sha256("\n".join(items).encode()).hexdigest()

rows = []
for m in mods:
    for t in sorted(glob.glob(f"{RW}/modules/{m}/test/**/*.test.ts", recursive=True)):
        rel = os.path.relpath(t, RW)
        src = open(t).read()
        names, ns, external = set(), False, False
        for im in IMP_NAMED.finditer(src):
            mod = im.group(2)
            got = {n.strip().split(" as ")[0] for n in im.group(1).split(",") if n.strip()}
            if mod == m: names |= got
            else: external = True
        for im in IMP_NS.finditer(src):
            if im.group(1) == m: ns = True
            else: external = True
        # cross-module imports fold into the pair via those defs' own
        # closure hashes only if they flow through own-module defs; a
        # DIRECT dep import pairs with the dep module too
        cl = None
        if ns or not names:
            cl = closure(m, None)
        else:
            cl = closure(m, names)
        if cl is not None and external:
            # widen: fold every directly-imported foreign module's
            # closure so a dep change re-pairs this test
            parts = [cl]
            for im in IMP_NAMED.finditer(src):
                if im.group(2) != m:
                    c2 = closure(im.group(2), {n.strip().split(" as ")[0] for n in im.group(1).split(",") if n.strip()})
                    if c2 is None: cl = None; break
                    parts.append(c2)
            for im in IMP_NS.finditer(src):
                if im.group(1) != m:
                    c2 = closure(im.group(1), None)
                    if c2 is None: cl = None; break
                    parts.append(c2)
            if cl is not None:
                cl = hashlib.sha256("\n".join(sorted(parts)).encode()).hexdigest()
        th = hashlib.sha256(open(t, "rb").read()).hexdigest()
        rows.append({"test": rel, "testHash": th, "module": m, "closure": cl})
print(json.dumps(rows))
