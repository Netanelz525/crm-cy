function clean(value) {
  return String(value || "").trim();
}

function queueConfig() {
  const accountId = clean(process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || process.env.R2_ACCOUNT_ID);
  const queueId = clean(process.env.CLOUDFLARE_PRINT_QUEUE_ID || process.env.CLOUDFLARE_QUEUE_ID || process.env.CF_PRINT_QUEUE_ID);
  const token = clean(process.env.CLOUDFLARE_QUEUES_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_QUEUES_API_TOKEN);
  return { accountId, queueId, token };
}

async function readQueueResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(clean(data?.errors?.[0]?.message) || `${fallbackMessage} (${response.status}).`);
  }
  return data;
}

function queueUrl(path) {
  const { accountId, queueId } = queueConfig();
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}${path}`;
}

function queueHeaders() {
  const { token } = queueConfig();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

function parseMessageBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return { job_id: body };
    }
  }
  if (body && typeof body === "object") return body;
  return {};
}

function normalizeQueueMessage(message) {
  if (!message) return null;
  const body = parseMessageBody(message.body ?? message.content ?? message.message);
  return {
    jobId: clean(body.job_id || body.jobId || body.id),
    leaseId: clean(message.lease_id || message.leaseId),
    messageId: clean(message.id || message.message_id || message.messageId),
    rawMessage: message
  };
}

export function isPrintQueueConfigured() {
  const config = queueConfig();
  return Boolean(config.accountId && config.queueId && config.token);
}

export async function publishPrintJobToQueue(jobId) {
  const normalizedJobId = clean(jobId);
  if (!normalizedJobId || !isPrintQueueConfigured()) return { skipped: true };

  const response = await fetch(
    queueUrl("/messages"),
    {
      method: "POST",
      headers: queueHeaders(),
      body: JSON.stringify({ body: { job_id: normalizedJobId } })
    }
  );

  const data = await readQueueResponse(response, "Cloudflare Queue publish failed");
  return { ok: true, response: data };
}

export async function pullPrintJobFromQueue({ batchSize = 1, visibilityTimeoutMs = 30000 } = {}) {
  if (!isPrintQueueConfigured()) return null;

  const response = await fetch(
    queueUrl("/messages/pull"),
    {
      method: "POST",
      headers: queueHeaders(),
      body: JSON.stringify({
        batch_size: Math.max(1, Math.min(10, Number(batchSize) || 1)),
        visibility_timeout_ms: Math.max(1000, Math.min(12 * 60 * 60 * 1000, Number(visibilityTimeoutMs) || 30000))
      })
    }
  );

  const data = await readQueueResponse(response, "Cloudflare Queue pull failed");
  const messages = Array.isArray(data?.result?.messages)
    ? data.result.messages
    : Array.isArray(data?.result)
      ? data.result
      : Array.isArray(data?.messages)
        ? data.messages
        : [];
  return normalizeQueueMessage(messages[0] || null);
}

export async function ackPrintQueueMessage(leaseId) {
  const normalizedLeaseId = clean(leaseId);
  if (!normalizedLeaseId || !isPrintQueueConfigured()) return { skipped: true };
  const response = await fetch(
    queueUrl("/messages/ack"),
    {
      method: "POST",
      headers: queueHeaders(),
      body: JSON.stringify({
        acks: [{ lease_id: normalizedLeaseId }],
        retries: []
      })
    }
  );
  const data = await readQueueResponse(response, "Cloudflare Queue ack failed");
  return { ok: true, response: data };
}

export async function retryPrintQueueMessage(leaseId) {
  const normalizedLeaseId = clean(leaseId);
  if (!normalizedLeaseId || !isPrintQueueConfigured()) return { skipped: true };
  const response = await fetch(
    queueUrl("/messages/ack"),
    {
      method: "POST",
      headers: queueHeaders(),
      body: JSON.stringify({
        acks: [],
        retries: [{ lease_id: normalizedLeaseId }]
      })
    }
  );
  const data = await readQueueResponse(response, "Cloudflare Queue retry failed");
  return { ok: true, response: data };
}
