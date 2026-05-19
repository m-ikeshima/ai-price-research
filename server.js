/**
 * AI相場リサーチツール - ローカルプロキシサーバー
 *
 * 役割:
 *   ブラウザのCORS制約を回避し、各マーケットの検索結果を取得して
 *   正規化したJSONとして返す。
 *
 * 起動:
 *   npm install
 *   node server.js
 *
 * エンドポイント:
 *   GET /api/search?market=<id>&q=<keyword>&exclude=<word>&condition=<id>
 *
 * 注意:
 *   各マーケットの利用規約・robots.txtを順守してください。
 *   過度な負荷をかけないよう、リクエスト間隔・件数制限を設けています。
 *   個人的な調査の範囲で利用し、商用利用や大量スクレイピングは避けてください。
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors());
app.use(express.json());

// PWA静的ファイル配信（index.html, manifest.json, sw.js, アイコン等）
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js')) {
      // Service Worker は Service-Worker-Allowed と no-cache が必要
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// 共通ヘッダ（ブラウザに見せかける）
const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
};

const MAX_ITEMS = 50; // メルカリは ×2 で最大100件

// ====== ユーティリティ ======
function parsePriceJP(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, '').match(/(\d+)\s*円/);
  if (m) return parseInt(m[1], 10);
  const m2 = String(text).replace(/[,¥￥\s]/g, '').match(/^(\d+)/);
  return m2 ? parseInt(m2[1], 10) : null;
}

function applyExclude(items, excludeStr) {
  if (!excludeStr) return items;
  const words = excludeStr.split(/\s+/).filter(Boolean);
  return items.filter(it => !words.some(w => (it.title || '').toLowerCase().includes(w.toLowerCase())));
}

// ブランド名の別表記マップ（カタカナ⇔英語、部分マッチも考慮）
const BRAND_ALIASES = {
  'ルイヴィトン': ['ルイヴィトン', 'ルイ・ヴィトン', 'ヴィトン', 'louis vuitton', 'louisvuitton', 'lv'],
  'シャネル': ['シャネル', 'chanel'],
  'グッチ': ['グッチ', 'gucci'],
  'エルメス': ['エルメス', 'hermes', 'hermès'],
  'プラダ': ['プラダ', 'prada'],
  'ディオール': ['ディオール', 'dior'],
  'コーチ': ['コーチ', 'coach'],
  'バレンシアガ': ['バレンシアガ', 'balenciaga'],
  'セリーヌ': ['セリーヌ', 'celine'],
  'フェンディ': ['フェンディ', 'fendi'],
  'バーバリー': ['バーバリー', 'burberry'],
  'ボッテガヴェネタ': ['ボッテガヴェネタ', 'ボッテガ・ヴェネタ', 'ボッテガ', 'bottega veneta', 'bottegaveneta', 'bottega'],
  'サンローラン': ['サンローラン', 'saint laurent', 'ysl'],
  'ベルルッティ': ['ベルルッティ', 'berluti'],
  'トッズ': ['トッズ', 'tod\'s', 'tods'],
  'ロエベ': ['ロエベ', 'loewe'],
  'バレンチノ': ['バレンチノ', 'バレンチノ・ガラヴァーニ', 'valentino'],
  'ジバンシイ': ['ジバンシィ', 'ジバンシー', 'ジバンシイ', 'givenchy'],
  'マイケルコース': ['マイケルコース', 'マイケル・コース', 'michael kors'],
  'ティファニー': ['ティファニー', 'tiffany'],
  'カルティエ': ['カルティエ', 'cartier'],
  'ブルガリ': ['ブルガリ', 'bvlgari', 'bulgari'],
  'グランドセイコー': ['グランドセイコー', 'grand seiko', 'gs'],
  'タグホイヤー': ['タグホイヤー', 'タグ・ホイヤー', 'tag heuer'],
  'パテックフィリップ': ['パテックフィリップ', 'patek philippe'],
  'オーデマピゲ': ['オーデマピゲ', 'audemars piguet', 'ap'],
  'ヴァシュロンコンスタンタン': ['ヴァシュロンコンスタンタン', 'vacheron constantin'],
  'ガーミン': ['ガーミン', 'garmin'],
  'スント': ['スント', 'suunto'],
  'ヤマハ': ['ヤマハ', 'yamaha'],
  'ローランド': ['ローランド', 'roland'],
  'コルグ': ['コルグ', 'korg'],
  'マーシャル': ['マーシャル', 'marshall'],
  'フェンダー': ['フェンダー', 'fender'],
  'ギブソン': ['ギブソン', 'gibson'],
  'ボーズ': ['ボーズ', 'bose'],
  'jbl': ['jbl', 'ジェービーエル'],
  'ゼンハイザー': ['ゼンハイザー', 'sennheiser'],
  'シュアー': ['シュアー', 'shure'],
  'ベイリス': ['ベイリス', 'baileys'],
  'ダイソン': ['ダイソン', 'dyson'],
  'バルミューダ': ['バルミューダ', 'balmuda'],
  'デロンギ': ['デロンギ', 'delonghi'],
  'ネスプレッソ': ['ネスプレッソ', 'nespresso'],
  // ===== 自動車メーカー =====
  'トヨタ': ['トヨタ', 'toyota', 'lexus', 'レクサス'],
  'ホンダ': ['ホンダ', 'honda', 'acura', 'アキュラ'],
  '日産': ['日産', 'ニッサン', 'nissan', 'infiniti', 'インフィニティ'],
  'マツダ': ['マツダ', 'mazda'],
  'スバル': ['スバル', 'subaru'],
  'スズキ': ['スズキ', 'suzuki'],
  'ダイハツ': ['ダイハツ', 'daihatsu'],
  'いすゞ': ['いすゞ', 'isuzu'],
  'ミツビシ': ['ミツビシ', '三菱', 'mitsubishi'],
  'BMW': ['bmw', 'ビーエムダブリュー'],
  'メルセデス': ['メルセデス', 'ベンツ', 'mercedes', 'mercedes-benz', 'benz'],
  'アウディ': ['アウディ', 'audi'],
  'フォルクスワーゲン': ['フォルクスワーゲン', 'volkswagen', 'vw'],
  'ポルシェ': ['ポルシェ', 'porsche'],
  'フェラーリ': ['フェラーリ', 'ferrari'],
  'ランボルギーニ': ['ランボルギーニ', 'lamborghini'],
  'マセラティ': ['マセラティ', 'maserati'],
  'アストンマーチン': ['アストンマーチン', 'aston martin'],
  'ベントレー': ['ベントレー', 'bentley'],
  'ロールスロイス': ['ロールスロイス', 'rolls-royce', 'rolls royce'],
  'ジャガー': ['ジャガー', 'jaguar'],
  'ランドローバー': ['ランドローバー', 'land rover', 'レンジローバー', 'range rover'],
  'ボルボ': ['ボルボ', 'volvo'],
  'プジョー': ['プジョー', 'peugeot'],
  'シトロエン': ['シトロエン', 'citroen'],
  'ルノー': ['ルノー', 'renault'],
  'フィアット': ['フィアット', 'fiat'],
  'アルファロメオ': ['アルファロメオ', 'alfa romeo', 'alfaromeo'],
  'テスラ': ['テスラ', 'tesla'],
  'フォード': ['フォード', 'ford'],
  'シボレー': ['シボレー', 'chevrolet'],
  'キャデラック': ['キャデラック', 'cadillac'],
  // ===== バイクメーカー =====
  'カワサキ': ['カワサキ', 'kawasaki'],
  'ハーレーダビッドソン': ['ハーレー', 'ハーレーダビッドソン', 'harley', 'harley-davidson', 'harley davidson'],
  'ドゥカティ': ['ドゥカティ', 'ducati'],
  'トライアンフ': ['トライアンフ', 'triumph'],
  'KTM': ['ktm', 'ケーティーエム'],
  'ベスパ': ['ベスパ', 'vespa'],
  // ===== 古銭・コレクター系（時代名） =====
  '明治': ['明治', 'meiji'],
  '大正': ['大正', 'taisho'],
  '昭和': ['昭和', 'showa'],
  '平成': ['平成', 'heisei'],
  '令和': ['令和', 'reiwa'],
  '一円銀貨': ['一円銀貨', '1円銀貨', '銀貨'],
  '五十銭': ['五十銭', '50銭'],
  '十円玉': ['十円', '10円玉'],
  // ===== カメラ =====
  'ライカ': ['ライカ', 'leica'],
  'ハッセルブラッド': ['ハッセルブラッド', 'hasselblad'],
  'マミヤ': ['マミヤ', 'mamiya'],
  'ペンタックス': ['ペンタックス', 'pentax'],
  'シグマ': ['シグマ', 'sigma'],
  'タムロン': ['タムロン', 'tamron'],
  'ゴープロ': ['ゴープロ', 'gopro'],
  'DJI': ['dji', 'ディージェイアイ'],
  // ===== トレカ =====
  'ポケモン': ['ポケモン', 'ポケモンカード', 'pokemon'],
  '遊戯王': ['遊戯王', 'yu-gi-oh', 'yugioh'],
  'マジック': ['マジック', 'mtg', 'magic the gathering'],
  'デュエルマスターズ': ['デュエルマスターズ', 'デュエマ'],
  'ワンピース': ['ワンピース', 'one piece', 'onepiece'],
  // ===== ゲーム =====
  'プレイステーション': ['プレイステーション', 'プレステ', 'playstation', 'ps5', 'ps4', 'ps3', 'ps2', 'psp', 'psv'],
  'エックスボックス': ['エックスボックス', 'xbox'],
  // ===== 楽器 =====
  'スタインウェイ': ['スタインウェイ', 'steinway'],
  'カワイ': ['カワイ', 'kawai'],
  'ベーゼンドルファー': ['ベーゼンドルファー', 'bosendorfer'],
  'マーチン': ['マーチン', 'マーティン', 'martin'],
  'テイラー': ['テイラー', 'taylor'],
  'リッケンバッカー': ['リッケンバッカー', 'rickenbacker'],
  // ===== 工具 =====
  'マキタ': ['マキタ', 'makita'],
  'ハイコーキ': ['ハイコーキ', 'hikoki', 'hitachi koki'],
  'ボッシュ': ['ボッシュ', 'bosch'],
  'ミルウォーキー': ['ミルウォーキー', 'milwaukee'],
  'デウォルト': ['デウォルト', 'dewalt'],
  'ヒルティ': ['ヒルティ', 'hilti'],
  'リョービ': ['リョービ', 'ryobi'],
  // ===== コスメ =====
  'sk2': ['sk2', 'sk-ii', 'エスケーツー'],
  'ランコム': ['ランコム', 'lancome'],
  'エスティローダー': ['エスティローダー', 'estee lauder'],
  'ヘレナルビンスタイン': ['ヘレナルビンスタイン', 'helena rubinstein'],
  'クレドポーボーテ': ['クレドポーボーテ', 'cle de peau'],
  'シスレー': ['シスレー', 'sisley'],
  'ラプレリー': ['ラプレリー', 'la prairie'],
  // ===== 酒類 =====
  '山崎': ['山崎', 'yamazaki'],
  '響': ['響', 'hibiki'],
  '白州': ['白州', 'hakushu'],
  '余市': ['余市', 'yoichi'],
  '宮城峡': ['宮城峡', 'miyagikyo'],
  'マッカラン': ['マッカラン', 'macallan'],
  'グレンフィディック': ['グレンフィディック', 'glenfiddich'],
  'ヘネシー': ['ヘネシー', 'hennessy'],
  'レミーマルタン': ['レミーマルタン', 'remy martin'],
  'ドンペリ': ['ドンペリ', 'ドンペリニヨン', 'dom perignon'],
  // ===== 万年筆・筆記具 =====
  'モンブラン': ['モンブラン', 'montblanc'],
  'パーカー': ['パーカー', 'parker'],
  'ペリカン': ['ペリカン', 'pelikan'],
  'ウォーターマン': ['ウォーターマン', 'waterman'],
  'ラミー': ['ラミー', 'lamy'],
  'カランダッシュ': ['カランダッシュ', 'caran d\'ache'],
  'クロス': ['クロス', 'cross'],
  // ===== ライター =====
  'デュポン': ['デュポン', 'dupont', 's.t.dupont'],
  'ジッポー': ['ジッポー', 'zippo'],
  // ===== 家具・インテリア =====
  'カリモク': ['カリモク', 'karimoku'],
  'マルニ': ['マルニ木工', 'maruni'],
  'アクタス': ['アクタス', 'actus'],
  'コンランショップ': ['コンランショップ', 'conran shop'],
  'イデー': ['イデー', 'idee'],
  'ボーコンセプト': ['ボーコンセプト', 'boconcept'],
  'ハーマンミラー': ['ハーマンミラー', 'herman miller'],
  'ヴィトラ': ['ヴィトラ', 'vitra'],
  'カッシーナ': ['カッシーナ', 'cassina'],
  // ===== 着物 =====
  '加賀友禅': ['加賀友禅'],
  '京友禅': ['京友禅'],
  '大島紬': ['大島紬'],
  '結城紬': ['結城紬'],
  // ===== 自転車 =====
  'シマノ': ['シマノ', 'shimano'],
  'カンパニョーロ': ['カンパニョーロ', 'campagnolo'],
  'スラム': ['スラム', 'sram'],
  'トレック': ['トレック', 'trek'],
  'スペシャライズド': ['スペシャライズド', 'specialized'],
  'キャノンデール': ['キャノンデール', 'cannondale'],
  'ジャイアント': ['ジャイアント', 'giant'],
  'ピナレロ': ['ピナレロ', 'pinarello'],
  'コルナゴ': ['コルナゴ', 'colnago'],
  'ビアンキ': ['ビアンキ', 'bianchi'],
  // ===== 貴金属 =====
  '金地金': ['金地金', 'ゴールドバー', 'gold bar'],
  '銀地金': ['銀地金', 'シルバーバー', 'silver bar'],
  '田中貴金属': ['田中貴金属', 'tanaka'],
  'ナイキ': ['ナイキ', 'nike'],
  'アディダス': ['アディダス', 'adidas'],
  'プーマ': ['プーマ', 'puma'],
  'ニューバランス': ['ニューバランス', 'new balance', 'newbalance', 'nb'],
  'コンバース': ['コンバース', 'converse'],
  'バンズ': ['バンズ', 'vans'],
  'アップル': ['アップル', 'apple', 'iphone', 'ipad', 'macbook', 'imac', 'airpods'],
  'iphone': ['iphone', 'アイフォン', 'アップル', 'apple'],
  'ipad': ['ipad', 'アイパッド', 'アップル', 'apple'],
  'ソニー': ['ソニー', 'sony'],
  'パナソニック': ['パナソニック', 'panasonic'],
  'シャープ': ['シャープ', 'sharp'],
  'ニコン': ['ニコン', 'nikon'],
  'キヤノン': ['キヤノン', 'キャノン', 'canon'],
  'オリンパス': ['オリンパス', 'olympus', 'om system'],
  'フジフィルム': ['フジフィルム', 'fujifilm', 'fuji'],
  'ロレックス': ['ロレックス', 'rolex'],
  'オメガ': ['オメガ', 'omega'],
  'カシオ': ['カシオ', 'casio'],
  'セイコー': ['セイコー', 'seiko'],
  'シチズン': ['シチズン', 'citizen'],
  'ニンテンドー': ['ニンテンドー', 'nintendo', '任天堂', 'switch', 'スイッチ'],
};

function aliasesFor(word) {
  if (!word) return [];
  const lower = word.toLowerCase();
  // 完全一致
  if (BRAND_ALIASES[word]) return BRAND_ALIASES[word];
  if (BRAND_ALIASES[lower]) return BRAND_ALIASES[lower];
  // 大文字小文字無視で値内検索
  for (const [k, v] of Object.entries(BRAND_ALIASES)) {
    if (v.some(a => a.toLowerCase() === lower)) return v;
  }
  return [word];
}

// カテゴリ別フィルタ設定
// strict: 厳しめ（ブランド辞書ベース）
// loose: 緩め（多語マッチ、2語以上ヒットでOK）
// minimal: 最小限（1語ヒットでOK）
const CATEGORY_FILTER_MODE = {
  fashion: 'strict', watch: 'strict', jewelry: 'strict',
  electronics: 'strict', camera: 'strict', cosmetic: 'strict',
  instrument: 'strict', tool: 'strict',
  // 緩めにすべきカテゴリ
  car: 'loose', bike: 'loose', game: 'loose', toy: 'loose',
  card: 'loose', book: 'loose', media: 'loose', sports: 'loose',
  pen_writing: 'strict', lighter: 'strict', furniture: 'strict',
  food_drink: 'loose', precious_metal: 'loose',
  // 最小限フィルタにすべきカテゴリ
  coin: 'minimal', stamp: 'minimal', antique: 'minimal',
  art: 'minimal', military: 'minimal', doll: 'minimal',
  bicycle_parts: 'loose', kimono: 'minimal', other: 'minimal',
};

// ノイズ語（フィルタ判定から除外する）
const STOPWORDS = new Set([
  '中古', '美品', '極美品', '新品', '未使用', '正規品', '本物', '純正',
  '送料無料', '値下げ', '即決', '訳あり', 'まとめ売り',
  'used', 'new', 'sale', 'set'
]);

// 関連性フィルタ: カテゴリ別に動的に調整
function relevanceFilter(items, query, category) {
  if (!query || items.length === 0) return items;
  const words = query.trim().split(/[\s　]+/)
    .filter(w => w.length >= 2 && !STOPWORDS.has(w.toLowerCase()));
  if (words.length === 0) return items;

  const mode = CATEGORY_FILTER_MODE[category] || 'loose';
  console.log(`  関連性フィルタ: カテゴリ="${category||'未指定'}" mode=${mode}`);

  // 全キーワードのエイリアスを集める
  const wordAliases = words.map(w => ({
    word: w.toLowerCase(),
    aliases: aliasesFor(w).map(a => a.toLowerCase())
  }));

  const titleMatch = (title, alias) => title.includes(alias);

  const filtered = items.filter(it => {
    const title = (it.title || '').toLowerCase();
    if (mode === 'strict') {
      // 1単語目（ブランド）が必ず含まれる
      const brand = wordAliases[0];
      return brand.aliases.some(a => titleMatch(title, a));
    } else if (mode === 'loose') {
      // キーワードのうち2つ以上が含まれる（少なければ1つ）
      const need = Math.min(2, words.length);
      let hit = 0;
      for (const w of wordAliases) {
        if (w.aliases.some(a => titleMatch(title, a))) {
          hit++;
          if (hit >= need) return true;
        }
      }
      return false;
    } else {
      // minimal: 1つでも含まれていればOK
      for (const w of wordAliases) {
        if (w.aliases.some(a => titleMatch(title, a))) return true;
      }
      return false;
    }
  });

  // フィルタ後に件数が0、または極端に減った（10%未満になった）場合、フィルタを無効化
  if (filtered.length === 0) {
    console.log(`  フィルタ無効化: 0件になったため元の${items.length}件を返却`);
    return items;
  }
  if (items.length >= 5 && filtered.length / items.length < 0.1) {
    console.log(`  フィルタ無効化: 件数が極端に減少 (${items.length}→${filtered.length})`);
    return items;
  }
  console.log(`  関連性フィルタ結果: ${items.length} → ${filtered.length} 件`);
  return filtered;
}

// 画像URLを多様な属性から抽出（遅延読み込み対応＋プレースホルダ除外）
function extractImageUrl($el) {
  if (!$el || $el.length === 0) return null;
  const imgEl = $el.is('img') ? $el : $el.find('img').first();
  if (imgEl.length === 0) return null;
  // 試す属性（遅延読み込み系を優先）
  const attrs = [
    'data-original', 'data-lazy-src', 'data-lazy', 'data-src',
    'data-source', 'data-load-src', 'data-actualsrc', 'data-image', 'srcset', 'src'
  ];
  for (const a of attrs) {
    let v = imgEl.attr(a);
    if (!v) continue;
    // srcset 形式は最初のURLだけ取る
    if (a === 'srcset' && v.includes(' ')) v = v.split(',')[0].trim().split(' ')[0];
    // データURIや空白除外
    if (/^data:/i.test(v)) continue;
    // 1x1透明画像などのプレースホルダを除外
    if (/(blank|spacer|placeholder|loading|1x1|transparent|noimage|no_image)/i.test(v)) continue;
    // 相対パス対応
    if (v.startsWith('//')) v = 'https:' + v;
    if (/^https?:\/\//i.test(v)) return v;
  }
  return null;
}

async function fetchHtml(url, opts = {}) {
  const res = await axios.get(url, {
    headers: { ...COMMON_HEADERS, ...(opts.headers || {}) },
    responseType: 'arraybuffer',
    timeout: 15000,
    validateStatus: () => true,
    ...opts,
  });
  if (res.status >= 400) throw new Error(`HTTP ${res.status} - ${url}`);
  const ctype = res.headers['content-type'] || '';
  // 文字コード判定
  let enc = 'utf-8';
  const m = ctype.match(/charset=([^;]+)/i);
  if (m) enc = m[1].toLowerCase();
  if (/shift_jis|sjis|x-sjis/i.test(enc)) enc = 'shift_jis';
  if (/euc-jp/i.test(enc)) enc = 'euc-jp';
  return iconv.decode(Buffer.from(res.data), enc);
}

// ====== ヤフオク! 落札相場 ======
async function searchYahooAuction(q, exclude) {
  const url = `https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${encodeURIComponent(q)}&va=${encodeURIComponent(q)}&b=1&n=50`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const items = [];

  // 戦略1: 商品コンテナを多様なセレクタで探す
  const selectors = [
    'li.Product',
    'div.Product',
    '.Product',
    'li.Tile',
    '.Tile',
    '[class*="Result__item"]',
    '[class*="Product"][class*="item"]',
    'li[class*="Product"]',
    'div[class*="Product"]',
  ];
  let $products = $();
  for (const sel of selectors) {
    $products = $(sel);
    if ($products.length > 0) {
      console.log(`  Yahoo Auction: matched ${$products.length} with "${sel}"`);
      break;
    }
  }

  // 戦略2: フォールバック - /auction/ リンクを直接探す
  if ($products.length === 0) {
    console.log('  Yahoo Auction: fallback to /auction/ link extraction');
    $('a[href*="/auction/"]').each((_, el) => {
      const $a = $(el);
      const $row = $a.closest('li, div');
      if ($row.length === 0) return;
      let href = $a.attr('href') || '';
      if (href.startsWith('/')) href = 'https://auctions.yahoo.co.jp' + href;
      const title = ($a.text() || $a.attr('title') || $a.find('img').attr('alt') || '').trim();
      const priceText = $row.text().match(/¥?\s*([\d,]+)\s*円/)?.[0] || $row.find('[class*=rice]').first().text();
      const price = parsePriceJP(priceText);
      const image = extractImageUrl($row);
      if (title && price && title.length > 3) {
        items.push({ title, price, url: href, image, sold: true, condition: null, sold_date: null });
      }
    });
    return dedupByUrl(items).slice(0, MAX_ITEMS);
  }

  $products.each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find('a[href*="/auction/"], .Product__title a, .Product__titleLink, [class*="title"] a').first();
    let title = (titleEl.text() || titleEl.attr('title') || '').trim();
    let href = titleEl.attr('href') || '';
    if (href && href.startsWith('/')) href = 'https://auctions.yahoo.co.jp' + href;

    const priceText =
      $el.find('.Product__priceValue').first().text() ||
      $el.find('.Product__price').first().text() ||
      $el.find('[class*=price]').first().text() ||
      $el.text().match(/¥?\s*([\d,]+)\s*円/)?.[0];
    const price = parsePriceJP(priceText);

    const date = $el.find('.Product__time, .Product__date, [class*="time"]').first().text().trim();
    const image = extractImageUrl($el);

    if (title && price) {
      items.push({
        title, price, url: href, image,
        sold_date: date || null, sold: true, condition: null,
      });
    }
  });

  return dedupByUrl(items).slice(0, MAX_ITEMS);
}

function dedupByUrl(items) {
  const seen = new Set();
  return items.filter(it => {
    if (!it.url || seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });
}

// ====== Yahoo!フリマ (PayPayフリマ) ======
async function searchPayPayFlea(q, exclude) {
  // 売却済みのみフィルタするURL
  const url = `https://paypayfleamarket.yahoo.co.jp/search/${encodeURIComponent(q)}?sort=ranking&order=desc&itemStatus=sold_out`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const items = [];

  // PayPayフリマはNext.jsで __NEXT_DATA__ にJSONが入っている
  const next = $('#__NEXT_DATA__').html();
  if (next) {
    try {
      const data = JSON.parse(next);
      // 構造: props.pageProps.initialState.search.items など
      const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(walk); return; }
        if (obj.id && obj.name && obj.price && (obj.itemStatus || obj.status)) {
          // サムネイル抽出（PayPayフリマ各種パターン）
          let image = null;
          if (Array.isArray(obj.thumbnails) && obj.thumbnails.length > 0) {
            image = typeof obj.thumbnails[0] === 'string' ? obj.thumbnails[0] : (obj.thumbnails[0].url || null);
          } else if (obj.thumbnail) {
            image = typeof obj.thumbnail === 'string' ? obj.thumbnail : (obj.thumbnail.url || null);
          } else if (Array.isArray(obj.images) && obj.images.length > 0) {
            image = typeof obj.images[0] === 'string' ? obj.images[0] : (obj.images[0].url || null);
          }
          items.push({
            title: obj.name,
            price: parseInt(obj.price, 10),
            url: `https://paypayfleamarket.yahoo.co.jp/item/${obj.id}`,
            image,
            sold: (obj.itemStatus === 'sold_out' || obj.status === 'sold_out' || obj.status === 'completed'),
            condition: obj.itemCondition || obj.condition || null,
            sold_date: obj.completedAt || obj.soldAt || null,
          });
        }
        for (const k in obj) walk(obj[k]);
      };
      walk(data);
    } catch (e) { /* ignore */ }
  }

  // 重複削除
  const seen = new Set();
  const dedup = items.filter(it => {
    if (seen.has(it.url)) return false;
    seen.add(it.url);
    return it.sold;
  });
  return dedup.slice(0, MAX_ITEMS);
}

