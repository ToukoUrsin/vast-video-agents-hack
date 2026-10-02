"""Pre-render every fixed coach line to audio (ElevenLabs), so the coach doesn't sound robotic.

Lines = what web/src/coach/machine.ts can say (web/scripts/voice-lines.ts, from the task data)
+ every fixed correction /api/check-step can return (from app.py). Writes web/public/voice/*.mp3
and web/public/voice/manifest.json {lines: {exact text: url}}. The web player falls back to
speechSynthesis for any text not in the manifest. Only renders lines that are missing.

  hsec exec --only ELEVENLABS_API_KEY -- uv run render_voice.py
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import httpx

os.environ.setdefault("UNDERSTUDY_WEAVE", "0")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "web" / "public" / "voice"
VOICE_ID = os.environ.get("UNDERSTUDY_VOICE", "EXAVITQu4vr4xnSDxMaL")  # Sarah: mature, reassuring
MODEL = "eleven_multilingual_v2"


def client_lines() -> list[str]:
    out = subprocess.run(["bun", "scripts/voice-lines.ts"], cwd=ROOT / "web", capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def server_lines() -> list[str]:
    sys.path.insert(0, str(HERE))
    from app import TASK_DEFS  # noqa: E402

    src = (HERE / "app.py").read_text()
    fixed = re.findall(r'^\s*issue = "([^"]+)"', src, re.M)
    skipped = [f"You skipped a step. {st} first." for d in TASK_DEFS.values() for st in d["steps"]]
    return fixed + skipped


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    lines = list(dict.fromkeys(client_lines() + server_lines()))
    mpath = OUT / "manifest.json"
    manifest = json.loads(mpath.read_text()) if mpath.exists() else {}
    have = manifest.get("lines", {}) if manifest.get("voice_id") == VOICE_ID else {}
    key = os.environ["ELEVENLABS_API_KEY"]
    res = {}
    with httpx.Client(timeout=60) as c:
        for text in lines:
            name = hashlib.sha1(f"{VOICE_ID}|{text}".encode()).hexdigest()[:12] + ".mp3"
            url = f"/voice/{name}"
            if have.get(text) == url and (OUT / name).exists():
                res[text] = url
                continue
            r = c.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}?output_format=mp3_44100_128",
                headers={"xi-api-key": key},
                json={
                    "text": text,
                    "model_id": MODEL,
                    "voice_settings": {"stability": 0.55, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True},
                },
            )
            r.raise_for_status()
            (OUT / name).write_bytes(r.content)
            res[text] = url
            print(f"rendered {name}  {text}")
    for f in OUT.glob("*.mp3"):  # drop stale renders
        if f"/voice/{f.name}" not in res.values():
            f.unlink()
    mpath.write_text(json.dumps({"voice": "ElevenLabs Sarah", "voice_id": VOICE_ID, "model": MODEL, "lines": res}, indent=1, ensure_ascii=False))
    print(f"{len(res)} lines -> {mpath}")


if __name__ == "__main__":
    main()
