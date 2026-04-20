import { NextResponse } from "next/server";
import { getAppUserByClerkUserId } from "../../../../lib/rbac";
import { getTelegramWebhookSecret, getTelegramLinkByChatId, consumeTelegramLinkCode, sendTelegramMessage, answerTelegramCallbackQuery, downloadTelegramFileAsAttachment } from "../../../../lib/telegram";
import { processTextAiMessage, handleApprovedAiAction, getPendingActionForMessage } from "../../../../lib/ai-text-agent";
import { getAiChatMessageById, setAiChatMessageFeedback } from "../../../../lib/ai-chat-history";
import { processDocumentAttachment } from "../../../../lib/ai-document-agent";

function clean(value) {
  return String(value || "").trim();
}

function extractChat(update) {
  return update?.message?.chat || update?.callback_query?.message?.chat || null;
}

function resolveTelegramAttachment(message) {
  const document = message?.document;
  if (document?.file_id) {
    return {
      fileId: clean(document.file_id),
      fileName: clean(document.file_name) || "telegram-document",
      contentType: clean(document.mime_type) || "application/octet-stream"
    };
  }

  const photos = Array.isArray(message?.photo) ? message.photo : [];
  const photo = photos[photos.length - 1];
  if (photo?.file_id) {
    const photoId = clean(photo.file_id);
    return {
      fileId: photoId,
      fileName: `${photoId}.jpg`,
      contentType: "image/jpeg"
    };
  }

  return null;
}

async function sendNotLinkedMessage(chatId) {
  await sendTelegramMessage(
    chatId,
    "החשבון הזה עדיין לא מחובר למערכת. היכנס לאתר, פתח את מסך Telegram, צור קוד חיבור, ואז שלח לי /start עם הקוד."
  );
}

