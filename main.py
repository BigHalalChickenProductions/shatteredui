import asyncio
import json
import os
import re
import ssl
import time
import urllib.request

import decky

SETTINGS_PATH = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
CACHE_DIR = decky.DECKY_PLUGIN_RUNTIME_DIR
CSS_CACHE = os.path.join(CACHE_DIR, "theme.css")
META_CACHE = os.path.join(CACHE_DIR, "theme_meta.json")
BUNDLED_CSS = os.path.join(decky.DECKY_PLUGIN_DIR, "defaults", "shattered.css")

MAX_BYTES = 512 * 1024
RAW_HOST = "https://raw.githubusercontent.com/"
REPO_RE = re.compile(r"^(?:https?://github\.com/)?([\w.-]+)/([\w.-]+?)(?:\.git)?/?$")
BRANCH_RE = re.compile(r"^[\w./-]{1,80}$")
FILE_RE = re.compile(r"^[\w.-]{1,80}\.css$")
URL_RE = re.compile(r"url\(\s*['\"]?([^'\")]+)", re.I)

DEFAULTS = {
    "enabled": True,
    "repo": "https://github.com/BigHalalChickenProductions/shatteredui",
    "branch": "main",
    "auto_update": True,
    "square_capsules": True,
    "ps5_home": True,
    "radius": 14,
    "tile": 190,
    "last_check": 0,
}


def _load_settings():
    s = dict(DEFAULTS)
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            s.update({k: v for k, v in json.load(f).items() if k in DEFAULTS})
    except Exception:
        pass
    return s


def _save_settings(s):
    os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(s, f)


def _load_meta():
    try:
        with open(META_CACHE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _atomic_write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def _http_get(url, timeout=15):
    if not url.startswith(RAW_HOST):
        raise ValueError("Only raw.githubusercontent.com is allowed")
    last = None
    for cafile in (None, "/etc/ssl/certs/ca-certificates.crt"):
        if cafile and not os.path.exists(cafile):
            continue
        try:
            ctx = ssl.create_default_context(cafile=cafile)
            req = urllib.request.Request(url, headers={"User-Agent": "ShatteredUI-Decky"})
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                data = r.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise ValueError("File too large")
            return data
        except Exception as e:  # try next CA bundle, keep last error
            last = e
    raise last if last else RuntimeError("Request failed")


def _check_css(text, name):
    low = text.lower()
    if "@import" in low or "javascript:" in low or "expression(" in low:
        raise ValueError(f"{name}: forbidden construct")
    for u in URL_RE.findall(text):
        u = u.strip()
        if not (u.startswith("data:") or u.startswith(RAW_HOST) or u.startswith("#")):
            raise ValueError(f"{name}: url() not allowed: {u[:60]}")


def _base_url(s):
    m = REPO_RE.match(s["repo"].strip())
    if not m:
        raise ValueError("Invalid repo")
    if not BRANCH_RE.match(s["branch"]):
        raise ValueError("Invalid branch")
    return f"{RAW_HOST}{m.group(1)}/{m.group(2)}/{s['branch']}/"


def _update(force):
    try:
        s = _load_settings()
        base = _base_url(s)
        manifest = json.loads(_http_get(base + "manifest.json").decode("utf-8"))
        version = str(manifest.get("version", "0"))
        files = manifest.get("css", ["shattered.css"])
        if not isinstance(files, list) or not files or not all(
            isinstance(f, str) and FILE_RE.match(f) for f in files
        ):
            raise ValueError("manifest.css must be a list of plain .css filenames")

        s["last_check"] = int(time.time())
        _save_settings(s)

        meta = _load_meta()
        if not force and meta.get("version") == version and os.path.exists(CSS_CACHE):
            return {"ok": True, "changed": False, "version": version}

        parts = []
        for f in files:
            txt = _http_get(base + f).decode("utf-8")
            _check_css(txt, f)
            parts.append(f"/* {f} */\n{txt}")
        _atomic_write(CSS_CACHE, "\n".join(parts))
        _atomic_write(META_CACHE, json.dumps({"version": version, "fetched": int(time.time())}))
        return {"ok": True, "changed": True, "version": version}
    except Exception as e:
        decky.logger.error(f"ShatteredUI update failed: {e}")
        return {"ok": False, "changed": False, "version": "", "error": str(e)}


class Plugin:
    async def _main(self):
        os.makedirs(CACHE_DIR, exist_ok=True)
        decky.logger.info("ShatteredUI loaded")

    async def _unload(self):
        decky.logger.info("ShatteredUI unloaded")

    async def get_settings(self):
        return _load_settings()

    async def set_settings(self, patch: dict):
        s = _load_settings()
        if isinstance(patch.get("repo"), str) and REPO_RE.match(patch["repo"].strip()):
            s["repo"] = patch["repo"].strip()
        if isinstance(patch.get("branch"), str) and BRANCH_RE.match(patch["branch"]):
            s["branch"] = patch["branch"]
        for k in ("enabled", "auto_update", "square_capsules", "ps5_home"):
            if isinstance(patch.get(k), bool):
                s[k] = patch[k]
        if isinstance(patch.get("radius"), (int, float)):
            s["radius"] = max(0, min(60, int(patch["radius"])))
        if isinstance(patch.get("tile"), (int, float)):
            s["tile"] = max(100, min(320, int(patch["tile"])))
        _save_settings(s)
        return s

    async def get_theme(self):
        meta = _load_meta()
        for path, source in ((CSS_CACHE, "repo"), (BUNDLED_CSS, "bundled")):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    css = f.read()
                return {"css": css, "version": meta.get("version", "bundled") if source == "repo" else "bundled", "source": source}
            except Exception:
                continue
        return {"css": "", "version": "none", "source": "none"}

    async def update_theme(self, force: bool = False):
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _update, bool(force))
