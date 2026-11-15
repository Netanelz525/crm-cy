export function callDeskFilterKey(sessionId, publicDesk = false) {
  return `attendance-call-status:${encodeURIComponent(sessionId)}:${publicDesk ? "public" : "signed"}`;
}

export function resolveCallDeskFilter(statusOptions, initialStatus, savedStatus, explicitStatus = false) {
  const normalize = value => {
    if (value === "") return "";
    if (typeof value !== "string") return null;
    const selected = value.split(",").map(item => item.trim()).filter(Boolean);
    const ids = selected.map(item => statusOptions.find(([id, label]) => id !== "unavailable" && (id === item || label === item))?.[0]);
    return ids.length && ids.every(Boolean) ? [...new Set(ids)].join(",") : null;
  };
  if (explicitStatus) {
    const requested = normalize(initialStatus);
    if (requested !== null) return requested;
  }
  return normalize(savedStatus) ?? normalize(initialStatus) ?? "";
}