function resolveBaseUrl() {
  const explicit = process.env.CRM_BASE_URL || process.env.APP_BASE_URL;
  if (explicit) return clean(explicit).replace(/\/$/, "");
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!vercelUrl) return "";
  return `https://${clean(vercelUrl).replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
}

function toAbsoluteUrl(path) {
  const baseUrl = resolveBaseUrl();
  if (!baseUrl) return "";
  const relativePath = clean(path);
  if (!relativePath) return "";
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  return `${baseUrl}${relativePath.startsWith("/") ? relativePath : `/${relativePath}`}`;
}

function splitMessageForTelegram(text, visibleLines = 8) {
  const lines = String(text || "").split("\n");
  if (lines.length <= visibleLines && String(text || "").length <= 700) {
    return {
      text: String(text || ""),
      hasMore: false,
      nextOffset: 0
    };
  }

  const visibleText = lines.slice(0, visibleLines).join("\n");
  return {
    text: `${visibleText}\n\nיש עוד פריטים ברשימה. אפשר ללחוץ על "הצג עוד".`,
    hasMore: true,
    nextOffset: visibleLines
  };
}

function buildTelegramKeyboard({ messageId, pendingAction = null, studentCards = [], hasMore = false, nextOffset = 0, includeFeedback = true }) {
  const inlineKeyboard = [];

  if (pendingAction) {
    inlineKeyboard.push([
      { text: "אשר", callback_data: `approve:${messageId}` },
      { text: "סרב", callback_data: `reject:${messageId}` }
    ]);
  }

  const cardButtons = (Array.isArray(studentCards) ? studentCards : [])
    .slice(0, 3)
    .map((student) => {
      const url = toAbsoluteUrl(student?.studentCardUrl);
      if (!url) return null;
      return { text: `כרטיס: ${clean(student?.name) || "תלמיד"}`, url };
    })
    .filter(Boolean);
  cardButtons.forEach((button) => inlineKeyboard.push([button]));

  if (hasMore) {
    inlineKeyboard.push([{ text: "הצג עוד", callback_data: `more:${messageId}:${nextOffset}` }]);
  }

  if (includeFeedback && messageId) {
    inlineKeyboard.push([
      { text: "תשובה טובה", callback_data: `feedback:good:${messageId}` },
      { text: "לא מדויק", callback_data: `feedback:bad:${messageId}` }
    ]);
  }

  return inlineKeyboard.length ? { inline_keyboard: inlineKeyboard } : undefined;
}

export async function POST(request) {
  try {
    const secret = getTelegramWebhookSecret();
    if (secret) {
      const header = clean(request.headers.get("x-telegram-bot-api-secret-token"));
      if (header !== secret) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const update = await request.json().catch(() => null);
    if (!update || typeof update !== "object") {
      return NextResponse.json({ ok: true });
    }

    if (update.callback_query) {
      const callback = update.callback_query;
      const chatId = clean(callback?.message?.chat?.id);
      const link = await getTelegramLinkByChatId(chatId);
      if (!link?.clerk_user_id) {
        await answerTelegramCallbackQuery(callback.id, "החשבון לא מחובר.");
        return NextResponse.json({ ok: true });
      }
      const user = await getAppUserByClerkUserId(link.clerk_user_id);
      if (!user || (!user.is_team_member && !user.is_manager)) {
        await answerTelegramCallbackQuery(callback.id, "אין הרשאה לפעולה.");
        return NextResponse.json({ ok: true });
      }
      const parts = clean(callback.data).split(":");
      const action = parts[0];
      const messageId = parts[1];

      if (action === "feedback") {
        const feedback = parts[1];
        const feedbackMessageId = parts[2];
        await setAiChatMessageFeedback({
          messageId: feedbackMessageId,
          clerkUserId: user.clerk_user_id,
          feedback
        });
        await answerTelegramCallbackQuery(callback.id, feedback === "good" ? "תודה, שמרתי שהתגובה היתה טובה." : "תודה, שמרתי שהתגובה לא היתה מדויקת.");
        return NextResponse.json({ ok: true });
      }

      if (action === "more") {
        const offset = Math.max(0, Number(parts[2]) || 0);
        const messageRecord = await getAiChatMessageById({
          clerkUserId: user.clerk_user_id,
          messageId
        });
        if (!messageRecord?.content) {
          await answerTelegramCallbackQuery(callback.id, "לא הצלחתי לטעון את ההמשך.");
          return NextResponse.json({ ok: true });
        }

        const lines = String(messageRecord.content).split("\n");
        const nextLines = lines.slice(offset, offset + 25);
        const nextOffset = offset + nextLines.length;
        const hasMore = nextOffset < lines.length;
        await answerTelegramCallbackQuery(callback.id, "מציג עוד");
        await sendTelegramMessage(chatId, nextLines.join("\n"), {
          replyMarkup: buildTelegramKeyboard({
            messageId,
            studentCards: messageRecord.studentCards,
            hasMore,
            nextOffset
          })
        });
        return NextResponse.json({ ok: true });
      }

      const pendingAction = await getPendingActionForMessage({
        clerkUserId: user.clerk_user_id,
        messageId
      });
      if (!pendingAction) {
        await answerTelegramCallbackQuery(callback.id, "לא נמצאה פעולה ממתינה.");
        return NextResponse.json({ ok: true });
      }

      const result = await handleApprovedAiAction({ user, decision: action, pendingAction });
      await answerTelegramCallbackQuery(callback.id, action === "approve" ? "הפעולה אושרה" : "הפעולה נדחתה");
      await sendTelegramMessage(chatId, result.reply, {
        replyMarkup: buildTelegramKeyboard({
          messageId,
          studentCards: result.studentCards,
          includeFeedback: false
        })
      });
      return NextResponse.json({ ok: true });
    }

    const message = update.message;
    const chat = extractChat(update);
    const chatId = clean(chat?.id);
    const text = clean(message?.text || message?.caption);
    const attachmentMeta = resolveTelegramAttachment(message);
    if (!chatId || (!text && !attachmentMeta)) {
      return NextResponse.json({ ok: true });
    }

    const startMatch = text.match(/^\/start(?:\s+(.+))?$/i);
    if (startMatch?.[1]) {
      try {
        const linkResult = await consumeTelegramLinkCode({
          code: startMatch[1],
          telegramChatId: chatId,
          telegramUserId: clean(message?.from?.id),
          telegramUsername: clean(message?.from?.username)
        });
        const user = await getAppUserByClerkUserId(linkResult.clerkUserId);
        await sendTelegramMessage(chatId, `החיבור הושלם בהצלחה. מעכשיו אני מזהה אותך כ-${user?.display_name || "משתמש מורשה"}.`);
      } catch (error) {
        await sendTelegramMessage(chatId, error?.message || "חיבור Telegram נכשל.");
      }
      return NextResponse.json({ ok: true });
    }

    const link = await getTelegramLinkByChatId(chatId);
    if (!link?.clerk_user_id) {
      await sendNotLinkedMessage(chatId);
      return NextResponse.json({ ok: true });
    }

    const user = await getAppUserByClerkUserId(link.clerk_user_id);
    if (!user || (!user.is_team_member && !user.is_manager)) {
      await sendTelegramMessage(chatId, "החשבון הזה אינו מורשה להשתמש בסוכן.");
      return NextResponse.json({ ok: true });
    }

    const result = attachmentMeta
      ? await processDocumentAttachment({
        user,
        attachment: await downloadTelegramFileAsAttachment(attachmentMeta.fileId, {
          fileName: attachmentMeta.fileName,
          contentType: attachmentMeta.contentType
        }),
        messageText: text,
        source: "telegram"
      })
      : await processTextAiMessage({
        user,
        messageText: text,
        source: "telegram"
      });

    const collapsedReply = splitMessageForTelegram(result.reply, 8);
    const replyText = [collapsedReply.text, result.searchSummary ? `\nאיך חיפשתי: ${result.searchSummary}` : ""].filter(Boolean).join("\n");
    const replyMarkup = buildTelegramKeyboard({
      messageId: result.id,
      pendingAction: result.pendingAction,
      studentCards: result.studentCards,
      hasMore: collapsedReply.hasMore,
      nextOffset: collapsedReply.nextOffset
    });
    await sendTelegramMessage(chatId, replyText, { replyMarkup });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook failed:", error?.message || error);
    return NextResponse.json({ ok: true });
  }
}
