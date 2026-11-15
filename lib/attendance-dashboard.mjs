export function buildAttendanceDashboard(roster) {
  const students = roster?.students || [];
  const labels = new Map(roster?.session?.statusOptions || []);
  const counts = new Map([...labels.keys()].map(status => [status, 0]));
  for (const student of students) {
    const status = student.status || "missing";
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return {
    total: students.length,
    updatedAt: new Date().toISOString(),
    statuses: [...counts].map(([value, count]) => ({
      value, label: labels.get(value) || value, count,
      percentage: students.length ? Number((count / students.length * 100).toFixed(1)) : 0
    }))
  };
}
