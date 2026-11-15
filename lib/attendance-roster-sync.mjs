// Server refreshes may arrive while a newer local edit is still being typed.
export function mergeAttendanceRows(incomingRows, currentRows, drafts, focusedNotes = new Set()) {
  const currentById = new Map(currentRows.map(row => [row.id, row]));
  return incomingRows.map(incoming => {
    const current = currentById.get(incoming.id);
    const draft = drafts.get(incoming.id);
    if (!current || !draft) return incoming;
    if (draft.saved && !focusedNotes.has(incoming.id) && String(incoming.noteText || "").trim() === String(current.noteText || "").trim() && incoming.status === current.status) {
      drafts.delete(incoming.id);
      return incoming;
    }
    return { ...incoming, noteText: current.noteText, status: current.status, statusLabel: current.statusLabel };
  });
}
