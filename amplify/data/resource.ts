import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

// イベント情報の「型」を定義します
const schema = a.schema({
  Event: a.model({
    title: a.string().required(),       // イベント名
    type: a.string().required(),        // タイプ (star または rocket)
    date: a.date().required(),          // 日付 (YYYY-MM-DD)
    time: a.string(),                   // 時間
    description: a.string(),            // 詳細
  })
  .authorization(allow => [
    // 誰でも閲覧可能(publicApiKey)、データ操作は管理画面から
    allow.publicApiKey(),
  ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'apiKey',
    apiKeyAuthorizationMode: {
      expiresInDays: 30,
    },
  },
});