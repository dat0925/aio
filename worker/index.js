// worker/index.js
// Cloudflare Worker: AIOチェッカー バックエンド
//
// 役割:
//   0. アクセスコード(ハッシュ照合)による簡易認証
//   POST /structural … 指定URLのHTMLをサーバー側で取得(CORS制約を回避)し、
//      title/meta description/OGP/canonical/構造化データ(JSON-LD)/見出し構成
//      などを軽量パースして即座に返す(高速・タイムアウトしにくい)
//   POST /ai … /structural のレスポンスをそのまま渡すと、Claude API(web_search有効)
//      で所見・推奨施策・競合文脈をJSONで生成して返す(時間がかかる処理を分離)
//
// 2段階に分けている理由: ページ取得+AI生成を1リクエストにまとめると、
// モバイル回線等でタイムアウトしやすく「全部やり直し」になってしまうため。
// 構造データは即表示し、AI所見は後から差し込む設計にしている。
//
// 必須シークレット:
//   ANTHROPIC_API_KEY  - Claude APIキー
//   CHECKER_PIN_HASH    - アクセスコードのSHA-256ハッシュ(16進数文字列)。
//                          平文のアクセスコードはどこにも保存しない。

const ALLOWED_ORIGIN = "*"; // 必要に応じて "https://aio.taskra.jp" に絞ってください

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "content-type, x-access-hash",
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

async function getAiFindings(url, structural, apiKey, signal, useWebSearch = true) {
  if (!apiKey) return null;

  const webSearchNote = useWebSearch
    ? '必要であれば、このサービスのカテゴリに関する一般的な検索語でWeb検索を行い、競合や比較記事の中でこのサービスがどう扱われているか確認してください。'
    : 'Web検索は使わず、上記の構造情報と本文のみをもとに診断してください。competitive_noteは「今回はWeb検索なしで診断しています」と記載してください。';

  const prompt = `あなたはWebサイトの「AIO(AI Optimization)」診断アシスタントです。
ChatGPTやGoogleのAI検索のような生成AIに、関連する質問をしたときにこのページが紹介・引用されやすいかを診断します。

【対象URL】
${url}

【構造情報(機械的に取得)】
${JSON.stringify(structural, null, 2)}

【本文抜粋】
${structural.bodyTextSample}

${webSearchNote}

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

  const reqBody = {
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  };
  if (useWebSearch) {
    reqBody.tools = [{ type: "web_search_20250305", name: "web_search" }];
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(reqBody),
    signal,
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

async function handleStructural(request) {
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000); // 10秒でタイムアウト
    let pageRes;
    try {
      pageRes = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AIOChecker/1.0; +https://aio.taskra.jp)" },
        redirect: "follow",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!pageRes.ok) {
      return jsonResponse({ error: `ページの取得に失敗しました(status: ${pageRes.status})` }, 400);
    }
    html = await pageRes.text();
  } catch (e) {
    const timedOut = e && e.name === "AbortError";
    return jsonResponse(
      { error: timedOut ? "ページの取得がタイムアウトしました(10秒)。対象サイトが重い可能性があります。" : `ページの取得中にエラーが発生しました: ${String(e)}` },
      400,
    );
  }

  const structural = parseStructural(html);
  return jsonResponse({ url, structural });
}

async function handleAi(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (_e) {
    return jsonResponse({ error: "リクエストボディが不正です" }, 400);
  }

  const { url, structural } = body;
  if (!url || !structural) {
    return jsonResponse({ error: "url・structuralが必要です(先に/structuralを呼んでください)" }, 400);
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return jsonResponse({ aiFindings: null });
  }

  // 1回目: web_search有効(40秒タイムアウト)
  let timedOut1 = false;
  try {
    const controller1 = new AbortController();
    const timer1 = setTimeout(() => controller1.abort(), 40000);
    try {
      const aiFindings = await getAiFindings(url, structural, apiKey, controller1.signal, true);
      return jsonResponse({ aiFindings, usedWebSearch: true });
    } finally {
      clearTimeout(timer1);
    }
  } catch (e) {
    if (e && e.name === "AbortError") {
      timedOut1 = true;
    } else {
      return jsonResponse({ aiFindings: { error: `AI診断中にエラーが発生しました: ${String(e)}` } });
    }
  }

  // 2回目: web_searchなしで自動リトライ(20秒タイムアウト)
  if (timedOut1) {
    try {
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), 20000);
      try {
        const aiFindings = await getAiFindings(url, structural, apiKey, controller2.signal, false);
        // リトライ成功: competitive_noteにweb_search未使用の旨を追記
        if (aiFindings && !aiFindings.error) {
          aiFindings.competitive_note = '(今回は時間の都合でWeb検索なしで診断しました。競合情報は別途ご確認ください。)';
        }
        return jsonResponse({ aiFindings, usedWebSearch: false });
      } finally {
        clearTimeout(timer2);
      }
    } catch (e2) {
      return jsonResponse({
        aiFindings: {
          error: e2 && e2.name === "AbortError"
            ? "AI診断がタイムアウトしました。しばらく時間をおいて再試行してください。"
            : `AI診断中にエラーが発生しました: ${String(e2)}`,
        },
      });
    }
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

    // ---- アクセスコード認証(ハッシュ照合) ----
    const expectedHash = env.CHECKER_PIN_HASH;
    if (expectedHash) {
      const providedHash = request.headers.get("x-access-hash") || "";
      if (providedHash.toLowerCase() !== expectedHash.toLowerCase()) {
        return jsonResponse({ error: "アクセスコードが正しくありません" }, 401);
      }
    }
    // -------------------------------------------

    const { pathname } = new URL(request.url);

    if (pathname === "/structural") {
      return handleStructural(request);
    }
    if (pathname === "/ai") {
      return handleAi(request, env);
    }
    return jsonResponse({ error: "不明なエンドポイントです(/structural または /ai を使用してください)" }, 404);
  },
};