// ====== メルカリ（最重要指標：強化版） ======
async function searchMercari(q, exclude) {
  // 戦略: 売却済み + 出品中の両方を取得して、買取査定に必要な「実売価格」と「現行販売価格」の両方を提供
  const headers = {
    'Referer': 'https://jp.mercari.com/',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
  };

  // 売却済みと出品中の両方を並列取得
  const soldUrl = `https://jp.mercari.com/search?keyword=${encodeURIComponent(q)}&status=sold_out&order=desc&sort=created_time`;
  const liveUrl = `https://jp.mercari.com/search?keyword=${encodeURIComponent(q)}&status=on_sale&order=desc&sort=created_time`;

  const [soldItems, liveItems] = await Promise.all([
    fetchMercariPage(soldUrl, headers, true),
    fetchMercariPage(liveUrl, headers, false),
  ]);

  const all = [...soldItems, ...liveItems];
  return dedupByUrl(all).slice(0, MAX_ITEMS * 2); // メルカリは件数多めに
}

async function fetchMercariPage(url, headers, expectSold) {
  try {
    const html = await fetchHtml(url, { headers });
    const $ = cheerio.load(html);
    const items = [];

    // 戦略1: __NEXT_DATA__ からJSON抽出（最も信頼性高い）
    const next = $('#__NEXT_DATA__').html();
    if (next) {
      try {
        const data = JSON.parse(next);
        extractMercariItemsFromJson(data, items, expectSold);
      } catch (e) {
        console.warn('  Mercari __NEXT_DATA__ parse error:', e.message);
      }
    }

    // 戦略2: itemId属性を持つ要素から抽出
    if (items.length === 0) {
      $('[data-testid*="item"], li[id*="item"], a[href^="/item/"]').each((_, el) => {
        const $el = $(el);
        const $link = $el.is('a') ? $el : $el.find('a[href^="/item/"]').first();
        const href = $link.attr('href');
        if (!href) return;
        const fullUrl = href.startsWith('http') ? href : 'https://jp.mercari.com' + href;
        const img = $el.find('img').first();
        const title = $el.attr('aria-label') || $link.attr('aria-label') || img.attr('alt') || $el.find('[class*="name"], [class*="title"]').first().text() || '';
        const image = extractImageUrl($el);
        const priceText = $el.find('[class*=price], mer-price, [data-testid*="price"]').first().text() ||
                          $el.text().match(/¥\s*([\d,]+)/)?.[0] || '';
        const price = parsePriceJP(priceText);
        const isSoldVisible = $el.text().includes('SOLD') || $el.find('[class*="sold"], .item-sold-out-badge').length > 0;
        if (title && price) {
          items.push({
            title: title.trim().slice(0, 120), price, url: fullUrl, image,
            sold: expectSold || isSoldVisible, condition: null, sold_date: null,
          });
        }
      });
    }

    return items;
  } catch (e) {
    console.error('  Mercari fetch error:', e.message);
    return [];
  }
}

