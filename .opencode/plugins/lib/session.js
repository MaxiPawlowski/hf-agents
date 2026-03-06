
const ACTIVE_AGENT_BY_SESSION = new Map();
const MAX_TRACKED_SESSIONS = 200;

// --- Message parsing ---

export const agentNameFromMessages = (messages) => {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i]?.info;
    const agent = info && typeof info === "object" ? info.agent : null;
    if (typeof agent === "string" && agent.trim()) return agent.trim();
  }
  return null;
};

export const sessionIDFromMessages = (messages) => {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const info = messages[i]?.info;
    const sessionID = info && typeof info === "object" ? info.sessionID : null;
    if (typeof sessionID === "string" && sessionID.trim()) return sessionID.trim();
  }
  return null;
};

// --- Session tracking ---

export const recordActiveAgent = (sessionID, agentName) => {
  if (!sessionID || typeof sessionID !== "string") return;
  if (!agentName || typeof agentName !== "string") return;
  ACTIVE_AGENT_BY_SESSION.set(sessionID, agentName);
  if (ACTIVE_AGENT_BY_SESSION.size > MAX_TRACKED_SESSIONS) {
    const firstKey = ACTIVE_AGENT_BY_SESSION.keys().next().value;
    if (firstKey) ACTIVE_AGENT_BY_SESSION.delete(firstKey);
  }
};

export const getActiveAgent = (sessionID) =>
  sessionID ? (ACTIVE_AGENT_BY_SESSION.get(sessionID) ?? null) : null;

