"""Shared upstream clients: env loading, VSS backend (via SOCKS), Cosmos Reason/Embed, W&B LLM."""

from __future__ import annotations

import base64
import json
import os
import re
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")

# VSS_SOCKS_PROXY=none (or empty) when running inside the VAST network, e.g. on the team VM
_socks = os.environ.get("VSS_SOCKS_PROXY", "socks5://127.0.0.1:1080")
SOCKS = _socks if _socks.strip().lower() not in ("", "none", "direct") else None
INGRESS_URL = os.environ.get("INGRESS_URL", "").rstrip("/")
GPU_TOKEN = os.environ.get("GPU_BEARER_TOKEN", "")
REASON_URL = os.environ.get("COSMOS_REASON_URL", "http://166.19.38.112:8001/v1")
REASON_MODEL = os.environ.get("COSMOS_REASON_MODEL", "nvidia/cosmos3-nano-reasoner")
EMBED_URL = os.environ.get("COSMOS_EMBED_URL", "http://166.19.38.112:8003/v1")
EMBED_MODEL = os.environ.get("COSMOS_EMBED_MODEL", "nvidia/cosmos-embed1")
WANDB_URL = "https://api.inference.wandb.ai/v1"
WANDB_PROJECT = os.environ.get("WANDB_INFERENCE_PROJECT", "vastdata/team-39")
LLM_MODEL = os.environ.get("UNDERSTUDY_LLM", "meta-llama/Llama-3.3-70B-Instruct")


# ---------------------------------------------------------------- VSS backend


class VSS:
    """Tiny VSS backend client. Private host, so traffic goes through the SOCKS tunnel."""

    def __init__(self, timeout: float = 60):
        self.client = httpx.Client(base_url=INGRESS_URL, proxy=SOCKS, timeout=timeout)
        self.token: str | None = None

    def login(self) -> str:
        r = self.client.post(
            "/api/v1/auth/login",
            json={"username": os.environ["VSS_USERNAME"], "password": os.environ["VSS_PASSWORD"]},
        )
        r.raise_for_status()
        self.token = r.json()["access_token"]
        return self.token

    def _headers(self) -> dict:
        if not self.token:
            self.login()
        return {"Authorization": f"Bearer {self.token}"}

    def request(self, method: str, path: str, **kw) -> httpx.Response:
        r = self.client.request(method, path, headers=self._headers(), **kw)
        if r.status_code == 401:
            self.login()
            r = self.client.request(method, path, headers=self._headers(), **kw)
        return r

    def get(self, path: str, **params) -> dict:
        r = self.request("GET", path, params=params)
        r.raise_for_status()
        return r.json()

    def stream_url(self, source: str) -> str:
        return f"{INGRESS_URL}/api/v1/videos/stream?source={source}&token={self.token}"


# ---------------------------------------------------------------- Cosmos


def _gpu_headers() -> dict:
    return {"Authorization": f"Bearer {GPU_TOKEN}"}


def jpeg_data_url(jpeg: bytes) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()


# ---------------------------------------------------------------- live step perception (Gemini)
# Benchmarked on 61 hand-labelled frames from our takes and live runs (2.10): Gemini 3.6 Flash (minimal
# thinking, ~1.2 s) read 92% of cup stages and 99% of cap fields right; Cosmos nano 49% and 78%.
# 3.8 Flash is a little better on cups but ~2 s. Unset key = Cosmos.
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
VISION_MODEL = os.environ.get("UNDERSTUDY_VISION_MODEL", "gemini-3.6-flash")
VISION_THINKING = os.environ.get("UNDERSTUDY_VISION_THINKING", "minimal")  # 3.7+ Flash: "low" at least


