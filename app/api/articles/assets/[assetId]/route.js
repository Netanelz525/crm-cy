import { getKnowledgeArticleAsset } from "../../../../../lib/knowledge-articles";
import { getObjectBytesFromR2 } from "../../../../../lib/r2";

export const runtime = "nodejs";

export async function GET(_request, { params }) {
  const resolved = await params;
  const asset = await getKnowledgeArticleAsset(resolved?.assetId, { publicOnly: true });
  if (!asset) return new Response("Not found", { status: 404 });
  try {
    const object = await getObjectBytesFromR2(asset.objectKey);
    return new Response(object.bytes, { status: 200, headers: { "Content-Type": asset.contentType || object.contentType, "Cache-Control": "public, max-age=3600" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