// __NEXT_DATA__ から再帰的にメルカリ商品を抽出（複数の構造パターンに対応）
function extractMercariItemsFromJson(data, items, defaultSold) {
  const visited = new WeakSet();
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (visited.has(obj)) return;
    visited.add(obj);
    if (Array.isArray(obj)) { obj.forEach(walk); return; }

    // メルカリ商品オブジェクトの特徴判定（パターンA: id+name+price+status）
    const isItemA = obj.id && (obj.name || obj.productName) && obj.price !== undefined &&
      (obj.status || obj.itemStatus || obj.itemConditionId || obj.itemConditionName);

    // パターンB: itemId+itemName
    const isItemB = (obj.itemId || obj.item_id) && (obj.itemName || obj.item_name || obj.name) && (obj.price !== undefined || obj.itemPrice !== undefined);

    if (isItemA || isItemB) {
      const id = obj.id || obj.itemId || obj.item_id;
      const name = obj.name || obj.itemName || obj.item_name || obj.productName;
      const price = parseInt(obj.price || obj.itemPrice || 0, 10);
      let image = null;
      if (Array.isArray(obj.thumbnails) && obj.thumbnails.length > 0) {
        image = typeof obj.thumbnails[0] === 'string' ? obj.thumbnails[0] : (obj.thumbnails[0].url || obj.thumbnails[0].uri || null);
      } else if (obj.thumbnail) {
        image = typeof obj.thumbnail === 'string' ? obj.thumbnail : (obj.thumbnail.url || obj.thumbnail.uri || null);
      } else if (obj.imageUrl || obj.image_url) {
        image = obj.imageUrl || obj.image_url;
      } else if (Array.isArray(obj.photos) && obj.photos.length > 0) {
        image = obj.photos[0].uri || obj.photos[0].url || obj.photos[0];
      } else if (Array.isArray(obj.images) && obj.images.length > 0) {
        image = obj.images[0].uri || obj.images[0].url || obj.images[0];
      }

      const status = obj.status || obj.itemStatus || '';
      const isSold = status === 'sold_out' || status === 'sold' || status === 'completed' || defaultSold;

      if (name && price > 0) {
        items.push({
          title: String(name).slice(0, 120),
          price,
          url: `https://jp.mercari.com/item/${id}`,
          image,
          sold: isSold,
          condition: obj.itemConditionName || obj.item_condition_name || obj.condition || null,
          sold_date: obj.updated || obj.updatedAt || obj.completedAt || null,
        });
      }
    }

    for (const k in obj) {
      try { walk(obj[k]); } catch (e) { /* ignore circular */ }
    }
  };
  walk(data);
}

