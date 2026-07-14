function clean(value) {
  return String(value || "").trim();
}

function queueConfig() {
  const accountId = clean(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || process.env.R2_ACCOUNT_ID);
  const queueId = clean(process.env.CLOUDFLARE_PRINT_QUEUE_ID || process.env.CLOUDFLARE_QUEUE_ID || process.env.CF_PRINT_QUEUE_ID);
  const token = clean(process.env.CLOUDFLARE_QUEUES_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_QUEUES_API_TOKEN);
  return { accountId, queueId, token };
}

export function isPrintQueueConfigured() {
  const config = queueConfig();
  return Boolean(config.accountId && config.queueId && config.token);
}

export async function publishPrintJobToQueue(jobId) {
  const normalizedJobId = clean(jobId);
  if (!normalizedJobId || !isPrintQueueConfigured()) return { skipped: true };

  const { accountId, queueId, token } = queueConfig();
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ body: { job_id: normalizedJobId } })
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(clean(data?.errors?.[0]?.message) || `Cloudflare Queue publish failed (${response.status}).`);
  }
  return { ok: true, response: data };
}
