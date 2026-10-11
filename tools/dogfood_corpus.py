"""Helpers for tools/dogfood_corpus.sh. Everything that touches poem content happens here, in-process.

Nothing this prints may contain poem text or a title: only indices (P01..), counts and verdicts. Words
used by the leak checks are chosen here and searched for here, so they never reach argv or a terminal.

    census    <converted-dir>               tags and attributes across every conversion; fails on any the
                                            editor's schema does not keep
    manifest  <converted-dir> <work-dir>    write manifest.json, index.tsv and the control files
    probe     <work-dir> <repo-dir>         BEFORE the run: choose a probe word absent from the repo
    leaks     <work-dir> <log-file> <log-size-before> <marker> <repo-dir> [<repo-dir> ...]
    summary   <work-dir>                    every manifest case must have exactly one result row
"""

import json
import os
import re
import sys

# The editor's schema is StarterKit with lists, blockquote, code, heading, rule and strike off, and no
# underline or link: it keeps these elements and nothing else (src/renderer/.../extensions).
KEPT = {"p", "br", "strong", "b", "em", "i"}
MARK = re.compile(r"<(strong|em|b|i)>(.*?)</\1>", re.S)
TAG = re.compile(r"<\s*([A-Za-z][A-Za-z0-9-]*)([^>]*)>")
ATTR = re.compile(r"([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=")


HEADER = "midstVersion: 1"  # what the app writes (src/main/util.ts includeVersionInfo)


def load(path: str) -> tuple[str, dict]:
    """A .midst with or without its version line. The converter's output has none; the app's files do."""
    raw = open(path, encoding="utf-8").read()
    if raw.startswith("midstVersion:"):
        header, body = raw.split("\n", 1)
        return header, json.loads(body)
    return HEADER, json.loads(raw)