async def vision(client: httpx.AsyncClient, prompt: str, image: bytes, system: str, timeout: float = 5) -> str:
    gc = {"temperature": 0, "responseMimeType": "application/json", "maxOutputTokens": 1500,
          "thinkingConfig": {"thinkingLevel": VISION_THINKING}}
    r = await client.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{VISION_MODEL}:generateContent",
        headers={"x-goog-api-key": GEMINI_KEY},
        json={
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [
                {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(image).decode()}},
                {"text": prompt},
            ]}],
            "generationConfig": gc,
        },
        timeout=timeout,
    )
    r.raise_for_status()
    parts = r.json()["candidates"][0]["content"]["parts"]
    return "".join(p.get("text", "") for p in parts if not p.get("thought"))


async def reason(
    client: httpx.AsyncClient,
    prompt: str,
    images: list[bytes],
    max_tokens: int = 300,
    system: str | None = None,
) -> str:
    content = [{"type": "image_url", "image_url": {"url": jpeg_data_url(b)}} for b in images]
    content.append({"type": "text", "text": prompt})
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": content})
    r = await client.post(
        f"{REASON_URL}/chat/completions",
        headers=_gpu_headers(),
        json={"model": REASON_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": 0},
        timeout=30,
    )
    r.raise_for_status()
    msg = r.json()["choices"][0]["message"]
    return msg.get("content") or msg.get("reasoning_content") or ""


def embed_sync(client: httpx.Client, inputs: list[str], request_type: str = "query") -> list[list[float]]:
    """inputs: plain text, or data URLs (image/video). Returns 256-d vectors."""
    r = client.post(
        f"{EMBED_URL}/embeddings",
        headers=_gpu_headers(),
        json={"input": inputs, "model": EMBED_MODEL, "request_type": request_type, "encoding_format": "float"},
        timeout=120,
    )
    r.raise_for_status()
    data = sorted(r.json()["data"], key=lambda d: d.get("index", 0))
    return [d["embedding"] for d in data]


async def embed(client: httpx.AsyncClient, inputs: list[str], request_type: str = "query") -> list[list[float]]:
    r = await client.post(
        f"{EMBED_URL}/embeddings",
        headers=_gpu_headers(),
        json={"input": inputs, "model": EMBED_MODEL, "request_type": request_type, "encoding_format": "float"},
        timeout=60,
    )
    r.raise_for_status()
    data = sorted(r.json()["data"], key=lambda d: d.get("index", 0))
    return [d["embedding"] for d in data]


# ---------------------------------------------------------------- W&B LLM


def wandb_client():
    from openai import OpenAI

    return OpenAI(
        base_url=WANDB_URL,
        api_key=os.environ["WANDB_API_KEY"],
        default_headers={"OpenAI-Project": WANDB_PROJECT},
        timeout=60,
    )


def llm(prompt: str, system: str = "You are a concise assistant.", max_tokens: int = 400, client=None, temperature: float = 0.2) -> str:
    c = client or wandb_client()
    r = c.chat.completions.create(
        model=LLM_MODEL,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        temperature=temperature,
    )
    return r.choices[0].message.content or ""


# ---------------------------------------------------------------- parsing


def parse_json(text: str) -> dict | list | None:
    """Pull the first JSON object/array out of model output (handles ```json fences, <think> blocks)."""
    if not text:
        return None
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = re.sub(r"```(?:json)?", "", text)
    pairs = [("{", "}"), ("[", "]")]
    pairs.sort(key=lambda p: text.find(p[0]) if text.find(p[0]) != -1 else 1 << 30)
    for opener, closer in pairs:
        start = text.find(opener)
        while start != -1:
            depth = 0
            for i in range(start, len(text)):
                if text[i] == opener:
                    depth += 1
                elif text[i] == closer:
                    depth -= 1
                    if depth == 0:
                        try:
                            return json.loads(text[start : i + 1])
                        except json.JSONDecodeError:
                            break
            start = text.find(opener, start + 1)
    return None


class Timer:
    def __enter__(self):
        self.t0 = time.perf_counter()
        return self

    def __exit__(self, *a):
        self.ms = int((time.perf_counter() - self.t0) * 1000)
