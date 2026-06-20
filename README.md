# aio — AIOチェッカー

任意のURLを入力すると、「ChatGPTやGoogleのAI検索に紹介・引用されやすいページか」を実際に診断する単体ツールです。SiteMeister・CRMエージェントとの連携は前提にしていません。

## 公開URL

https://aio.taskra.jp

## 仕組み

```
[ index.html ]                [ Supabase Edge Function: aio-check ]
  URLを入力 → POST  ────────▶   1. 対象URLをサーバー側で実際に取得(CORS回避)
                                2. title/meta description/OGP/canonical/
                                   構造化データ(JSON-LD)/見出し構成などを解析
                                3. Claude API(web_search有効)に構造情報+本文を渡し、
                                   平易な所見・推奨施策・競合文脈をJSONで生成
  結果を描画 ◀──────────────   4. 結果をJSONで返却
```

AIによる「実際の生成回答をそのまま見せる」演出はせず、構造的シグナル(FAQ構造化データの有無、GBP的な基本情報の整備状況に相当するメタ情報の整備度など)を軸に診断します。あわせてClaudeのweb_searchで実際に競合・比較記事の状況を確認し、所見に反映します。

## ファイル構成

```
index.html              フロントエンド(単一HTMLファイル)
supabase/aio-check/index.ts   Edge Function本体(Supabaseダッシュボードに手動デプロイ)
archive/requirements-sitemeister-concept.md   旧:SiteMeister組み込み案の要件定義書(参考保管)
CNAME                    GitHub Pagesのカスタムドメイン設定(aio.taskra.jp)
```

## デプロイ手順(Edge Function)

CLIを使わない前提の手順です。

1. Supabaseダッシュボード → 対象プロジェクト(`sfhtvtcmgueystyuhzvd`)を開く
2. 左メニュー「Edge Functions」→「Deploy a new function」
3. Function name に `aio-check` と入力
4. エディタに `supabase/aio-check/index.ts` の中身をそのまま貼り付けてデプロイ
5. 「Edge Functions」→「Secrets」で `ANTHROPIC_API_KEY` を登録(Claude APIキー)
6. デプロイ後に表示される Function URL が `index.html` 内の `SUPABASE_FUNCTION_URL` と一致しているか確認
7. Supabaseダッシュボード「Project Settings → API」の `anon public` キーをコピーし、`index.html` 内の `SUPABASE_ANON_KEY` に貼り付けて保存・再PUSH

`ANTHROPIC_API_KEY` が未設定の間も、構造データの取得・表示まではフロント単体で機能します(AI所見の部分のみ「利用できません」と表示されます)。

## 既知の注意点(オープン課題)

- Edge Functionは現状CORSを `*` で開放しています。個人利用前提ですが、想定外の呼び出しでAPI費用がかさむ可能性があるため、必要に応じて `Access-Control-Allow-Origin` を `https://aio.taskra.jp` に絞る、またはSupabase側でレート制限を検討してください。
- 対象サイトがJavaScriptでコンテンツを描画するSPAの場合、サーバー側fetchでは初期HTMLしか取得できず、構造データが実態と異なる可能性があります。
- 1回の診断でClaude APIを1回呼び出します(web_search込み)。継続的に使う場合はAnthropicコンソールでの利用量確認をおすすめします。
