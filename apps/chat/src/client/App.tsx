import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  traceId?: string | null;
  traceUrl?: string | null;
  model?: string;
  vote?: boolean;
}

const SUGGESTIONS = ["Explain Langfuse in two sentences", "Write a haiku about monorepos", "Give me three tips for writing good prompts"];

// One conversation per page load (groups the traces of this chat in Langfuse).
// randomUUID only exists on secure origins (HTTPS/localhost); getRandomValues works everywhere.
const sessionId =
  crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

async function postJson(path: string, body: unknown): Promise<Response> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: undefined }));
    throw new Error(error ?? `Request failed (${res.status})`);
  }
  return res;
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Braces matter: newer browsers return a Promise from scrollIntoView, which React would call as a cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || pending) return;
    const history = messages.map(({ role, content }) => ({ role, content }));
    const userTurn: Message = { role: "user", content: message };
    // Functional updates so a vote cast while this reply is pending is kept.
    setMessages((all) => [...all, userTurn]);
    setPending(true);
    setError(null);
    try {
      const res = await postJson("/api/chat", { message, history, sessionId });
      const { output, traceId, traceUrl, model } = await res.json();
      setMessages((all) => [...all, { role: "assistant", content: output, traceId, traceUrl, model }]);
      setInput("");
    } catch (e) {
      setMessages((all) => all.filter((m) => m !== userTurn)); // the text stays in the input so it can be resent
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) void send(event);
  }

  async function vote(index: number, positive: boolean) {
    const traceId = messages[index]?.traceId;
    if (!traceId) return;
    const setVote = (v: boolean | undefined) =>
      setMessages((all) => all.map((m, i) => (i === index ? { ...m, vote: v } : m)));
    setVote(positive);
    try {
      await postJson("/api/feedback", { traceId, positive });
    } catch (e) {
      setVote(undefined);
      setError(e instanceof Error ? e.message : "Could not send feedback");
    }
  }

  function pickSuggestion(text: string) {
    setInput(text);
    inputRef.current?.focus();
  }

  return (
    <main className="chat">
      <header className="header">
        <span className="logo" aria-hidden="true">
          ✦
        </span>
        <div>
          <h1>Chat</h1>
          <p className="subtitle">Every reply is traced in Langfuse</p>
        </div>
      </header>
      <div className="messages" role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && !pending && (
          <div className="empty">
            <p className="empty-title">How can I help today?</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="suggestion" onClick={() => pickSuggestion(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <p>{m.content}</p>
            {m.role === "assistant" && (
              <div className="meta">
                {m.model && <span className="model">{m.model}</span>}
                {m.traceId && (
                  <>
                    <button
                      type="button"
                      aria-label="Good response"
                      aria-pressed={m.vote === true}
                      disabled={m.vote !== undefined}
                      onClick={() => vote(i, true)}
                    >
                      👍
                    </button>
                    <button
                      type="button"
                      aria-label="Bad response"
                      aria-pressed={m.vote === false}
                      disabled={m.vote !== undefined}
                      onClick={() => vote(i, false)}
                    >
                      👎
                    </button>
                  </>
                )}
                {m.traceUrl && (
                  <a href={m.traceUrl} target="_blank" rel="noopener noreferrer">
                    View trace
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
        {pending && (
          <div className="message assistant thinking">
            <span className="dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="visually-hidden">Thinking…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form className="composer" onSubmit={send}>
        <label htmlFor="message" className="visually-hidden">
          Message
        </label>
        <textarea
          id="message"
          ref={inputRef}
          rows={2}
          value={input}
          placeholder="Message the assistant…"
          aria-describedby="composer-hint"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          readOnly={pending} // keeps focus in the box while waiting
        />
        <button type="submit" aria-label="Send message" disabled={pending || !input.trim()}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10l12.6 2-12.6 2z" fill="currentColor" />
          </svg>
        </button>
      </form>
      <p id="composer-hint" className="hint">
        Enter to send · Shift+Enter for a new line
      </p>
    </main>
  );
}
