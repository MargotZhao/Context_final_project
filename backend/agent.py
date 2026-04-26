"""Agentic loop with per-tool error handling and immediate Supabase logging."""

from __future__ import annotations

import asyncio
import json
import math
import time
from typing import Any, AsyncGenerator

import anthropic
from supabase import Client

# ── Tool definitions ──────────────────────────────────────────────────────────

TOOLS: list[dict[str, Any]] = [
    # Server-side — Anthropic executes web searches automatically.
    {
        "type": "web_search_20260209",
        "name": "web_search",
    },
    # Client-side — we execute this and return results in the loop.
    {
        "name": "calculator",
        "description": (
            "Evaluate a mathematical expression using Python's math module. "
            "Supports arithmetic, sqrt, sin, cos, log, pi, e, and more."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "Expression to evaluate, e.g. 'sqrt(2) * pi' or '2 ** 32'.",
                }
            },
            "required": ["expression"],
        },
    },
]

# ── Math namespace ────────────────────────────────────────────────────────────

_MATH_NS: dict[str, Any] = {
    k: v for k, v in math.__dict__.items() if not k.startswith("_")
}
_MATH_NS.update({"abs": abs, "round": round, "int": int, "float": float})

# ── SSE helper ────────────────────────────────────────────────────────────────


def _sse(payload: dict[str, Any]) -> str:
    return "data: " + json.dumps(payload, default=str) + "\n\n"


# ── Calculator ────────────────────────────────────────────────────────────────


def _calculate(expression: str) -> str:
    """Evaluate a math expression.

    Raises ValueError so callers can distinguish a tool failure from a
    successful (but possibly unexpected) result.
    """
    try:
        result = eval(expression, {"__builtins__": {}}, _MATH_NS)  # noqa: S307
        return str(result)
    except Exception as exc:
        raise ValueError(f"Cannot evaluate '{expression}': {exc}") from exc


# ── Supabase helpers ──────────────────────────────────────────────────────────


async def _log_tool_error(
    supabase: Client,
    *,
    request_id: str,
    tool_name: str,
    tool_input: dict[str, Any],
    error: str,
    duration_ms: int,
) -> None:
    """Write a tool failure record immediately, in a background thread."""
    await asyncio.to_thread(
        lambda: supabase.table("tool_error_logs")
        .insert(
            {
                "request_id": request_id,
                "tool_name": tool_name,
                "input": tool_input,
                "error": error,
                "duration_ms": duration_ms,
            }
        )
        .execute()
    )


async def _log_request(
    supabase: Client,
    data: dict[str, Any],
) -> None:
    """Write the end-of-request summary to chat_logs."""
    await asyncio.to_thread(
        lambda: supabase.table("chat_logs").insert(data).execute()
    )


# ── Tool executor ─────────────────────────────────────────────────────────────


async def _execute_tool(
    name: str,
    input_data: dict[str, Any],
    *,
    request_id: str,
    supabase: Client,
) -> tuple[str, bool]:
    """Run a client-side tool and return (result_string, success).

    On failure:
    - The exception is logged immediately to ``tool_error_logs`` in Supabase.
    - An error string is returned to Claude (with ``is_error=True``) so it
      can decide whether to retry or take a different approach.
    """
    t0 = time.monotonic()
    try:
        if name == "calculator":
            return _calculate(input_data.get("expression", "")), True
        raise NotImplementedError(f"No handler registered for tool '{name}'")

    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        error_msg = str(exc)

        try:
            await _log_tool_error(
                supabase,
                request_id=request_id,
                tool_name=name,
                tool_input=input_data,
                error=error_msg,
                duration_ms=duration_ms,
            )
        except Exception as log_exc:
            # Never let logging errors surface to the user.
            print(f"[supabase] tool-error log failed: {log_exc}")

        return f"Tool error: {error_msg}", False


# ── Public entry point ────────────────────────────────────────────────────────