// ====== ラクマ ======
async function searchRakuma(q, exclude) {
  const url = `https://fril.jp/s?query=${encodeURIComponent(q)}&transaction=soldout&order=desc&sort=relevance`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const items = [];

  $('.item, .item-box').each((_, el) => {
    const $el = $(el);
    const a = $el.find('a').first();
    let href = a.attr('href') || '';
    if (href && href.startsWith('/')) href = 'https://fril.jp' + href;
    const title = ($el.find('.item-name, .item-box__item-name, .name').first().text() ||
                   a.attr('title') || '').trim();
    const priceText = $el.find('.item-price, .item-box__item-price, [class*=price]').first().text();
    const price = parsePriceJP(priceText);
    const image = extractImageUrl($el);

    if (title && price) {
      items.push({
        title, price, url: href, image, sold: true, condition: null, sold_date: null,
      });
    }
  });

  return items.slice(0, MAX_ITEMS);
}

// ====== eBay (海外参考) ======
async function searchEbay(q, exclude) {
  // 売却済みのみ ( LH_Sold=1, LH_Complete=1 )
  const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Sold=1&LH_Complete=1`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const items = [];

  $('.s-item').each((_, el) => {
    const $el = $(el);
    const title = $el.find('.s-item__title').first().text().trim();
    if (!title || /Shop on eBay/i.test(title)) return;
    const href = $el.find('.s-item__link').first().attr('href') || '';
    const priceText = $el.find('.s-item__price').first().text();
    const priceMatch = priceText.replace(/,/g, '').match(/\$([\d.]+)/);
    if (!priceMatch) return;
    // USDをそのまま入れず、概算円換算 (1USD = 155円固定の目安)
    const priceJpy = Math.round(parseFloat(priceMatch[1]) * 155);
    const cond = $el.find('.SECONDARY_INFO').first().text().trim();
    const image = extractImageUrl($el);
    items.push({
      title, price: priceJpy, url: href, image, sold: true,
      condition: cond, note: `元値: ${priceText.trim()}`,
    });
  });

  return items.slice(0, MAX_ITEMS);
}

// ====== 楽天市場 (現行販売価格) ======
async function searchRakutenIchiba(q, exclude) {
  // 楽天は公式APIは使えるがアプリID必要なので、HTMLスクレイピング
  const url = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(q)}/`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const items = [];

  // 戦略1: 商品コンテナ - 楽天の多様なクラス名に対応
  const containers = [
    '.searchresultitem',
    '[class*="item-grid"]',
    '.dui-card',
    '[data-testid="search-result-item"]',
    'div.product',
    '.item',
  ];
  let $items = $();
  for (const sel of containers) {
    $items = $(sel);
    if ($items.length > 0) {
      console.log(`  Rakuten: matched ${$items.length} with "${sel}"`);
      break;
    }
  }

  $items.each((_, el) => {
    const $el = $(el);
    const a = $el.find('a[href*="item.rakuten"], a[href*="rakuten.co.jp"], a[href*="//item.rakuten"]').first();
    const titleA = a.length ? a : $el.find('a').first();
    const title = (titleA.text() || titleA.attr('title') || $el.find('img').attr('alt') || '').trim();
    let href = titleA.attr('href') || '';
    const priceText = $el.find('[class*="price"], .price, [class*="Price"]').first().text() ||
                      $el.text().match(/¥?\s*([\d,]+)\s*円/)?.[0];
    const price = parsePriceJP(priceText);
    const image = extractImageUrl($el);

    if (title && price && href) {
      items.push({
        title: title.slice(0, 120), price, url: href, image,
        sold: false, condition: null, sold_date: null, note: '現在販売中',
      });
    }
  });

  // 戦略2: フォールバック - item.rakuten.co.jp へのリンクを直接拾う
  if (items.length === 0) {
    console.log('  Rakuten: fallback to direct link extraction');
    $('a[href*="item.rakuten"]').each((_, el) => {
      const $a = $(el);
      const $row = $a.closest('div, li');
      const href = $a.attr('href') || '';
      const title = ($a.text() || $a.attr('title') || $a.find('img').attr('alt') || '').trim();
      if (!title || title.length < 5) return;
      const priceText = $row.text().match(/¥?\s*([\d,]+)\s*円/)?.[0];
      const price = parsePriceJP(priceText);
      const image = extractImageUrl($row);
      if (title && price) {
        items.push({ title: title.slice(0, 120), price, url: href, image, sold: false, condition: null, sold_date: null, note: '現在販売中' });
      }
    });
  }

  return dedupByUrl(items).slice(0, MAX_ITEMS);
}

