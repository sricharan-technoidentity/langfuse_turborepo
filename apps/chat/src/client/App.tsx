import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  traceId?: string | null;
  traceUrl?: string | null;
  vote?: boolean;
}

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
      const { output, traceId, traceUrl } = await res.json();
      setMessages((all) => [...all, { role: "assistant", content: output, traceId, traceUrl }]);
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

  return (
    <main className="chat">
      <h1>Chat</h1>
      <div className="messages" role="log" aria-live="polite" aria-label="Conversation">
        {messages.map((m, i) => (
          <div key={i} className={`message ${m.role}`}>
            <p>{m.content}</p>
            {m.role === "assistant" && (
              <div className="meta">
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
        {pending && <p className="thinking">Thinking…</p>}
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
          rows={3}
          value={input}
          placeholder="Type a message. Enter sends, Shift+Enter adds a new line."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          readOnly={pending} // keeps focus in the box while waiting
        />
        <button type="submit" aria-label="Send message" disabled={pending || !input.trim()}>
          Send
        </button>
      </form>
    </main>
  );
}
