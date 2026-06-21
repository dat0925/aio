# aio — AIOチェッカー

任意のURLを入力すると、「ChatGPTやGoogleのAI検索に紹介・引用されやすいページか」を実際に診断する単体ツールです。SiteMeister・CRMエージェントとの連携は前提にしていません。

アクセスコード(ハッシュ照合)による簡易認証付きです。第三者による無断利用・Claude API費用の不正消費を防ぐため、フロント・バックエンド両方でコードを検証しています。

## 公開URL

https://aio.taskra.jp

## 仕組み

```
[ index.html ]                      [ Cloudflare Worker: aio-check ]
  URLを入力
   → POST /structural ───────────▶   対象URLをサーバー側で取得(CORS回避)し、
                                      title/meta description/OGP/canonical/
                                      構造化データ(JSON-LD)/見出し構成を解析(10秒でタイムアウト)
   ◀── 構造データを即表示 ─────────
   → POST /ai (構造データを送信) ──▶   Claude API(web_search有効)で
                                      所見・推奨施策・競合文脈を生成(25秒でタイムアウト)
   ◀── AI所見を追記表示 ───────────
```

ページ取得とAI生成を1リクエストにまとめず2段階に分けているのは、モバイル回線等でタイムアウトすると「全部やり直し」になってしまうためです。構造データはすぐ表示し、AI所見は後から差し込みます。AIによる「実際の生成回答をそのまま見せる」演出はせず、構造的シグナル(FAQ構造化データの有無、メタ情報の整備度など)を軸に診断します。あわせてClaudeのweb_searchで実際に競合・比較記事の状況を確認し、所見に反映します。

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
5. Workerの「Settings → Variables and Secrets」で以下2つをSecretとして追加
   - `ANTHROPIC_API_KEY`(Claude APIキー)
   - `CHECKER_PIN_HASH`(アクセスコードのSHA-256ハッシュ。平文のコードは保存しない。値は`python3 -c "import hashlib;print(hashlib.sha256('コード'.encode()).hexdigest())"`等で算出)
6. 画面に表示されるWorker URL(例: `https://aio-check.あなたのサブドメイン.workers.dev`)をコピー
7. `index.html` 内の `WORKER_URL` をそのURLに書き換えて保存・再PUSH

`ANTHROPIC_API_KEY` が未設定の間も、構造データの取得・表示まではフロント単体で機能します(AI所見の部分のみ「利用できません」と表示されます)。

## 既知の注意点(オープン課題)

- Workerは現状CORSを `*` で開放しています。個人利用前提ですが、想定外の呼び出しでAPI費用がかさむ可能性があるため、必要に応じて `worker/index.js` 内の `ALLOWED_ORIGIN` を `https://aio.taskra.jp` に絞る、またはCloudflare側でレート制限(Rate Limiting Rules)の設定を検討してください。
- 対象サイトがJavaScriptでコンテンツを描画するSPAの場合、サーバー側fetchでは初期HTMLしか取得できず、構造データが実態と異なる可能性があります。
- 1回の診断でClaude APIを1回呼び出します(web_search込み)。継続的に使う場合はAnthropicコンソールでの利用量確認をおすすめします。
- Cloudflare Workersの無料枠は1日10万リクエストと潤沢ですが、Claude API側の費用は別途かかります。