// ====== Yahoo!ショッピング (現行販売価格) ======
async function searchYahooShopping(q, exclude) {
  const url = `https://shopping.yahoo.co.jp/search?p=${encodeURIComponent(q)}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const items = [];

  // 戦略1: 商品コンテナを多様に探す
  const containers = [
    'li.LoopList__item',
    '[class*="LoopList"] li',
    '[class*="SearchResultItem"]',
    '[class*="ProductItem"]',
    '[class*="ResultItem"]',
    '[data-cy*="item"]',
    'li[class*="item"]',
  ];
  let $items = $();
  for (const sel of containers) {
    $items = $(sel);
    if ($items.length > 0) {
      console.log(`  Yahoo Shopping: matched ${$items.length} with "${sel}"`);
      break;
    }
  }

  $items.each((_, el) => {
    const $el = $(el);
    const a = $el.find('a[href*="/products/"], a[href*="store.shopping.yahoo"], a[href*="//store.shopping.yahoo"], a[href*="/store/"]').first();
    const titleA = a.length ? a : $el.find('a').first();
    const title = (titleA.text() || titleA.attr('title') || $el.find('h3').first().text() || $el.find('img').attr('alt') || '').trim();
    let href = titleA.attr('href') || '';
    const priceText = $el.find('[class*="Price"], [class*="price"]').first().text() ||
                      $el.text().match(/¥?\s*([\d,]+)\s*円?/)?.[0];
    const price = parsePriceJP(priceText);
    const image = extractImageUrl($el);

    if (title && price && href && title.length > 3) {
      items.push({
        title: title.slice(0, 120), price, url: href, image,
        sold: false, condition: null, sold_date: null, note: '現在販売中',
      });
    }
  });

  // 戦略2: フォールバック - 商品リンクを直接拾う
  if (items.length === 0) {
    console.log('  Yahoo Shopping: fallback to direct link extraction');
    $('a[href*="store.shopping.yahoo"], a[href*="//store.shopping.yahoo"]').each((_, el) => {
      const $a = $(el);
      const $row = $a.closest('li, div');
      const href = $a.attr('href') || '';
      const title = ($a.text() || $a.attr('title') || $a.find('img').attr('alt') || '').trim();
      if (!title || title.length < 5) return;
      const priceText = $row.text().match(/¥?\s*([\d,]+)\s*円?/)?.[0];
      const price = parsePriceJP(priceText);
      const image = extractImageUrl($row);
      if (title && price) {
        items.push({ title: title.slice(0, 120), price, url: href, image, sold: false, condition: null, sold_date: null, note: '現在販売中' });
      }
    });
  }

  return dedupByUrl(items).slice(0, MAX_ITEMS);
}

// ====== ブランディア (実取引・オークション形式) ======
async function searchBrandear(q, exclude) {
  // ブランディアの商品検索
  const url = `https://item.brandear.jp/search?keyword=${encodeURIComponent(q)}`;
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const items = [];

    // 複数のセレクタで商品コンテナを探す
    const containers = ['li.item', '.item-list li', '.item-card', '[class*="ItemCard"]', '.product-item', 'article'];
    let $items = $();
    for (const sel of containers) {
      $items = $(sel);
      if ($items.length > 0) {
        console.log(`  Brandear: matched ${$items.length} with "${sel}"`);
        break;
      }
    }

    $items.each((_, el) => {
      const $el = $(el);
      const a = $el.find('a[href*="brandear"], a[href*="/item/"]').first();
      const title = ($el.find('.item-name, .title, h3, h2').first().text() || a.attr('title') || a.find('img').attr('alt') || '').trim();
      let href = a.attr('href') || '';
      if (href.startsWith('/')) href = 'https://item.brandear.jp' + href;
      const priceText = $el.find('[class*="price"], .price, .amount').first().text() ||
                        $el.text().match(/¥?\s*([\d,]+)\s*円/)?.[0];
      const price = parsePriceJP(priceText);
      const image = extractImageUrl($el);
      if (title && price && href) {
        items.push({
          title: title.slice(0, 120), price, url: href, image,
          sold: true, condition: null, sold_date: null, note: 'ブランディア相場',
        });
      }
    });

    // フォールバック
    if (items.length === 0) {
      $('a[href*="brandear"]').each((_, el) => {
        const $a = $(el);
        const $row = $a.closest('li, div, article');
        const href = $a.attr('href') || '';
        const title = ($a.text() || $a.attr('title') || $a.find('img').attr('alt') || '').trim();
        if (!title || title.length < 5) return;
        const priceText = $row.text().match(/¥?\s*([\d,]+)\s*円/)?.[0];
        const price = parsePriceJP(priceText);
        const image = extractImageUrl($row);
        if (price) {
          items.push({ title: title.slice(0,120), price, url: href.startsWith('/') ? 'https://item.brandear.jp' + href : href, image, sold: true, condition: null, sold_date: null, note: 'ブランディア相場' });
        }
      });
    }

    return dedupByUrl(items).slice(0, MAX_ITEMS);
  } catch (e) {
    console.error('Brandear error:', e.message);
    return [];
  }
}

