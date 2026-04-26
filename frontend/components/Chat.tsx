"use client";

import { useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type ToolEventType = "tool_use" | "server_tool_use" | "tool_result";

interface ToolEvent {
  type: ToolEventType;
  tool: string;
  input?: Record<string, unknown>;
  result?: string;
  success?: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolEvents: ToolEvent[];
  isStreaming: boolean;
  requestId?: string;
  feedback?: "up" | "down";
}

// ── Tool utilities ────────────────────────────────────────────────────────────

function toolMeta(name: string): { icon: string; label: string } {
  switch (name) {
    case "web_search":
      return { icon: "🔍", label: "Web Search" };
    case "calculator":
      return { icon: "🧮", label: "Calculator" };
    default:
      return { icon: "🔧", label: name };
  }
}

function toolInputDetail(event: ToolEvent): string | undefined {
  if (!event.input) return undefined;
  if (event.tool === "web_search")
    return (event.input as { query?: string }).query;
  if (event.tool === "calculator")
    return (event.input as { expression?: string }).expression;
  return JSON.stringify(event.input);
}

// ── Tool call card ────────────────────────────────────────────────────────────

function ToolCallCard({ event }: { event: ToolEvent }) {
  const { icon, label } = toolMeta(event.tool);
  const inputDetail = toolInputDetail(event);
  const isServerSide = event.type === "server_tool_use";
  const isPending = !isServerSide && event.result === undefined;
  const failed = event.success === false;

  return (
    <div
      className={`rounded-lg border text-xs overflow-hidden ${
        failed
          ? "border-red-700/50 bg-red-950/25"
          : "border-gray-700/40 bg-gray-850/40"
      }`}
    >
      <div
        className={`flex items-center gap-2 px-3 py-2 border-b ${
          failed ? "border-red-800/30" : "border-gray-700/30"
        }`}
      >
        <span>{icon}</span>
        <span className="font-medium text-gray-200">{label}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {isServerSide && (
            <span className="text-[10px] text-gray-500 tracking-wide uppercase">
              server-side
            </span>
          )}
          {isPending && (
            <span className="flex items-center gap-1.5 text-gray-500">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse" />
              running…
            </span>
          )}
          {!isPending && !isServerSide && (
            <span className={`font-semibold ${failed ? "text-red-400" : "text-emerald-400"}`}>
              {failed ? "✗ failed" : "✓ ok"}
            </span>
          )}
        </div>
      </div>

      {inputDetail && (
        <div
          className={`px-3 py-1.5 font-mono truncate ${
            failed ? "border-b border-red-800/30" : "border-b border-gray-700/20"
          } text-gray-400`}
        >
          {inputDetail}
        </div>
      )}

      {event.result && (
        <div
          className={`px-3 py-1.5 font-mono whitespace-pre-wrap break-words ${
            failed ? "text-red-400" : "text-gray-300"
          }`}
        >
          {event.result}
        </div>
      )}
    </div>
  );
}

// ── Tool trace ────────────────────────────────────────────────────────────────

function ToolTrace({ events }: { events: ToolEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="mb-3 space-y-1.5">
      {events.map((ev, i) => (
        <ToolCallCard key={i} event={ev} />
      ))}
    </div>
  );
}

// ── Feedback buttons ──────────────────────────────────────────────────────────

function FeedbackBar({
  feedback,
  onFeedback,
}: {
  feedback?: "up" | "down";
  onFeedback: (rating: 1 | -1) => void;
}) {
  return (
    <div className="flex items-center gap-1 mt-2.5 pt-2.5 border-t border-gray-700/40">
      <span className="text-[11px] text-gray-500 mr-1">Helpful?</span>
      <button
        onClick={() => onFeedback(1)}
        disabled={feedback !== undefined}
        title="Helpful"
        className={`rounded px-2 py-0.5 text-sm transition-colors disabled:cursor-default ${
          feedback === "up"
            ? "text-emerald-400"
            : "text-gray-500 hover:text-gray-300 disabled:hover:text-gray-500"
        }`}
      >
        👍
      </button>
      <button
        onClick={() => onFeedback(-1)}
        disabled={feedback !== undefined}
        title="Not helpful"
        className={`rounded px-2 py-0.5 text-sm transition-colors disabled:cursor-default ${
          feedback === "down"
            ? "text-red-400"
            : "text-gray-500 hover:text-gray-300 disabled:hover:text-gray-500"
        }`}
      >
        👎
      </button>
      {feedback && (
        <span className="text-[11px] text-gray-500 ml-1">Thanks!</span>
      )}
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onFeedback,
}: {
  message: Message;
  onFeedback: (rating: 1 | -1) => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 shadow-sm ${
          isUser
            ? "bg-indigo-600 text-white rounded-br-sm"
            : "bg-gray-800 text-gray-100 rounded-bl-sm border border-gray-700/50"
        }`}
      >
        {!isUser && <ToolTrace events={message.toolEvents} />}

        {(message.content || message.isStreaming) && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
            {message.isStreaming && (
              <span className="inline-block w-1.5 h-[1em] bg-current ml-0.5 animate-pulse align-middle opacity-70" />
            )}
          </p>
        )}

        {!isUser && !message.isStreaming && message.requestId && (
          <FeedbackBar feedback={message.feedback} onFeedback={onFeedback} />
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendFeedback = async (messageId: string, requestId: string, rating: 1 | -1) => {
    // Optimistic update
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, feedback: rating === 1 ? "up" : "down" } : m
      )
    );
    try {
      await fetch(`${API_URL}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId, rating }),
      });
    } catch {
      // Best-effort; don't revert the optimistic update
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput("");
    setIsLoading(true);

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      toolEvents: [],
      isStreaming: false,
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      toolEvents: [],
      isStreaming: true,
    };

    const history = messages
      .filter((m) => m.content.trim())
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server returned ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          let data: Record<string, unknown>;
          try {
            data = JSON.parse(line.slice(6)) as Record<string, unknown>;
          } catch {
            continue;
          }

          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantId) return m;

              const updated = { ...m, toolEvents: [...m.toolEvents] };

              switch (data.type) {
                case "text":
                  updated.content += data.content as string;
                  break;

                case "server_tool_use":
                case "tool_use":
                  updated.toolEvents.push({
                    type: data.type as ToolEventType,
                    tool: data.tool as string,
                    input: data.input as Record<string, unknown>,
                  });
                  break;

                case "tool_result": {
                  const idx = updated.toolEvents
                    .map((e, i) => ({ e, i }))
                    .reverse()
                    .find(
                      ({ e }) =>
                        e.tool === (data.tool as string) && e.result === undefined
                    )?.i;
                  if (idx !== undefined) {
                    updated.toolEvents[idx] = {
                      ...updated.toolEvents[idx],
                      result: data.result as string,
                      success: data.success as boolean,
                    };
                  }
                  break;
                }

                case "done":
                  updated.isStreaming = false;
                  updated.requestId = data.request_id as string;
                  break;

                case "error":
                  updated.content += `\n\n⚠️ ${data.content as string}`;
                  updated.isStreaming = false;
                  break;
              }

              return updated;
            })
          );
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: `⚠️ Could not reach the backend: ${String(err)}`,
                isStreaming: false,
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="w-full max-w-3xl flex flex-col h-[76vh] bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-700/50">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-gray-500 text-sm text-center leading-relaxed">
              Ask me anything — I can search the web and do math.
              <br />
              <span className="text-gray-600 text-xs mt-1 block">
                Try: &ldquo;What is the current price of gold? Square that
                number.&rdquo;
              </span>
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onFeedback={(rating) =>
                m.requestId && sendFeedback(m.id, m.requestId, rating)
              }
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-700/50 px-4 py-4 bg-gray-900/80">
        <div className="flex gap-3 items-center">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask anything…"
            disabled={isLoading}
            className="flex-1 bg-gray-800 text-gray-100 placeholder-gray-500 rounded-xl px-4 py-3 text-sm outline-none border border-gray-700 focus:border-indigo-500 transition-colors disabled:opacity-50"
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-5 py-3 text-sm font-medium transition-colors whitespace-nowrap"
          >
            {isLoading ? (
              <span className="flex items-center gap-1.5">
                <span className="w-1 h-1 bg-white rounded-full animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1 h-1 bg-white rounded-full animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1 h-1 bg-white rounded-full animate-bounce" />
              </span>
            ) : (
              "Send"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
