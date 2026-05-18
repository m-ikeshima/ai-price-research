# 📱 AI相場リサーチ (iPhone/iPad対応PWA)

iPhone/iPadのホーム画面に追加してアプリのように使える、AI画像認識＋複数マーケット横断検索の相場リサーチツールです。

**できること**

- カメラで商品を撮影 → AI（Claude/OpenAI）が自動で商品を識別
- ヤフオク!（落札相場）、Yahoo!フリマ、メルカリ、ラクマ、eBay、TikTok Shop を一括検索
- 最高/最低/平均/中央値 と価格帯分布をスマホ画面で一目で確認
- PWAなのでホーム画面追加で「アプリっぽく」起動

---

## 📦 ファイル構成

```
.
├── server.js              # Express サーバー (API + 静的配信)
├── package.json           # 依存関係
├── public/
│   ├── index.html         # PWA本体 (モバイル最適化UI)
│   ├── manifest.json      # PWAマニフェスト
│   ├── sw.js              # Service Worker
│   ├── icon.svg           # アプリアイコン (SVG)
│   ├── icon-192.png       # PWAアイコン (192×192)
│   └── icon-512.png       # PWAアイコン (512×512)
├── Dockerfile             # コンテナ定義
├── .dockerignore
├── render.yaml            # Render用デプロイ設定
├── fly.toml               # Fly.io用デプロイ設定
└── README.md
```

サーバーは **API (`/api/search`) と PWA（`/`）を同一URLで提供** します。クラウドにデプロイすればiPhone/iPadのSafariからアクセスして「ホーム画面に追加」できます。

---

## 🚀 クラウドにデプロイする

### 方法A: Render（最も簡単・無料）

1. このフォルダ一式をGitHubの新規リポジトリにpush
2. [render.com](https://render.com) にサインアップ
3. New + → Web Service → 作成したリポジトリを選択
4. `render.yaml` が自動検出されるので「Apply」を押すだけ
5. 数分待つと `https://ai-price-research.onrender.com` のようなURLが発行される

**注意**: Render の Free プランは15分非アクセスでスリープし、復帰に30〜60秒かかります。常用するなら有料プラン（$7/月〜）または下記Fly.ioを推奨。

### 方法B: Fly.io（東京リージョン・無料枠十分）

```bash
# Fly CLIをインストール (Macなら)
brew install flyctl

# ログイン
flyctl auth login

# 初回セットアップ (アプリ名は重複不可。fly.tomlのappを書き換え)
flyctl launch --no-deploy

# デプロイ
flyctl deploy
```

`https://<アプリ名>.fly.dev` でアクセス可能になります。

### 方法C: 自分のPCで起動（家のWi-Fi内のみ）

```bash
npm install
npm start
```

iPhoneを同じWi-Fiに繋いで `http://<MacのIP>:8787` でアクセス。
外出先からは使えませんが、家の中だけならこれで十分です。

---

## 📲 iPhone/iPadでアプリ化する手順

1. SafariでデプロイしたURLを開く
2. 下の **共有ボタン（□↑）** をタップ
3. **「ホーム画面に追加」** を選択
4. ホーム画面にアイコンが追加され、タップで全画面アプリとして起動

> ✨ PWAなので App Store の審査なしで「自分専用アプリ」として使えます。

---

## ⚙️ 初回設定

1. アプリを開いたら右上の **⚙️設定** を開く
2. **AI Vision プロバイダ** を選択
   - **Anthropic Claude** (推奨): [console.anthropic.com](https://console.anthropic.com/) でAPIキー取得
   - **OpenAI GPT-4o**: [platform.openai.com](https://platform.openai.com/api-keys) でAPIキー取得
   - **使用しない**: 手入力モード（無料）
3. APIキーを入力して **保存**

APIキーは端末のlocalStorageにのみ保存され、サーバーには送信されません。AnthropicやOpenAIへ直接呼び出されます。

---

## 📷 使い方

1. **📸カメラで撮影** または **🖼️写真ライブラリ** から商品画像をアップロード（複数枚OK・最大10枚）
2. **商品の状態** と **対象マーケット** を選択（商品の状態は識別精度向上の参考用）
3. **🤖 AIで識別** で検索キーワードを自動生成（必要なら手で編集）
4. **🔎 検索実行** で全マーケットを並列検索
5. 価格サマリ（平均/中央値/最高/最低）と価格帯分布、取引一覧が表示される
6. カードをタップすると元の取引ページが開く

---

## 📊 取得できる指標

| 指標 | 説明 |
|---|---|
| 平均価格 | 算術平均（±標準偏差） |
| 中央値 | 外れ値の影響を受けにくい代表値 |
| 最高価格 | このキーワードで最も高く取引された価格 |
| 最低価格 | 最も安く取引された価格 |
| 価格帯分布 | 6段階のヒストグラム |
| マーケット別件数 | 各サイトから何件取得できたか |

---

## 🛒 対応マーケット

| マーケット | 取得対象 | 方式 | 安定度 |
|---|---|---|---|
| ヤフオク! | 落札相場（過去取引） | HTMLスクレイピング | ◎ |
| Yahoo!フリマ | sold_out商品 | `__NEXT_DATA__` JSON抽出 | ○ |
| メルカリ | sold_out商品 | `__NEXT_DATA__` JSON抽出 | △ |
| ラクマ | soldout商品 | HTMLスクレイピング | ○ |
| eBay | Sold listings (USD→円換算) | HTMLスクレイピング | ○ |
| TikTok Shop | 現行価格 | 内部API (実験) | × |

---

## 🛠 ローカル開発

```bash
npm install
npm start
# http://localhost:8787 でアプリ＋APIの両方が起動
```

---

## ⚠️ 注意事項

- 各サイトの **利用規約・robots.txt** を順守してください。本ツールは個人の相場調査用の少量アクセスを想定しています。
- 商用転売目的の大量スクレイピング、データの再配布は行わないでください。
- 取得結果はあくまで参考値。実際の落札・販売を保証するものではありません。
- TikTok Shop は地域・規約上の制限が強く、空で返ることがあります。
- 為替レート（eBay）は固定値（1USD=155円）です。必要なら `server.js` の `* 155` を編集。
- スクレイピング先のHTML構造が変わると壊れます。動かない場合は `server.js` のセレクタを更新してください。

---

## 🔧 トラブルシューティング

| 症状 | 対処 |
|---|---|
| Renderのアクセスが遅い | 初回アクセスでスリープ復帰のため30秒待つ。常用ならFly.ioへ移行 |
| 「ホーム画面に追加」が出ない | Chromeでアクセスしている場合は **Safari** で開く |
| AI解析で401 | APIキー誤りか残高不足 |
| メルカリの件数が0 | サイト構造変更の可能性。`server.js` の `searchMercari` を調整 |
| HTTPSじゃないとPWA化されない | Render/Fly.ioは自動でHTTPS。ローカル時はPWA化はできない（機能は使える） |

---

## 📄 ライセンス

MIT 相当として自由に改変してご利用ください。