// ====== コメ兵 (現行販売価格) ======
async function searchKomehyo(q, exclude) {
  const url = `https://komehyo.jp/ec/search/result?keyword=${encodeURIComponent(q)}`;
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const items = [];

    const containers = ['li.p-item', '.product-card', '.item', '[class*="Product"]', '[class*="ItemCard"]', 'article'];
    let $items = $();
    for (const sel of containers) {
      $items = $(sel);
      if ($items.length > 0) {
        console.log(`  Komehyo: matched ${$items.length} with "${sel}"`);
        break;
      }
    }

    $items.each((_, el) => {
      const $el = $(el);
      const a = $el.find('a[href*="komehyo"], a[href*="/item/"], a[href*="/product/"]').first();
      const title = ($el.find('.item-name, .product-name, .title, h3, h2').first().text() || a.attr('title') || a.find('img').attr('alt') || '').trim();
      let href = a.attr('href') || '';
      if (href.startsWith('/')) href = 'https://komehyo.jp' + href;
      const priceText = $el.find('[class*="price"], .price').first().text() ||
                        $el.text().match(/¥?\s*([\d,]+)\s*円/)?.[0];
      const price = parsePriceJP(priceText);
      const image = extractImageUrl($el);
      if (title && price && href) {
        items.push({
          title: title.slice(0, 120), price, url: href, image,
          sold: false, condition: null, sold_date: null, note: 'コメ兵 販売中',
        });
      }
    });

    if (items.length === 0) {
      $('a[href*="komehyo.jp"]').each((_, el) => {
        const $a = $(el);
        const $row = $a.closest('li, div, article');
        const href = $a.attr('href') || '';
        const title = ($a.text() || $a.attr('title') || $a.find('img').attr('alt') || '').trim();
        if (!title || title.length < 5) return;
        const priceText = $row.text().match(/¥?\s*([\d,]+)\s*円/)?.[0];
        const price = parsePriceJP(priceText);
        const image = extractImageUrl($row);
        if (price) {
          items.push({ title: title.slice(0,120), price, url: href, image, sold: false, condition: null, sold_date: null, note: 'コメ兵 販売中' });
        }
      });
    }

    return dedupByUrl(items).slice(0, MAX_ITEMS);
  } catch (e) {
    console.error('Komehyo error:', e.message);
    return [];
  }
}

