export function callDeskFilterKey(sessionId, publicDesk = false) {
  return `attendance-call-status:${encodeURIComponent(sessionId)}:${publicDesk ? "public" : "signed"}`;
}

export function resolveCallDeskFilter(statusOptions, initialStatus, savedStatus, explicitStatus = false) {
  const normalize = value => {
    if (value === "") return "";
    if (typeof value !== "string") return null;
    return statusOptions.find(([id, label]) => id !== "unavailable" && (id === value || label === value))?.[0] ?? null;
  };
  if (explicitStatus) {
    const requested = normalize(initialStatus);
    if (requested !== null) return requested;
  }
  return normalize(savedStatus) ?? normalize(initialStatus) ?? "";
}
