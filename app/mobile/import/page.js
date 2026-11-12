import { requireAuthenticatedUser } from '../../../lib/rbac';
import { canAccessPrintFeature, canUseColorPrint, getPrintCreditBalance, hasUnlimitedPrintCredit, MAX_PRINT_FILE_BYTES } from '../../../lib/print-jobs';
import { listAnnouncementTemplates, listAnnouncementSignatures } from '../../../lib/announcements';
import MobileImportClient from './share-client';
export default async function MobileImportPage() {
  const user = await requireAuthenticatedUser();
  const canPrint = canAccessPrintFeature(user);
  const unlimited = hasUnlimitedPrintCredit(user);
  const templates = user.can_use_announcement_templates ? await listAnnouncementTemplates({ user }) : [];
  const signatures = user.can_use_announcement_templates ? await listAnnouncementSignatures() : [];
  return <MobileImportClient canPrint={canPrint} canAssign={Boolean(user.access_status === 'approved' && (user.is_team_member || user.is_manager || user.is_super_admin))}
    templates={templates} signatures={signatures} printProps={{ maxFileBytes: MAX_PRINT_FILE_BYTES,
      unlimitedPrintCredit: unlimited, creditBalance: canPrint && !unlimited ? await getPrintCreditBalance(user.clerk_user_id) : 0,
      canUseColor: canUseColorPrint(user) }} />;
}
