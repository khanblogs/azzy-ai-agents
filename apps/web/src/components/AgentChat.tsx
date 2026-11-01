"use client";

import clsx from "clsx";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AGENT_META, type AgentId, type ChatMessage } from "@azzy/events";
import { api, ApiError } from "@/lib/api";
import { clock } from "@/lib/format";
import type { Conversation } from "@/lib/types";
import { can, useAzzy } from "@/store/useAzzy";
import { AgentAvatar } from "./AgentChip";
import { Button } from "./Button";
import { Skeleton } from "./EmptyState";
import { IconSend, IconTrash } from "./Icons";

const SUGGESTIONS: Record<AgentId, string[]> = {
  jimmy: ["What environments do we have?", "What was the last deployment?", "Deploy v2.4 to client b"],
  emir: ["Review the latest PR for risks", "What tests are flaky?", "Explain the last root cause you found"],
  cyber: ["What did the last scan find?", "Is the release gate open?", "Run a secrets sweep"],
  sara: ["How many tasks are open right now?", "Draft an incident summary", "What is this week's plan?"],
  marwah: ["Draft a launch announcement", "Summarise campaign performance", "Propose a content calendar"],
};

function Bubble({ m, agent }: { m: ChatMessage; agent: AgentId }) {
  const mine = m.role === "user";
  const color = AGENT_META[agent].color;
  return (
    <li className={clsx("flex gap-2", mine ? "justify-end" : "justify-start")} data-testid={mine ? "chat-message-user" : m.role === "system" ? "chat-message-system" : "chat-message-agent"} data-streaming={m.streaming ? "true" : "false"}>
      {!mine ? <AgentAvatar id={agent} size={26} className="mt-1" /> : null}
      <div className={clsx("max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-glass", mine ? "rounded-br-md bg-brand-cyan/15 text-white ring-1 ring-brand-cyan/30" : m.role === "system" ? "bg-white/5 text-slate-400 italic" : "rounded-bl-md bg-midnight text-slate-100 ring-1 ring-white/10")}>
        <p className="whitespace-pre-wrap break-words">
          {m.content}
          {m.streaming ? <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulseDot align-middle" style={{ backgroundColor: color }} aria-label="typing" /> : null}
        </p>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
          <span>{clock(m.created_at)}</span>
          {m.task_id ? (
            <Link href={`/app/tasks/${m.task_id}`} className="font-mono hover:text-brand-cyan">
              task {m.task_id.slice(0, 8)} →
            </Link>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function AgentChat({ agent }: { agent: AgentId }) {
  const me = useAzzy((s) => s.me);
  const toast = useAzzy((s) => s.toast);
  const setChat = useAzzy((s) => s.setChat);
  const appendChat = useAzzy((s) => s.appendChat);
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [cid, setCid] = useState<string | null>(null);
  const messages = useAzzy((s) => (cid ? s.chat[cid] : undefined));
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const writable = can(me, "write");

  const loadConversations = useCallback(async () => {
    try {
      const list = await api.agents.conversations(agent);
      setConvs(list);
      setCid((cur) => cur ?? list[0]?.id ?? null);
    } catch {
      setConvs([]);
    }
  }, [agent]);

  useEffect(() => {
    setConvs(null);
    setCid(null);
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!cid) return;
    let alive = true;
    setLoading(true);
    api.conversations
      .messages(cid)
      .then((m) => alive && setChat(cid, m))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [cid, setChat]);

  const lastContent = messages && messages.length > 0 ? messages[messages.length - 1].content : "";
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages?.length, lastContent]);

  const ensureConversation = async (): Promise<string> => {
    if (cid) return cid;
    const c = await api.agents.newConversation(agent);
    setConvs((l) => [c, ...(l ?? [])]);
    setCid(c.id);
    return c.id;
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      const id = await ensureConversation();
      const res = await api.conversations.send(id, content);
      appendChat(id, res.user_message);
      setDraft("");
    } catch (err) {
      if (!(err instanceof ApiError && (err.status === 403 || err.status === 429))) toast({ tone: "error", title: "Message not sent", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  const newConversation = async () => {
    try {
      const c = await api.agents.newConversation(agent);
      setConvs((l) => [c, ...(l ?? [])]);
      setCid(c.id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not start conversation" });
    }
  };

  const removeConversation = async () => {
    if (!cid || !window.confirm("Delete this conversation?")) return;
    try {
      await api.conversations.remove(cid);
      setConvs((l) => (l ?? []).filter((c) => c.id !== cid));
      setCid(null);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not delete conversation" });
    }
  };

  const name = AGENT_META[agent].name;
  const streaming = messages?.some((m) => m.streaming) ?? false;

  return (
    <div className="flex h-[70svh] min-h-[460px] flex-col rounded-2xl border border-line bg-black/20 lg:h-[calc(100svh-13rem)]" data-testid="agent-chat">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <label htmlFor="conv-select" className="sr-only">
          Conversation
        </label>
        <select
          id="conv-select"
          value={cid ?? ""}
          onChange={(e) => setCid(e.target.value || null)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-navy px-2 text-xs text-slate-200 focus:border-brand-cyan/60 focus:outline-none"
          aria-label="Choose conversation"
        >
          {convs === null ? <option value="">Loading…</option> : null}
          {convs?.length === 0 ? <option value="">New conversation</option> : null}
          {convs?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title || `Conversation ${c.id.slice(0, 6)}`}
            </option>
          ))}
        </select>
        <Button size="sm" variant="outline" onClick={newConversation} disabled={!writable} title={!writable ? "Read-only role" : undefined} aria-label="Start a new conversation">
          New
        </Button>
        <Button size="sm" variant="ghost" onClick={removeConversation} disabled={!cid} aria-label="Delete conversation" icon={<IconTrash width={14} height={14} />} />
      </div>
      <ul ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite" aria-label={`Chat with ${name}`}>
        {loading && !messages ? (
          <>
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="ml-auto h-10 w-1/2" />
          </>
        ) : null}
        {!loading && (!messages || messages.length === 0) ? (
          <li className="rounded-2xl border border-dashed border-line p-4 text-center text-xs text-slate-400">
            <p className="mb-3">Start a conversation with {name}. Action requests become real tasks with approvals.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS[agent].map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} disabled={!writable || sending} className="rounded-full border border-line bg-white/5 px-3 py-1 text-[11px] text-slate-200 transition hover:border-brand-cyan/50 hover:text-white disabled:opacity-40">
                  {s}
                </button>
              ))}
            </div>
          </li>
        ) : null}
        {messages?.map((m) => (
          <Bubble key={m.id} m={m} agent={agent} />
        ))}
      </ul>
      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-line p-2">
        <label htmlFor="chat-input" className="sr-only">
          Message {name}
        </label>
        <textarea
          id="chat-input"
          data-testid="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          rows={1}
          placeholder={writable ? `Message ${name}…` : "Read-only role: chat is disabled"}
          disabled={!writable}
          className="max-h-32 min-h-[40px] flex-1 resize-y rounded-xl border border-line bg-navy px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-brand-cyan/60 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20 disabled:opacity-50"
        />
        <Button type="submit" variant="primary" data-testid="chat-send" aria-label={`Send message to ${name}`} loading={sending} disabled={!draft.trim() || !writable} title={!writable ? "Read-only role cannot chat" : undefined} icon={<IconSend width={16} height={16} />}>
          {streaming ? "…" : "Send"}
        </Button>
      </form>
    </div>
  );
}
