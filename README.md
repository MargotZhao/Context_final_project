# Claude Agent App

A full-stack agentic chat application built on Claude. The backend runs an agentic loop with web search and calculator tools; the frontend streams responses in real time and displays each tool call as it happens.

## Architecture

```
Browser (Next.js)
    │  POST /chat  {message, history}
    │  ← SSE stream (text, tool_use, tool_result, done)
    ▼
FastAPI backend
    │  Anthropic Messages API  (claude-opus-4-7)
    │  ┌─ web_search  ──────────────────── server-side (Anthropic runs it)
    │  └─ calculator  ──────────────────── client-side (backend evaluates it)
    │
    └─ Supabase (Postgres)
           ├─ chat_logs        — one row per request
           └─ tool_error_logs  — one row per failed tool call
```

**Request flow**

1. Frontend POSTs the message and conversation history to `/chat`.
2. Backend generates a `request_id` UUID and enters the agentic loop.
3. For each Claude response the loop streams SSE events to the browser: `text` chunks, `tool_use` (client-side tool called), `server_tool_use` (web search ran on Anthropic's side), and `tool_result` (client-side result or error).
4. Client-side tool failures are logged immediately to `tool_error_logs`; the full request summary is written to `chat_logs` when the loop ends.
5. The frontend renders tool calls as live cards above the assistant's text, updating from "running…" to success/failure as results arrive.

## Project structure

```
claude-agent-app/
├── backend/
│   ├── main.py           # FastAPI app, routes, client setup
│   ├── agent.py          # Agentic loop, tool execution, Supabase logging
│   ├── requirements.txt
│   ├── Procfile          # Render deployment
│   └── .env.example
├── frontend/
│   ├── app/
│   │   ├── page.tsx
│   │   └── layout.tsx
│   ├── components/
│   │   └── Chat.tsx      # SSE streaming, tool call cards
│   └── .env.example
└── supabase/
    └── schema.sql        # Table definitions, indexes, RLS
```

## Local setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- A [Supabase](https://supabase.com) project with the schema applied (see below)
- An [Anthropic API key](https://console.anthropic.com/settings/keys)

### 1. Apply the database schema

Open the Supabase SQL editor and run the contents of `supabase/schema.sql`. This creates `chat_logs` and `tool_error_logs` with indexes and RLS enabled.

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env        # then fill in values
uvicorn main:app --reload
```

The API is now running at `http://localhost:8000`.

### 3. Frontend

```bash
cd frontend
npm install

cp .env.example .env.local  # then fill in values
npm run dev
```

The UI is now at `http://localhost:3000`.

## Environment variables

### Backend (`backend/.env`)

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key — [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `SUPABASE_URL` | Project URL — Supabase dashboard → Settings → API |
| `SUPABASE_KEY` | **service_role** secret key (not the anon key) — same page |

> `SUPABASE_KEY` must be the `service_role` key so the backend can write to tables that have RLS enabled. Never expose this key in the browser.

### Frontend (`frontend/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL of the FastAPI backend (`http://localhost:8000` locally; your Render URL in production) |

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/chat` | Start an agentic chat turn. Body: `{message: string, history: [{role, content}]}`. Returns an SSE stream. |
| `GET` | `/metrics` | Aggregate stats: `total_requests`, `tool_invocation_rate`, `avg_latency_ms`. |
| `GET` | `/health` | Liveness check. Returns `{"status": "ok"}`. |

### SSE event types

Events arrive as `data: <JSON>\n\n`. The `type` field identifies each event:

| `type` | Payload | Notes |
|---|---|---|
| `text` | `content: string` | Incremental assistant text |
| `tool_use` | `tool, input` | Client-side tool about to run |
| `server_tool_use` | `tool, input` | Web search ran on Anthropic's side |
| `tool_result` | `tool, result, success` | Result of a client-side tool call |
| `error` | `content: string` | Unrecoverable loop error |
| `done` | — | Always the final event |

## Deploying

### Backend → Render

1. Create a new **Web Service** in Render, point it at this repo.
2. Set **Root Directory** to `backend`.
3. Set **Build Command** to `pip install -r requirements.txt`.
4. Leave **Start Command** blank — the `Procfile` is used automatically.
5. Add environment variables: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`.

### Frontend → Vercel

1. Import the repo in Vercel, set **Root Directory** to `frontend`.
2. Add environment variable: `NEXT_PUBLIC_API_URL` → your Render service URL.
3. Vercel auto-detects Next.js; no output directory override needed.
4. Add your Vercel domain to the CORS `allow_origins` list in `backend/main.py` and redeploy the backend.
