import { listApiTokens } from "../../../lib/api-tokens";
import { requireTeamUser } from "../../../lib/rbac";
import { AdminPageHeader } from "../admin-ui";
import ApiAccessClient from "../api-access-client";
import ApiTokensCard from "../api-tokens-card";

export default async function AdminApiAccessPage() {
  await requireTeamUser();
  const apiTokens = await listApiTokens();
  const apiBaseUrl = process.env.CRM_BASE_URL || process.env.APP_BASE_URL || "http://localhost:3000";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <AdminPageHeader
        title="גישת API וטוקנים"
        description="אזור עבודה ליצירת טוקנים, בדיקת endpointים, והעתקת בקשות מוכנות לשימוש חיצוני."
      />
      <ApiAccessClient apiBaseUrl={apiBaseUrl} />
      <ApiTokensCard apiTokens={apiTokens} />
    </div>
  );
}
