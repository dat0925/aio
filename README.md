# aio — AIOチェッカー

任意のURLを入力すると、「ChatGPTやGoogleのAI検索に紹介・引用されやすいページか」を実際に診断する単体ツールです。SiteMeister・CRMエージェントとの連携は前提にしていません。

## 公開URL

https://aio.taskra.jp

## 仕組み

```
[ index.html ]                [ Cloudflare Worker: aio-check ]
  URLを入力 → POST  ────────▶   1. 対象URLをサーバー側で実際に取得(CORS回避)
                                2. title/meta description/OGP/canonical/
                                   構造化データ(JSON-LD)/見出し構成などを解析
                                3. Claude API(web_search有効)に構造情報+本文を渡し、
                                   平易な所見・推奨施策・競合文脈をJSONで生成
  結果を描画 ◀──────────────   4. 結果をJSONで返却
```

AIによる「実際の生成回答をそのまま見せる」演出はせず、構造的シグナル(FAQ構造化データの有無、メタ情報の整備度など)を軸に診断します。あわせてClaudeのweb_searchで実際に競合・比較記事の状況を確認し、所見に反映します。

DBは使っていません。サーバー側の処理が必要な理由は「CORS回避(ブラウザから直接よそのサイトを取得できないため)」と「APIキーの秘匿(フロントに書くと盗まれるため)」の2点のみです。

## ファイル構成

```
index.html              フロントエンド(単一HTMLファイル)
worker/index.js          Cloudflare Worker本体(Cloudflareダッシュボードに手動デプロイ)
archive/requirements-sitemeister-concept.md   旧:SiteMeister組み込み案の要件定義書(参考保管)
CNAME                    GitHub Pagesのカスタムドメイン設定(aio.taskra.jp)
```

## デプロイ手順(Cloudflare Worker)

CLIを使わない前提の手順です。

1. https://dash.cloudflare.com にログイン(アカウントがなければ無料で作成)
2. 左メニュー「Workers & Pages」→「Create」→「Create Worker」
3. 名前を `aio-check` などにして「Deploy」(まず空のWorkerを作成)
4. 作成後「Edit code」を開き、`worker/index.js` の中身をすべて貼り付けて「Deploy」
5. Workerの「Settings → Variables and Secrets」で `ANTHROPIC_API_KEY` をSecretとして追加(Claude APIキー)
6. 画面に表示されるWorker URL(例: `https://aio-check.あなたのサブドメイン.workers.dev`)をコピー
7. `index.html` 内の `WORKER_URL` をそのURLに書き換えて保存・再PUSH

`ANTHROPIC_API_KEY` が未設定の間も、構造データの取得・表示まではフロント単体で機能します(AI所見の部分のみ「利用できません」と表示されます)。

## 既知の注意点(オープン課題)

- Workerは現状CORSを `*` で開放しています。個人利用前提ですが、想定外の呼び出しでAPI費用がかさむ可能性があるため、必要に応じて `worker/index.js` 内の `ALLOWED_ORIGIN` を `https://aio.taskra.jp` に絞る、またはCloudflare側でレート制限(Rate Limiting Rules)の設定を検討してください。
- 対象サイトがJavaScriptでコンテンツを描画するSPAの場合、サーバー側fetchでは初期HTMLしか取得できず、構造データが実態と異なる可能性があります。
- 1回の診断でClaude APIを1回呼び出します(web_search込み)。継続的に使う場合はAnthropicコンソールでの利用量確認をおすすめします。
- Cloudflare Workersの無料枠は1日10万リクエストと潤沢ですが、Claude API側の費用は別途かかります。