// ====== なんぼや (買取参考価格) ======
async function searchNanboya(q, exclude) {
  // なんぼやの買取実績ページ検索
  const url = `https://nanboya.com/search/?q=${encodeURIComponent(q)}`;
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const items = [];

    // なんぼやは買取実績や商品ページで価格を表示
    const containers = ['.result-item', '.purchase-record', '.kaitori-item', 'article', 'li', '[class*="Result"]'];
    let $items = $();
    for (const sel of containers) {
      $items = $(sel);
      if ($items.length > 5) {
        console.log(`  Nanboya: matched ${$items.length} with "${sel}"`);
        break;
      }
    }

    $items.each((_, el) => {
      const $el = $(el);
      const a = $el.find('a[href*="nanboya"]').first();
      const title = ($el.find('.title, h3, h2, .item-name').first().text() || a.attr('title') || a.find('img').attr('alt') || '').trim();
      let href = a.attr('href') || $el.find('a').first().attr('href') || '';
      if (href.startsWith('/')) href = 'https://nanboya.com' + href;
      const priceText = $el.find('[class*="price"], .price, .amount').first().text() ||
                        $el.text().match(/¥?\s*([\d,]+)\s*円/)?.[0];
      const price = parsePriceJP(priceText);
      const image = extractImageUrl($el);
      if (title && price && href && title.length > 3) {
        items.push({
          title: title.slice(0, 120), price, url: href, image,
          sold: true, condition: null, sold_date: null, note: 'なんぼや 買取実績',
        });
      }
    });

    return dedupByUrl(items).slice(0, MAX_ITEMS);
  } catch (e) {
    console.error('Nanboya error:', e.message);
    return [];
  }
}

