export function canManagePersonalTools(user) {
  return Boolean(user?.access_status === 'approved' && (user.is_manager || user.is_super_admin));
}
