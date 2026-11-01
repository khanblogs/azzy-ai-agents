"use client";

import { parseEvent } from "@azzy/events";
import { useAzzy } from "@/store/useAzzy";

const PING_MS = 25_000;
const BACKOFF_MIN = 1_000;
const BACKOFF_MAX = 20_000;

let socket: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = BACKOFF_MIN;
let refCount = 0;
let stopped = true;
let hadConnection = false;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/api/ws`;
}

function clearTimers() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  const delay = backoff;
  backoff = Math.min(BACKOFF_MAX, Math.round(backoff * 1.7));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (stopped || typeof window === "undefined") return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const store = useAzzy.getState();
  store.setWs("connecting");
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl());
  } catch {
    store.setWs("disconnected");
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) return;
    backoff = BACKOFF_MIN;
    useAzzy.getState().setWs("connected");
    // Re-hydrate on every (re)connect so nothing missed during the gap is lost.
    if (hadConnection) void useAzzy.getState().hydrate();
    hadConnection = true;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, PING_MS);
  };

  ws.onmessage = (msg) => {
    let raw: unknown;
    try {
      raw = JSON.parse(typeof msg.data === "string" ? msg.data : "");
    } catch {
      return;
    }
    if (!raw || typeof raw !== "object") return;
    const t = (raw as { type?: unknown }).type;
    if (t === "pong") return;
    if (t === "hello") {
      const demo = (raw as { demo?: unknown }).demo;
      if (typeof demo === "boolean") useAzzy.setState({ demo });
      void useAzzy.getState().hydrate();
      return;
    }
    const ev = parseEvent(raw);
    if (ev) useAzzy.getState().applyEvent(ev);
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    useAzzy.getState().setWs("disconnected");
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose follows; nothing else to do here.
  };
}

/** Reference-counted singleton: the first subscriber opens the socket, the last one closes it. */
export function acquireSocket(): () => void {
  refCount += 1;
  if (refCount === 1) {
    stopped = false;
    connect();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) {
      stopped = true;
      clearTimers();
      const ws = socket;
      socket = null;
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    }
  };
}
