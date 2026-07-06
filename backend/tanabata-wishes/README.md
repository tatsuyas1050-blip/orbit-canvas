# 七夕短冊「みんなで共有」API

みんなが書いた短冊を全員で共有するための、公開の願い事ボードAPIです。
`tanabata.html` から呼び出されます。

## 構成

- **Lambda（Function URL / 認証なし）** — `index.mjs`
  - `GET /` … 全短冊を古い順で返す `{ wishes: [...] }`
  - `POST /` … 短冊を1件追加 `{text,name,color}` → `{ ok, wish }`
- **DynamoDB** — `orbit-canvas-tanabata-wishes`（オンデマンド課金）
  - `pk = "WISH#v1"`（単一パーティション）/ `sk = "<投稿時刻>#<id>"` で時系列に整列
- AWS SDK v3 は nodejs22.x ランタイム同梱のため **依存パッケージ・node_modules は不要**。

願い事はもともと公開して吊るすものなので、認証・承認は付けていません。
サーバ側で入力を検証します（本文60字・名前16字でカット、色は5色に限定、制御文字除去）。

## デプロイ

```bash
cd backend/tanabata-wishes
sam build
sam deploy            # 初回だけ対話。以降は samconfig.toml を使用
```

デプロイ後、出力の `WishApiUrl` をコピーします:

```bash
aws cloudformation describe-stacks \
  --stack-name orbit-canvas-tanabata --region ap-northeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='WishApiUrl'].OutputValue" --output text
```

その URL を **`tanabata.html` 冒頭の `WISHES_API` 定数**に貼り付けてください:

```js
const WISHES_API = "https://xxxxxxxx.lambda-url.ap-northeast-1.on.aws/";
```

- 空 `""` のままなら、フロントは自動的に「端末内保存（localStorage）」で動きます（共有はされません）。
- URL を入れると「みんなで共有」モードに切り替わります。

## 動作確認

```bash
API="https://xxxxxxxx.lambda-url.ap-northeast-1.on.aws/"
# 投稿
curl -s -X POST "$API" -H 'Content-Type: application/json' \
  -d '{"text":"みんなが健康でありますように","name":"テスト","color":"aka"}'
# 一覧
curl -s "$API"
```

## オプション

- **サイト限定にする**: `samconfig.toml` の `parameter_overrides` で
  `AllowOrigin=https://cosmos-connect.com` を指定して再デプロイ。
- **保持件数**: `MaxWishes`（既定1000＝竹 約83本）。GETで返す最大件数。
- **一定期間で消したい**: DynamoDB の TTL を使うなら、`index.mjs` の POST 時に
  `expireAt`（epoch秒）を入れてテーブルに TTL 属性を設定する。既定は無期限。

## 削除

```bash
sam delete --stack-name orbit-canvas-tanabata --region ap-northeast-1
```
