// worker/index.js
// Cloudflare Worker: AIOチェッカー バックエンド
//
// 役割:
//   1. 指定URLのHTMLをサーバー側で取得(CORS制約を回避)
//   2. タイトル・meta description・OGP・canonical・構造化データ(JSON-LD)・
//      見出し構成などを軽量パースし、構造的シグナルとして評価
//   3. Claude API(web_search有効)に構造情報+本文抜粋を渡し、
//      平易な言葉での所見・推奨施策・競合文脈をJSONで生成
//
// デプロイ方法は README.md を参照してください。
// 必須シークレット: ANTHROPIC_API_KEY (Cloudflareダッシュボード > Workers > Settings > Variables で設定)

const ALLOWED_ORIGIN = "*"; // 必要に応じて "https://aio.taskra.jp" に絞ってください

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
  });
}

function getMeta(html, name) {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

function parseStructural(html) {
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || null;
  const metaDescription = getMeta(html, "description");
  const ogTitle = getMeta(html, "og:title");
  const ogDescription = getMeta(html, "og:description");
  const ogImage = getMeta(html, "og:image");
  const canonical =
    (html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i) || [])[1] || null;
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;

  const jsonLdBlocks = [
    ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ].map((m) => m[1]);

  let hasFAQSchema = false;
  const schemaTypes = [];
  for (const block of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const type = item?.["@type"];
        if (type) schemaTypes.push(Array.isArray(type) ? type.join(",") : String(type));
        if (JSON.stringify(item).includes("FAQPage")) hasFAQSchema = true;
      }
    } catch (_e) {
      // 不正なJSON-LDは無視
    }
  }

  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const hasPricingText = /[¥￥]\s?[0-9,]+|円\s?\/\s?月|無料/.test(bodyText);
  const faqKeywordHit = /よくある質問|FAQ|Q&A/i.test(bodyText);

  return {
    title,
    metaDescription,
    ogTitle,
    ogDescription,
    ogImage,
    canonical,
    h1Count,
    hasFAQSchema,
    schemaTypes,
    hasPricingText,
    faqKeywordHit,
    bodyTextLength: bodyText.length,
    bodyTextSample: bodyText.slice(0, 2000),
  };
}

async function getAiFindings(url, structural, apiKey) {
  if (!apiKey) return null;

  const prompt = `あなたはWebサイトの「AIO(AI Optimization)」診断アシスタントです。
ChatGPTやGoogleのAI検索のような生成AIに、関連する質問をしたときにこのページが紹介・引用されやすいかを診断します。

【対象URL】
${url}

【構造情報(機械的に取得)】
${JSON.stringify(structural, null, 2)}

【本文抜粋】
${structural.bodyTextSample}

必要であれば、このサービスのカテゴリに関する一般的な検索語でWeb検索を行い、競合や比較記事の中でこのサービスがどう扱われているか確認してください。

以下のJSON形式のみを出力してください。前置き・後置き・コードブロック記号(\`\`\`)は一切不要です。

{
  "status": "良好" または "要注意" または "危険",
  "score": 0から100の整数,
  "summary": "2〜3文の所見。専門用語を使わず平易に",
  "strengths": ["良い点を1〜3個、短文で"],
  "issues": ["課題を2〜4個、短文で、平易に"],
  "actions": [
    {"action": "具体的な施策", "priority": "高 または 中 または 低", "impact": "期待できる効果"}
  ],
  "competitive_note": "Web検索で分かった範囲での、競合・比較記事における位置づけについての所見"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return { error: `Claude API error: ${res.status} ${errText.slice(0, 300)}` };
  }

  const data = await res.json();
  const textBlocks = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  try {
    const cleaned = textBlocks.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (_e) {
    return { raw: textBlocks };
  }
}

export default {
  async fetch(request, env, _ctx) {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return jsonResponse({ error: "POSTメソッドを使用してください" }, 405);
    }

    let url;
    try {
      const body = await request.json();
      url = body.url;
    } catch (_e) {
      return jsonResponse({ error: "リクエストボディが不正です" }, 400);
    }

    if (!url || !/^https?:\/\//i.test(url)) {
      return jsonResponse({ error: "有効なURL(http/httpsから始まる)を入力してください" }, 400);
    }

    let html;
    try {
      const pageRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AIOChecker/1.0; +https://aio.taskra.jp)" },
        redirect: "follow",
      });
      if (!pageRes.ok) {
        return jsonResponse({ error: `ページの取得に失敗しました(status: ${pageRes.status})` }, 400);
      }
      html = await pageRes.text();
    } catch (e) {
      return jsonResponse({ error: `ページの取得中にエラーが発生しました: ${String(e)}` }, 400);
    }

    const structural = parseStructural(html);

    let aiFindings = null;
    try {
      aiFindings = await getAiFindings(url, structural, env.ANTHROPIC_API_KEY);
    } catch (e) {
      aiFindings = { error: `AI診断中にエラーが発生しました: ${String(e)}` };
    }

    const { bodyTextSample: _omit, ...structuralForClient } = structural;

    return jsonResponse({ url, structural: structuralForClient, aiFindings });
  },
};
