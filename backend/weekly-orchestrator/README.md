# 週次オーケストレーター（Phase B）

星空アプリ orbit-canvas の「投稿・天文現象の更新が続く仕組み」の自動化部分です。
EventBridge が週1で Lambda を起動し、次の3つを実行します。

1. **天文現象の自動下書き** — 新月・満月・二至二分・主要流星群を計算し、不足分を `status:'draft'` で投入（星空情報局の手入力ゼロ化）
2. **開発日誌のAI下書き** — 直近のGitコミットを GitHub API で取得し、Claude が日誌の下書きを生成
3. **LINEリマインド** — コンテンツ鮮度を集計し「今週の一手」を自分にプッシュ通知

生成物はすべて **下書き（draft）** で止まります。公開は管理画面の「週次コックピット → 下書き受信箱」で〔公開〕を押したときだけ（承認制）。

---

## アーキテクチャ

```
EventBridge(週1) ─▶ Lambda（このコード）
                       ├─ GET_URL から現状取得
                       ├─ 天文現象を計算 → PUT_URL に draft 投入
                       ├─ GitHub API + Claude → PUT_URL に devlog draft 投入
                       └─ 鮮度集計 → LINE Bot push
```

DynamoDB には直接触れず、**admin と同じ `GET_URL`/`PUT_URL` をクライアントとして呼ぶ**疎結合方式です。

---

## 事前準備

### 1. LINE Messaging API（Bot）の用意
> ⚠️ かつての「LINE Notify」は2025/3/31で終了したため、Messaging API を使います。

1. [LINE Developers](https://developers.line.biz/) でプロバイダー → **Messaging API チャネル**を作成
2. チャネルの「Messaging API設定」で **チャネルアクセストークン（長期）** を発行 → `LineChannelAccessToken`
3. 表示されたQRから、その公式アカウントを**自分のLINEで友だち追加**
4. **自分のユーザーID（`Uxxxxxxxx...`）の取得方法**（どちらか）
   - Developersコンソールの「あなたのユーザーID」を確認、または
   - Webhookを一時的に有効化し、自分がBotに何か送ったときの `events[].source.userId` をログで確認
   → `LineUserId`

### 2. Claude APIキー
[Anthropic Console](https://console.anthropic.com/) で発行 → `AnthropicApiKey`

### 3. GitHub（任意トークン）
- パブリックリポジトリなら不要（未設定だとAPIレート制限が低い）
- 設定する場合は `Contents: Read` 権限の Fine-grained PAT → `GithubToken`

### 4. 既存の値
- `GetUrl` / `PutUrl` … admin.html の `GET_URL` / `PUT_URL` と同じ
- `PutPassword` … 書き込みAPIの合言葉（admin で入力しているパスワード）
- `AdminUrl` … 例 `https://<あなたのドメイン>/admin`

---

## デプロイ（AWS SAM）

[SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html) を使います。

```bash
cd backend/weekly-orchestrator
npm install
sam build
sam deploy --guided
```

`--guided` で各パラメータ（GetUrl, PutUrl, PutPassword, AnthropicApiKey, GithubRepo, LineChannelAccessToken, LineUserId, AdminUrl ...）を対話入力します。2回目以降は `sam deploy` だけでOK。

### スケジュール変更
既定は毎週月曜 08:00 JST。変えたい場合は `ScheduleExpression`（UTC・EventBridge cron）を渡します。
例: 毎週土曜 21:00 JST → `cron(0 12 ? * SAT *)`

---

## 動作テスト

デプロイ後、手動で1回だけ実行して確認できます。

```bash
aws lambda invoke --function-name orbit-canvas-weekly-orchestrator /tmp/out.json
cat /tmp/out.json   # {"ok":true,"astroAdded":N,"devlogAdded":N,"log":[...]}
```

成功すると LINE に通知が届き、管理画面の「下書き受信箱」に下書きが並びます。`log` にエラーが入っていれば内容を確認してください（LINE未設定なら通知だけスキップされ、下書き投入は実行されます）。

---

## 環境変数一覧

| 変数 | 必須 | 説明 |
|---|---|---|
| `GET_URL` | ✅ | データ取得Lambda URL |
| `PUT_URL` | ✅ | 書き込みLambda URL |
| `PUT_PASSWORD` | ✅ | 書き込みの合言葉 |
| `ANTHROPIC_API_KEY` | ✅ | Claude APIキー |
| `CLAUDE_MODEL` | - | 既定 `claude-sonnet-4-6`（高品質なら `claude-opus-4-8`） |
| `GITHUB_REPO` | ✅ | `owner/repo` |
| `GITHUB_TOKEN` | - | パブリックなら省略可 |
| `LINE_CHANNEL_ACCESS_TOKEN` | - | 未設定なら通知のみスキップ |
| `LINE_USER_ID` | - | 同上 |
| `ADMIN_URL` | - | 通知に載せる管理画面リンク |
| `WEEKS_AHEAD` | - | 何週先まで天文現象を仕込むか（既定8） |
| `DEVLOG_SINCE_DAYS` | - | 開発日誌の対象コミット期間（既定7日） |

---

## 注意・補足
- 天文現象は **計算で確定できるもの（新月・満月・二至二分・主要流星群）** のみ自動生成します。ロケット打上げや突発的な現象は対象外（従来どおり手動 or AI一括インポートで）。
- 流星群のピーク日は年により±1日ずれることがあります。下書きとして投入されるので、公開前に管理画面で微調整できます。
- 重複投入はしません（同じ日付に同じタイトルの星空イベントがあればスキップ）。