async def run(
    *,
    anthropic_client: anthropic.AsyncAnthropic,
    supabase: Client,
    message: str,
    history: list[dict[str, str]],
    request_id: str,
) -> AsyncGenerator[str, None]:
    """Drive the agentic loop and yield SSE-encoded event strings.

    Yields these event types (all JSON under ``data:``):
      text            — incremental assistant text
      tool_use        — Claude is about to call a client-side tool
      tool_result     — result of that call (``success`` bool included)
      server_tool_use — informational: a server-side tool (web_search) ran
      error           — unrecoverable loop error
      done            — always the final event
    """
    t0 = time.monotonic()
    messages: list[dict[str, Any]] = list(history) + [
        {"role": "user", "content": message}
    ]

    full_text = ""
    tool_calls_log: list[dict[str, Any]] = []
    total_in = total_out = 0
    err: str | None = None

    try:
        while True:
            response = await anthropic_client.messages.create(
                model="claude-opus-4-7",
                max_tokens=4096,
                tools=TOOLS,
                messages=messages,
            )

            total_in += response.usage.input_tokens
            total_out += response.usage.output_tokens

            tool_results: list[dict[str, Any]] = []

            for block in response.content:
                btype = getattr(block, "type", "")

                if btype == "text":
                    full_text += block.text
                    yield _sse({"type": "text", "content": block.text})

                elif btype == "tool_use":
                    input_data: dict[str, Any] = dict(block.input) if block.input else {}
                    yield _sse({"type": "tool_use", "tool": block.name, "input": input_data})

                    result, success = await _execute_tool(
                        block.name,
                        input_data,
                        request_id=request_id,
                        supabase=supabase,
                    )

                    yield _sse(
                        {
                            "type": "tool_result",
                            "tool": block.name,
                            "result": result,
                            "success": success,
                        }
                    )

                    tool_calls_log.append(
                        {
                            "name": block.name,
                            "input": input_data,
                            "result": result,
                            "success": success,
                        }
                    )
                    tool_result_entry: dict[str, Any] = {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    }
                    if not success:
                        # Tell Claude the tool failed so it can adapt.
                        tool_result_entry["is_error"] = True
                    tool_results.append(tool_result_entry)

                elif btype == "server_tool_use":
                    # Server-side tool (web_search) ran automatically; display only.
                    try:
                        input_data = dict(getattr(block, "input", {}))
                    except Exception:
                        input_data = {}
                    yield _sse(
                        {"type": "server_tool_use", "tool": block.name, "input": input_data}
                    )
                    tool_calls_log.append({"name": block.name, "input": input_data, "success": True})

                # All other block types (thinking, server tool results) are skipped.

            # ── Loop control ──────────────────────────────────────────────────
            stop = response.stop_reason

            if stop == "end_turn":
                break

            if stop == "pause_turn":
                # Server-side tool hit its iteration limit; re-send to continue.
                # Do NOT add a new user turn — the API detects the trailing
                # server_tool_use block and resumes automatically.
                messages.append({"role": "assistant", "content": response.content})
                continue

            if stop == "tool_use":
                messages.append({"role": "assistant", "content": response.content})
                messages.append({"role": "user", "content": tool_results})
                continue

            # Unknown stop reason — break to prevent an infinite loop.
            break

    except Exception as exc:
        err = str(exc)
        yield _sse({"type": "error", "content": err})

    finally:
        duration_ms = int((time.monotonic() - t0) * 1000)
        try:
            await _log_request(
                supabase,
                {
                    "request_id": request_id,
                    "user_message": message,
                    "assistant_response": full_text,
                    "tool_calls": tool_calls_log,
                    "model": "claude-opus-4-7",
                    "input_tokens": total_in,
                    "output_tokens": total_out,
                    "duration_ms": duration_ms,
                    "error": err,
                },
            )
        except Exception as log_exc:
            print(f"[supabase] request log failed: {log_exc}")

        yield _sse({"type": "done", "request_id": request_id})