def dump(path: str, header: str, doc: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(header + "\n" + json.dumps(doc, ensure_ascii=False, separators=(",", ":")))


def flip_one_letter(html: str) -> str | None:
    """Change the case of one letter that is outside every tag."""
    depth = 0
    for i, ch in enumerate(html):
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth -= 1
        elif depth == 0 and ch.isalpha() and ch.swapcase() != ch:
            return html[:i] + ch.swapcase() + html[i + 1 :]
    return None


def census(converted: str) -> int:
    """Tag and attribute names across every conversion. Names are not poem text; values are never read."""
    tags, attrs, poems_with = {}, {}, {}
    files = sorted(f for f in os.listdir(converted) if f.endswith(".converted.midst"))
    for f in files:
        _, doc = load(os.path.join(converted, f))
        seen = set()
        for m in TAG.finditer(doc["text"]):
            t = m.group(1).lower()
            tags[t] = tags.get(t, 0) + 1
            seen.add(t)
            for a in ATTR.findall(m.group(2)):
                attrs[a.lower()] = attrs.get(a.lower(), 0) + 1
                seen.add("@" + a.lower())
        for k in seen:
            poems_with[k] = poems_with.get(k, 0) + 1
    print("census, elements: " + ", ".join(f"{t} x{n} ({poems_with[t]} poems)" for t, n in sorted(tags.items())))
    print("census, attributes: " + (", ".join(f"{a} x{n} ({poems_with['@' + a]} poems)" for a, n in sorted(attrs.items())) or "none"))
    outside = sorted(set(tags) - KEPT) + sorted("@" + a for a in attrs)
    if outside:
        print(f"census: OUTSIDE THE SCHEMA: {', '.join(outside)} (the editor drops these on load)")
        return 1
    print("census: every element is one the schema keeps")
    return 0


def manifest(converted: str, work: str) -> None:
    files = sorted(f for f in os.listdir(converted) if f.endswith(".converted.midst"))
    cases, rows = [], []
    feeds = os.path.join(work, "feeds")
    os.makedirs(feeds, exist_ok=True)
    for n, f in enumerate(files, 1):
        pid = f"P{n:02d}"
        # The converter writes bare JSON; the app opens only files carrying its version line, as it saves
        # them. So the app is given the conversion exactly as the app itself would have written it.
        header, doc = load(os.path.join(converted, f))
        p = os.path.join(feeds, f"{pid}.midst")
        dump(p, header, doc)
        cases.append({"id": pid, "feed": p, "expected": p, "mustFail": False})
        rows.append(f"{pid}\t{f[: -len('.converted.midst')]}")
    with open(os.path.join(work, "index.tsv"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(rows) + "\n")

    # Each control takes the first poem able to carry it, and is judged against that poem's unmutated
    # conversion. A control with no candidate is reported missing, never silently dropped.
    ctl_dir = os.path.join(work, "controls")
    os.makedirs(ctl_dir, exist_ok=True)
    loaded = [(c, *load(c["feed"])) for c in cases]

    def mutate_history(doc):
        h = [dict(e) for e in doc["history"]]
        h[len(h) // 2]["t"] = "1970-01-01T00:00:00.000Z"  # content changed, count unchanged
        return dict(doc, history=h)

    specs = {
        "C-text": (lambda d: flip_one_letter(d["text"]) is not None, lambda d: dict(d, text=flip_one_letter(d["text"]))),
        "C-mark": (lambda d: MARK.search(d["text"]) is not None, lambda d: dict(d, text=MARK.sub(lambda m: m.group(2), d["text"], count=1))),
        "C-merge": (lambda d: "</p><p>" in d["text"], lambda d: dict(d, text=d["text"].replace("</p><p>", "", 1))),
        "C-history": (lambda d: len(d["history"]) >= 2, mutate_history),
        # Self-judged (feed == expected): an element the schema does not keep. text and struct cannot
        # see it, because the expectation loses it the same way; raw/html must (silas-397300f6).
        "C-unsupported": (lambda d: "</p>" in d["text"], lambda d: dict(d, text=d["text"].replace("</p>", "<u>.</u></p>", 1))),
    }
    made, missing = [], []
    for cid, (eligible, mutate) in specs.items():
        hit = next(((c, h, d) for c, h, d in loaded if eligible(d)), None)
        if not hit:
            missing.append(cid)
            continue
        c, header, doc = hit
        out = os.path.join(ctl_dir, f"{cid}.midst")
        dump(out, header, mutate(doc))
        expected = out if cid == "C-unsupported" else c["feed"]
        cases.append({"id": cid, "feed": out, "expected": expected, "mustFail": True})
        made.append(f"{cid}<-{c['id']}")
    richest = max(loaded, key=lambda x: len(x[2]["text"]))[0] if loaded else None
    if richest:
        with open(os.path.join(work, "control_source.txt"), "w") as fh:
            fh.write(richest["feed"])
    m = {"work": os.path.join(work, "cases"), "results": os.path.join(work, "results.jsonl"), "cases": cases}
    os.makedirs(m["work"], exist_ok=True)
    with open(os.path.join(work, "manifest.json"), "w") as fh:
        json.dump(m, fh)
    print(f"poems: {len(files)}   controls: {', '.join(made) or 'none'}"
          + (f"   MISSING: {', '.join(missing)}" if missing else ""))
    return 1 if missing else 0


def repo_files(repo: str):
    skip = ("/node_modules/", "/.git/", "/release/")
    return [p for p in files_under(repo) if not any(k in p for k in skip)]


def probe(work: str, repo: str) -> int:
    """Choose a word from the control poem that appears nowhere in the repository yet."""
    src = open(os.path.join(work, "control_source.txt")).read().strip()
    _, doc = load(src)
    words = sorted(set(re.findall(r"[A-Za-z]{4,}", re.sub(r"<[^>]+>", " ", doc["text"]))), key=len, reverse=True)
    corpus = b"".join(open(p, "rb").read() for p in repo_files(repo) if os.path.getsize(p) < 5_000_000)
    for w in words:
        if w.encode() not in corpus:
            with open(os.path.join(work, "probe.bin"), "wb") as fh:
                fh.write(w.encode())
            print("probe word: chosen (absent from the repository before the run)")
            return 0
    print("probe word: UNAVAILABLE (every candidate already occurs in the repository)")
    return 1


def files_under(root: str):
    for d, _, fs in os.walk(root):
        for f in fs:
            yield os.path.join(d, f)


def contains(path: str, needle: bytes) -> bool:
    try:
        with open(path, "rb") as fh:
            return needle in fh.read()
    except OSError:
        return False


# Paths the app or the run may legitimately touch outside the work dir. Anything else modified during the
# run under ~/Library or $TMPDIR is reported, whether or not it holds text (silas-397300f6).
ALLOWED = (
    "/Library/Logs/midst/main.log",  # truncated back to its size before the run
    "/Library/Caches/ms-playwright",
)


def leaks(work: str, log_file: str, size_before: str, marker: str, *repos: str) -> int:
    bad = 0
    work = os.path.realpath(work)  # $TMPDIR ends in '/', so mktemp's path carries '//'
    probe = open(os.path.join(work, "probe.bin"), "rb").read()
    inside = sum(contains(p, probe) for p in files_under(work))
    print(f"leak check, positive control: probe found in {inside} file(s) inside the work dir "
          f"({'search works' if inside else 'SEARCH IS BLIND'})")
    bad += inside == 0
    for repo in repos:
        hits = [p for p in repo_files(repo) if contains(p, probe)]
        print(f"leak check, {os.path.basename(repo)}: {len(hits)} file(s)" + "".join(f"\n    {p}" for p in hits))
        bad += len(hits)
    size = os.path.getsize(log_file) if os.path.exists(log_file) else 0
    appended = b""
    if size > int(size_before):
        with open(log_file, "rb") as fh:
            fh.seek(int(size_before))
            appended = fh.read()
    named = work.encode() in appended or probe in appended
    print(f"leak check, ~/Library/Logs/midst: {len(appended)} byte(s) appended, "
          f"{'NAMES THE RUN' if named else 'nothing from the run'}")
    bad += named
    # Anything modified since the marker, outside the work dir, that came from Midst or Electron.
    since = os.path.getmtime(marker)
    # Positive control: a file this walk must find, outside the work dir, modified after the marker.
    ctl = os.path.join(os.environ.get("TMPDIR", "/tmp"), f"midst-leak-control-{os.getpid()}")
    open(ctl, "w").close()
    roots = [os.path.expanduser("~/Library"), os.environ.get("TMPDIR", "/tmp")]
    touched = []
    for root in roots:
        for d, dirs, fs in os.walk(root):
            if os.path.realpath(d).startswith(work):
                dirs[:] = []
                continue
            for f in fs:
                p = os.path.join(d, f)
                try:
                    if os.path.getmtime(p) > since and re.search(r"(?i)midst|electron", p):
                        touched.append(p)
                except OSError:
                    pass
    os.remove(ctl)
    found = any(os.path.realpath(p) == os.path.realpath(ctl) for p in touched)
    touched = [p for p in touched if os.path.realpath(p) != os.path.realpath(ctl)]
    print(f"leak check, modified-files walk, positive control: {'found' if found else 'NOT FOUND, THE WALK IS BLIND'}")
    bad += not found
    unexpected = [p for p in touched if not any(a in p for a in ALLOWED)]
    print(f"leak check, files modified outside the work dir by Midst/Electron: {len(touched)}, "
          f"unexpected {len(unexpected)}" + "".join(f"\n    {p}" for p in unexpected))
    bad += len(unexpected)
    return 1 if bad else 0


def summary(work: str) -> int:
    path = os.path.join(work, "results.jsonl")
    rows = [json.loads(line) for line in open(path)] if os.path.exists(path) else []
    ids = [c["id"] for c in json.load(open(os.path.join(work, "manifest.json")))["cases"]]
    counts = {i: sum(1 for r in rows if r.get("id") == i) for i in ids}
    absent = [i for i, n in counts.items() if n != 1]
    keys = ["opens", "text", "raw", "html", "structure", "history", "storeHistory", "unchangedAfterSettle", "unchangedAfterClose"]
    short = ["open", "text", "raw", "html", "struct", "hist", "store", "settle", "close"]
    print(f"{'id':13} {'frames':>7}  " + " ".join(f"{s:>6}" for s in short) + "   verdict")
    good = 0
    for r in rows:
        marks = " ".join(f"{'ok' if r.get(k) is True else 'RED':>6}" for k in keys)
        expected_fail = r.get("mustFail")
        ok = (r.get("pass") is True) != bool(expected_fail)
        good += ok
        what = ("control fired" if ok else "CONTROL DID NOT FIRE") if expected_fail else ("PASS" if ok else "FAIL")
        print(f"{r['id']:13} {r.get('frames', '?'):>7}  {marks}   {what}")
    for i in absent:
        print(f"{i:13} {'':>7}  {'NO RESULT ROW' if counts[i] == 0 else f'{counts[i]} RESULT ROWS':>40}   FAIL")
    print(f"\n{good} of {len(ids)} cases as expected" + (f"   ({len(absent)} without exactly one result row)" if absent else ""))
    return 0 if ids and good == len(ids) and not absent else 1


if __name__ == "__main__":
    cmd, *a = sys.argv[1:]
    if cmd == "census":
        sys.exit(census(*a))
    elif cmd == "manifest":
        sys.exit(manifest(*a))
    elif cmd == "probe":
        sys.exit(probe(*a))
    elif cmd == "leaks":
        sys.exit(leaks(*a))
    elif cmd == "summary":
        sys.exit(summary(*a))
    else:
        sys.exit(f"unknown command {cmd}")