// ====== まんだらけ (現行販売) - フィギュア・コレクター向け ======
async function searchMandarake(q, exclude) {
  const url = `https://order.mandarake.co.jp/order/listPage/list?keyword=${encodeURIComponent(q)}&lang=ja`;
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const items = [];

    const containers = ['div.block', '.entry', '.item', 'tr.item', '[class*="Product"]'];
    let $items = $();
    for (const sel of containers) {
      $items = $(sel);
      if ($items.length > 0) {
        console.log(`  Mandarake: matched ${$items.length} with "${sel}"`);
        break;
      }
    }

    $items.each((_, el) => {
      const $el = $(el);
      const a = $el.find('a[href*="mandarake"], a[href*="/item/"], a[href*="/order/"]').first();
      const title = ($el.find('.title, .name, h3, h4').first().text() || a.attr('title') || a.find('img').attr('alt') || '').trim();
      let href = a.attr('href') || '';
      if (href.startsWith('/')) href = 'https://order.mandarake.co.jp' + href;
      const priceText = $el.find('[class*="price"], .price').first().text() ||
                        $el.text().match(/¥?\s*([\d,]+)\s*円/)?.[0];
      const price = parsePriceJP(priceText);
      const image = extractImageUrl($el);
      if (title && price && href && title.length > 3) {
        items.push({
          title: title.slice(0, 120), price, url: href, image,
          sold: false, condition: null, sold_date: null, note: 'まんだらけ 販売中',
        });
      }
    });

    return dedupByUrl(items).slice(0, MAX_ITEMS);
  } catch (e) {
    console.error('Mandarake error:', e.message);
    return [];
  }
}

// ====== 大黒屋 (買取・販売) ======
async function searchDaikokuya(q, exclude) {
  const url = `https://www.e-daikoku.com/sale/list/?q=${encodeURIComponent(q)}`;
  try {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    const items = [];

    const containers = ['.item-list li', '.product-item', '.item', 'article', '[class*="Item"]'];
    let $items = $();
    for (const sel of containers) {
      $items = $(sel);
      if ($items.length > 0) {
        console.log(`  Daikokuya: matched ${$items.length} with "${sel}"`);
        break;
      }
    }

    $items.each((_, el) => {
      const $el = $(el);
      const a = $el.find('a').first();
      const title = ($el.find('.item-name, .title, h3, h2').first().text() || a.attr('title') || a.find('img').attr('alt') || '').trim();
      let href = a.attr('href') || '';
      if (href.startsWith('/')) href = 'https://www.e-daikoku.com' + href;
      const priceText = $el.find('[class*="price"], .price').first().text() ||
                        $el.text().match(/¥?\s*([\d,]+)\s*円/)?.[0];
      const price = parsePriceJP(priceText);
      const image = extractImageUrl($el);
      if (title && price && href && title.length > 3) {
        items.push({
          title: title.slice(0, 120), price, url: href, image,
          sold: false, condition: null, sold_date: null, note: '大黒屋 販売中',
        });
      }
    });

    return dedupByUrl(items).slice(0, MAX_ITEMS);
  } catch (e) {
    console.error('Daikokuya error:', e.message);
    return [];
  }
}

// ====== TikTok Shop (実験的) ======
async function searchTikTokShop(q, exclude) {
  // TikTok Shopは地域制限が強く、公式APIなしでの安定スクレイピングは困難。
  // 実装はベストエフォートで、取得失敗時は空配列を返す。
  try {
    const url = `https://shop.tiktok.com/api/v1/shop/product_feed/get?keyword=${encodeURIComponent(q)}`;
    const res = await axios.get(url, { headers: COMMON_HEADERS, timeout: 10000, validateStatus: () => true });
    const items = [];
    if (res.status === 200 && res.data && res.data.data && Array.isArray(res.data.data.products)) {
      for (const p of res.data.data.products) {
        if (!p.title || !p.price) continue;
        const priceJpy = parsePriceJP(p.price) || Math.round(parseFloat(p.price.replace(/[^\d.]/g, '')) * 155);
        items.push({
          title: p.title,
          price: priceJpy,
          url: p.url || '',
          sold: false,
          condition: null,
          note: 'TikTok Shop (現行価格)',
        });
      }
    }
    return items.slice(0, MAX_ITEMS);
  } catch (e) {
    return [];
  }
}

// ====== ルーティング ======
const handlers = {
  yahoo_auction: searchYahooAuction,
  paypay: searchPayPayFlea,
  mercari: searchMercari,
  rakuma: searchRakuma,
  rakuten: searchRakutenIchiba,
  yahoo_shopping: searchYahooShopping,
  brandear: searchBrandear,
  komehyo: searchKomehyo,
  nanboya: searchNanboya,
  mandarake: searchMandarake,
  daikokuya: searchDaikokuya,
  ebay: searchEbay,
  tiktok: searchTikTokShop,
};

app.get('/api/search', async (req, res) => {
  const { market, q, exclude, category } = req.query;
  if (!market || !q) return res.status(400).json({ error: 'market と q は必須です' });
  const handler = handlers[market];
  if (!handler) return res.status(400).json({ error: `未対応のマーケット: ${market}` });

  console.log(`[${new Date().toISOString()}] ${market} を検索: "${q}" カテゴリ=${category || '未指定'}`);
  try {
    let items = await handler(q, exclude);
    items = applyExclude(items, exclude);
    items = relevanceFilter(items, q, category);
    res.json({ market, query: q, category, count: items.length, items });
  } catch (err) {
    console.error(`[${market}] エラー:`, err.message);
    res.status(500).json({ market, error: err.message, items: [] });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', supported: Object.keys(handlers) });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 AI相場リサーチ サーバー起動`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   対応マーケット: ${Object.keys(handlers).join(', ')}\n`);
});
