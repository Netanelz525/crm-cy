export function attendanceListState(params = {}, userId = '') {
  const values = (Array.isArray(params.responsible) ? params.responsible : [params.responsible]).map(x => String(x || '').trim()).filter(Boolean);
  return {
    archived: params.view === 'archive',
    selectedResponsibleIds: values.includes('all') ? [] : [...new Set(values.map(x => x === 'mine' ? userId : x).filter(Boolean))]
  };
}
export function attendanceListHref(params = {}, changes = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...changes })) {
    if (['lockSaved', 'bulkLockSaved', 'bulkLockCount', 'deleted', 'created'].includes(key)) continue;
    for (const item of Array.isArray(value) ? value : [value]) if (item != null && item !== '') query.append(key, String(item));
  }
  return `/attendance${query.size ? `?${query}` : ''}`;
}
