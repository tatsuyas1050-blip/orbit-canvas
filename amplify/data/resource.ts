import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

// データベースの設計図（スキーマ）
const schema = a.schema({
  Event: a.model({
    title: a.string(),    // タイトル (例: ふたご座流星群)
    date: a.date(),       // 日付 (例: 2025-12-14)
    type: a.string(),     // 種類 (例: star, rocket)
    time: a.string(),     // 時間 (例: 22:00頃)
    desc: a.string(),     // 詳細説明
  })
  .authorization(allow => [allow.publicApiKey()]), // いったん誰でも読み書きOKに設定
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'apiKey',
    apiKeyAuthorizationMode: {
      expiresInDays: 30, // テスト用なので30日で切れる設定
    },
  },
});