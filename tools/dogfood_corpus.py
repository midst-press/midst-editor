"""Helpers for tools/dogfood_corpus.sh. Everything that touches poem content happens here, in-process.

Nothing this prints may contain poem text or a title: only indices (P01..), counts and verdicts. Words
used by the leak checks are chosen here and searched for here, so they never reach argv or a terminal.

    manifest  <converted-dir> <work-dir>    write manifest.json, index.tsv and the control files
    probe     <work-dir> <repo-dir>         BEFORE the run: choose a probe word absent from the repo
    leaks     <work-dir> <repo-dir> <log-file> <log-size-before>
    summary   <work-dir>
"""

import json
import os
import re
import sys

MARK = re.compile(r"<(strong|em|b|i|s|u)>(.*?)</\1>", re.S)


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
        cases.append({"id": cid, "feed": out, "expected": c["feed"], "mustFail": True})
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


def leaks(work: str, repo: str, log_file: str, size_before: str) -> int:
    bad = 0
    probe = open(os.path.join(work, "probe.bin"), "rb").read()
    inside = sum(contains(p, probe) for p in files_under(work))
    print(f"leak check, positive control: probe found in {inside} file(s) inside the work dir "
          f"({'search works' if inside else 'SEARCH IS BLIND'})")
    bad += inside == 0
    # The repo: anything the run left behind there (test-results/, playwright-report/, stray files).
    repo_hits = [p for p in repo_files(repo) if contains(p, probe)]
    print(f"leak check, repository: {len(repo_hits)} file(s)" + "".join(f"\n    {p}" for p in repo_hits))
    bad += len(repo_hits)
    # The app's persistent log: anything appended during the run that names the work dir.
    size = os.path.getsize(log_file) if os.path.exists(log_file) else 0
    appended = b""
    if size > int(size_before):
        with open(log_file, "rb") as fh:
            fh.seek(int(size_before))
            appended = fh.read()
    named = work.encode() in appended or probe in appended
    print(f"leak check, ~/Library/Logs: {len(appended)} byte(s) appended, "
          f"{'NAMES THE RUN' if named else 'nothing from the run'}")
    bad += named
    return 1 if bad else 0


def summary(work: str) -> int:
    path = os.path.join(work, "results.jsonl")
    rows = [json.loads(line) for line in open(path)] if os.path.exists(path) else []
    keys = ["opens", "text", "structure", "history", "storeHistory", "unchangedAfterSettle", "unchangedAfterClose"]
    short = ["open", "text", "struct", "hist", "store", "settle", "close"]
    print(f"{'id':10} {'frames':>7}  " + " ".join(f"{s:>6}" for s in short) + "   verdict")
    good = 0
    for r in rows:
        marks = " ".join(f"{'ok' if r.get(k) is True else 'RED':>6}" for k in keys)
        expected_fail = r.get("mustFail")
        ok = (r.get("pass") is True) != bool(expected_fail)
        good += ok
        what = ("control fired" if ok else "CONTROL DID NOT FIRE") if expected_fail else ("PASS" if ok else "FAIL")
        print(f"{r['id']:10} {r.get('frames', '?'):>7}  {marks}   {what}")
    print(f"\n{good} of {len(rows)} as expected")
    return 0 if rows and good == len(rows) else 1


if __name__ == "__main__":
    cmd, *a = sys.argv[1:]
    if cmd == "manifest":
        manifest(*a)
    elif cmd == "probe":
        sys.exit(probe(*a))
    elif cmd == "leaks":
        sys.exit(leaks(*a))
    elif cmd == "summary":
        sys.exit(summary(*a))
    else:
        sys.exit(f"unknown command {cmd}")
