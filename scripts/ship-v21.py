#!/usr/bin/env python3
"""v20 production ship: push changed files to GitHub, then trigger a Vercel
production deployment from the git source and poll until READY.

v20 = GSC owner-account pinning + wrong-account detection + Search Analytics
performance panel. Prefers the numeric repoId form learned in v19
(API requires it), falls back to the repo-slug form."""

import base64
import json
import sys
import time
import urllib.request

GH_TOKEN = json.load(open("/home/z/my-project/db/github-auth.json"))["token"]
with open("/home/z/my-project/db/vercel-auth.json") as f:
    _vc = json.load(f)
VC_TOKEN = _vc["token"] if isinstance(_vc, dict) else _vc[0]

REPO = "abbdelhadylh30-art/fleet-control"
REPO_ID = "1377741557"
BRANCH = "main"
BASE = "/home/z/my-project"

FILES = [
    "src/lib/gsc-types.ts",
    "src/lib/gsc-auth.ts",
    "src/lib/gsc.ts",
    "src/app/api/gsc/route.ts",
    "src/components/google-panel.tsx",
    "src/components/setup-guide.tsx",
    "src/components/gsc-performance.tsx",
    "src/app/integrations/page.tsx",
    "src/components/app-nav.tsx",
    "src/components/app-footer.tsx",
    "scripts/ship-v21.py",
    "worklog.md",
]


def api(url, method="GET", token=None, body=None, ctype="application/json"):
    req = urllib.request.Request(url, method=method)
    if token:
        req.add_header("authorization", f"Bearer {token}")
    if ctype:
        req.add_header("content-type", ctype)
    if url.startswith("https://api.github.com"):
        req.add_header("accept", "application/vnd.github+json")
        req.add_header("user-agent", "fleet-control-ship")
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("content-length", str(len(data)))
    with urllib.request.urlopen(req, data=data, timeout=60) as r:
        raw = r.read()
        return r.status, (json.loads(raw) if raw.strip() else {})


def gh_sha(path):
    try:
        _, d = api(f"https://api.github.com/repos/{REPO}/contents/{path}?ref={BRANCH}", token=GH_TOKEN)
        return d.get("sha")
    except Exception:
        return None


def gh_put(path, content_b64, sha, msg):
    body = {"message": msg, "content": content_b64, "branch": BRANCH}
    if sha:
        body["sha"] = sha
    return api(f"https://api.github.com/repos/{REPO}/contents/{path}", method="PUT", token=GH_TOKEN, body=body)


def trigger_deploy():
    # primary: numeric repoId + project name (the form that shipped v19)
    try:
        return api(
            "https://api.vercel.com/v13/deployments",
            method="POST",
            token=VC_TOKEN,
            body={
                "name": "fleet-control",
                "gitSource": {"type": "github", "repoId": REPO_ID, "ref": BRANCH},
                "target": "production",
            },
        )
    except urllib.error.HTTPError as e:
        print(f"repoId form failed ({e.code}) — falling back to repo slug", flush=True)
        return api(
            "https://api.vercel.com/v13/deployments",
            method="POST",
            token=VC_TOKEN,
            body={
                "name": "fleet-control",
                "gitSource": {"type": "github", "repo": REPO, "ref": BRANCH},
                "target": "production",
            },
        )


def main():
    # 1. push files
    for i, p in enumerate(FILES, 1):
        raw = open(f"{BASE}/{p}", "rb").read()
        b64 = base64.b64encode(raw).decode()
        sha = gh_sha(p)
        st, d = gh_put(p, b64, sha, f"v20: {p}")
        ok = st in (200, 201)
        print(f"[{i:2}/{len(FILES)}] {'OK ' if ok else 'FAIL'} {p} ({st})", flush=True)
        if not ok:
            print(json.dumps(d)[:300])
            sys.exit(1)
        time.sleep(1.2)

    # 2. trigger production deployment from git
    print("triggering vercel production deployment…", flush=True)
    st, d = trigger_deploy()
    if st not in (200, 201):
        print("deploy trigger failed:", st, json.dumps(d)[:400])
        sys.exit(1)
    dep_id = d.get("id") or d.get("deploymentId")
    print("deployment:", dep_id, d.get("readyState"), flush=True)

    # 3. poll
    for _ in range(90):
        time.sleep(10)
        _, s = api(f"https://api.vercel.com/v13/deployments/{dep_id}", token=VC_TOKEN)
        state = s.get("readyState")
        print("  …", state, flush=True)
        if state == "READY":
            print("READY:", s.get("url"))
            return
        if state in ("ERROR", "CANCELED"):
            print("FAILED:", json.dumps(s)[:600])
            sys.exit(1)
    print("timeout waiting for READY")
    sys.exit(1)


if __name__ == "__main__":
    main()
