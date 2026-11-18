export function buildAttendanceDashboard(roster, namesForStatus) {
  const students = roster?.students || [];
  const labels = new Map(roster?.session?.statusOptions || []);
  const counts = new Map([...labels.keys()].map(status => [status, 0]));
  const names = [];
  for (const student of students) {
    const status = student.status || "missing";
    if (status === namesForStatus) names.push(student.label || "ללא שם");
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return {
    ...(typeof namesForStatus === "string" ? { names } : {}),
    total: students.length,
    updatedAt: new Date().toISOString(),
    statuses: [...counts].map(([value, count]) => ({
      value, label: labels.get(value) || value, count,
      percentage: students.length ? Number((count / students.length * 100).toFixed(1)) : 0
    }))
  };
}
