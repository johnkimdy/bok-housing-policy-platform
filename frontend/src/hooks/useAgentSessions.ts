/**
 * Module-level store so session state survives React unmount/remount
 * (i.e. navigating away from AiAdvisor and back).
 */

import type { ChatMsg } from "../pages/AiAdvisor";

export interface StoredSession {
  rid: string;
  title: string;
  createdAt: string;
  messages: ChatMsg[];
}

// Persisted outside React — survives tab navigation
const store: {
  sessions: StoredSession[];
  activeRid: string | null;
} = {
  sessions: [],
  activeRid: null,
};

export function getSessions() {
  return store.sessions;
}

export function getActiveRid() {
  return store.activeRid;
}

export function getActiveSession(): StoredSession | undefined {
  return store.sessions.find((s) => s.rid === store.activeRid);
}

export function addSession(session: StoredSession) {
  store.sessions.unshift(session);
  store.activeRid = session.rid;
}

export function setActiveRid(rid: string | null) {
  store.activeRid = rid;
}

export function updateMessages(rid: string, messages: ChatMsg[]) {
  const s = store.sessions.find((s) => s.rid === rid);
  if (s) s.messages = messages;
}

export function updateTitle(rid: string, title: string) {
  const s = store.sessions.find((s) => s.rid === rid);
  if (s) s.title = title;
}

export function removeSession(rid: string) {
  store.sessions = store.sessions.filter((s) => s.rid !== rid);
  if (store.activeRid === rid) {
    store.activeRid = store.sessions[0]?.rid ?? null;
  }
}
