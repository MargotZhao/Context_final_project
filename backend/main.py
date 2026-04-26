"""FastAPI entry point — wires up clients and routes; loop logic lives in agent.py."""

from __future__ import annotations

import asyncio
import os
import uuid

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from supabase import Client, create_client

import agent

load_dotenv()

app = FastAPI(title="Claude Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://project-l5gn6.vercel.app",
        "https://project-l5gn6-98u1ku7hq-margotzhaos-projects.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Clients (created once at startup) ────────────────────────────────────────

_anthropic = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

_supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_KEY"],
)


# ── Request schema ────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str
    history: list[dict[str, str]] = []


class FeedbackRequest(BaseModel):
    request_id: str
    rating: int  # 1 = thumbs up, -1 = thumbs down


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.post("/chat")
async def chat(req: ChatRequest):
    request_id = str(uuid.uuid4())
    stream = agent.run(
        anthropic_client=_anthropic,
        supabase=_supabase,
        message=req.message,
        history=req.history,
        request_id=request_id,
    )
    return StreamingResponse(stream, media_type="text/event-stream")


@app.post("/feedback")
async def feedback(req: FeedbackRequest):
    if req.rating not in (1, -1):
        raise HTTPException(status_code=400, detail="rating must be 1 or -1")
    await asyncio.to_thread(
        lambda: _supabase.table("feedback")
        .insert({"request_id": req.request_id, "rating": req.rating})
        .execute()
    )
    return {"ok": True}


@app.get("/metrics")
async def metrics():
    chat_rows, feedback_rows = await asyncio.gather(
        asyncio.to_thread(
            lambda: _supabase.table("chat_logs")
            .select("duration_ms, tool_calls")
            .execute()
        ),
        asyncio.to_thread(
            lambda: _supabase.table("feedback").select("rating").execute()
        ),
    )

    data = chat_rows.data
    total = len(data)
    if total == 0:
        return {
            "total_requests": 0,
            "tool_invocation_rate": 0.0,
            "avg_latency_ms": None,
            "total_ratings": 0,
            "satisfaction_rate": None,
        }

    with_tools = sum(
        1 for r in data if r.get("tool_calls") and len(r["tool_calls"]) > 0
    )
    latencies = [r["duration_ms"] for r in data if r.get("duration_ms") is not None]

    ratings = feedback_rows.data
    total_ratings = len(ratings)
    positive = sum(1 for r in ratings if r["rating"] == 1)

    return {
        "total_requests": total,
        "tool_invocation_rate": round(with_tools / total, 4),
        "avg_latency_ms": round(sum(latencies) / len(latencies)) if latencies else None,
        "total_ratings": total_ratings,
        "satisfaction_rate": round(positive / total_ratings, 4) if total_ratings > 0 else None,
    }


@app.get("/health")
def health():
    return {"status": "ok"}
