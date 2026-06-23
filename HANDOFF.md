# HANDOFF.md — AIOチェッカー (dat0925/aio)

このファイルは、別のClaudeアカウント・新しい会話からでも続きの開発ができるようにするための引き継ぎ書です。新しい会話を始めるときは、まずこのファイルをリポジトリから読んでもらってください。

最終更新: 2026-06-20 23:50頃(セッション終了時点)

---

## 1. これは何か

「AIOチェッカー」— 任意のURLを入力すると、ChatGPTやGoogleのAI検索に紹介・引用されやすいページかを実際に診断するツール。個人開発。

**重要な経緯**: 当初はSiteMeister(勤務先の製品)やCRMエージェント(別途構想中の機能)に組み込む前提で設計していたが、「CRMエージェント自体がまだ何もできていないのに、それに依存した作りにするのは違和感がある」という判断で方針転換。**現在はSiteMeister・CRMエージェントとは完全に切り離した、スタンドアロンの個人ツール**として開発している。今後この前提を勝手に元に戻さないこと。

## 2. 全体構成

```
[ index.html (GitHub Pages) ]        [ Cloudflare Worker: aio-check ]
  https://aio.taskra.jp               https://aio-check.mstd0520.workers.dev
  URLを入力
   → POST /structural ─────────────▶  対象URLを取得・構造解析(10秒タイムアウト)
   ◀── 構造データを即表示 ──────────
   → POST /ai(構造データを送信)────▶  Claude API(web_search)で所見生成(25秒タイムアウト)
   ◀── AI所見を追記表示 ────────────
```

ページ取得とAI生成を2つのエンドポイントに分けているのは、1リクエストにまとめるとモバイル回線等でタイムアウトしやすく「全部やり直し」になってしまうため(実機検証で発覚)。

- DBは使っていない(不要)。サーバー処理が必要なのは「CORS回避」と「APIキー秘匿」の2点のみ。
- フロントは単一HTMLファイル(Vanilla JS)。バックエンドはCloudflare Worker 1本。

## 3. リポジトリ・公開先

| 項目 | 内容 |
|---|---|
| GitHubリポジトリ | https://github.com/dat0925/aio (public) |
| デフォルトブランチ | main |
| 公開URL(フロント) | https://aio.taskra.jp (GitHub Pages、CNAME設定済み、HTTPS証明書発行済み) |
| Cloudflare Worker名 | aio-check |
| Worker URL | https://aio-check.mstd0520.workers.dev |
| Cloudflareアカウント | Mstd0520@gmail.com |

リポジトリへのPUSHには、ユーザー(Masamune)からその都度GitHub PAT(個人アクセストークン)を受け取る運用。PATは作業完了後に失効される前提なので、新しい会話では必ず新しいPATを依頼すること。

## 4. ファイル構成

```
index.html                                 フロントエンド本体
worker/index.js                            Cloudflare Worker本体(ダッシュボードに手動デプロイするソース)
README.md                                  プロジェクト概要・デプロイ手順
HANDOFF.md                                 このファイル
CNAME                                      GitHub Pagesのカスタムドメイン設定(aio.taskra.jp)
archive/requirements-sitemeister-concept.md  旧:SiteMeister組み込み案の要件定義書(参考保管・現在は不採用方針)
```

## 5. 今回のセッションで完了していること

- [x] GitHubリポジトリ作成・PUSH、GitHub Pages有効化、カスタムドメイン(aio.taskra.jp)設定・HTTPS証明書発行
- [x] SiteMeister/CRMエージェント連携の撤去、スタンドアロン構成への全面書き換え
- [x] バックエンドをSupabase Edge FunctionsからCloudflare Workersへ移行(コードも書き換え済み)
- [x] Cloudflareダッシュボードで Worker(`aio-check`)を作成し、`worker/index.js` の中身を貼り付け済み
- [x] `index.html` の `WORKER_URL` を実際のWorker URL(`https://aio-check.mstd0520.workers.dev`)に更新・PUSH済み(本コミットで反映)
- [x] アクセスコード認証を追加(フロント: パスワード入力欄のゲート画面、桁数非表示。バックエンド: `X-Access-Hash`ヘッダーとSecret `CHECKER_PIN_HASH` の照合)。平文のアクセスコードはリポジトリ・ドキュメントのどこにも保存していない(ハッシュのみ)。
- [x] 動作確認中に判明した不具合への対応:
  - Safari/iPad環境で`workers.dev`への通信が失敗する事象が継続。web_search除去・モデルをclaude-haiku-4-5-20251001に変更・max_tokens 1024に削減し、Chrome環境での動作を確認(スコア52、要注意、所見・施策・競合文脈すべて正常表示)。Safari環境はコンテンツブロッカー等による`workers.dev`通信遮断の可能性が高い。
- [x] 診断結果をテキストでコピーするボタンを追加(AI所見表示後に出現、Markdown形式でクリップボードにコピー)

## 6. 現状と次の課題

**動作状況**: Chrome環境で正常動作確認済み。Safari(モバイル・iPad)では`workers.dev`ドメインへの通信が失敗する場合がある。

**Safari対策(やるなら)**:
- Cloudflareのドメイン設定で`aio.taskra.jp/api/*`をWorkerにルーティングする(Workers Route設定)
- これにより`workers.dev`ではなく独自ドメインで呼び出せるようになり、コンテンツブロッカーに引っかかりにくくなる

**その他の改善候補**:
- web_searchを使った競合情報の取得(有料プランのWorkerであれば時間制限が緩和される)
- 診断履歴の保存(現状はセッション内のみ)

## 7. 既知の注意点

- Worker(`worker/index.js`内)のCORSは現状 `ALLOWED_ORIGIN = "*"` で全開放。独自ドメインに切り替える際に `https://aio.taskra.jp` に絞ること。
- 対象サイトがJS描画のSPAの場合、サーバー側fetchでは初期HTMLしか取れず構造データが実態とズレる可能性がある。
- 1回の診断でClaude APIを1回呼ぶ(Haikuなので費用は小さい)。継続利用するならAnthropicコンソールでの利用量確認を。
- `archive/requirements-sitemeister-concept.md` は古い方針の名残。今後参照する必要がなくなれば削除してよい。

## 8. デザイン・コーディングの方針(踏襲してほしいこと)

- 単一HTMLファイル、Vanilla JS(フレームワーク不使用)。これまでの個人開発(Taskra/Flowra等)と同じ流儀。
- フォントは見出しに `Zen Old Mincho`、本文に `Zen Kaku Gothic New`(Google Fonts)。配色は暖色寄りのアースカラー(背景 `#EEF1EC`、アクセント `#BE5A3A`、状態色は良好`#4F7A5C`/要注意`#A97A24`/危険`#AD4A30`)。新しい画面を作る際もこのトークンを踏襲する。
- 専門用語を避け、平易な言葉で結果を伝えるという設計方針は維持すること(これは当初SiteMeister向けに立てた方針だが、個人ツールとしても引き続き有効な方針として残している)。
- CLIは使わない前提。GitHubはPAT経由のPUSH、CloudflareはAIさん側からは直接操作できないため、コードを渡してユーザーがダッシュボードで手動デプロイする運用(Supabase Edge Functionsのときと同じ流儀)。
