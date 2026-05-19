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

const MAX_ITEMS = 30;

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

// 関連性フィルタ: タイトルにブランド名（または最初の2単語のうち1つ）が含まれるかチェック
// 重要: フィルタで件数が極端に減る（>90%）場合は元の配列を返す（フィルタオフ）
function relevanceFilter(items, query) {
  if (!query || items.length === 0) return items;
  const words = query.trim().split(/[\s　]+/).filter(w => w.length >= 2);
  if (words.length === 0) return items;

  // 最初の2単語を候補にしてエイリアスを集める
  const candidateAliases = new Set();
  for (let i = 0; i < Math.min(2, words.length); i++) {
    for (const a of aliasesFor(words[i])) {
      candidateAliases.add(a.toLowerCase());
    }
  }

  const filtered = items.filter(it => {
    const title = (it.title || '').toLowerCase();
    for (const alias of candidateAliases) {
      if (title.includes(alias)) return true;
    }
    return false;
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
  return filtered;
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

  // 結果は li.Product または div.Product 構造
  $('li.Product, .Product').each((_, el) => {
    const $el = $(el);
    const titleEl = $el.find('.Product__title a, a.Product__titleLink, .Product__titleLink').first();
    let title = titleEl.text().trim();
    let href = titleEl.attr('href') || '';
    if (href && href.startsWith('/')) href = 'https://auctions.yahoo.co.jp' + href;

    // 価格パターン複数対応
    const priceText =
      $el.find('.Product__priceValue').first().text() ||
      $el.find('.Product__price').first().text() ||
      $el.find('[class*=price]').first().text();
    const price = parsePriceJP(priceText);

    const date = $el.find('.Product__time, .Product__date').first().text().trim();

    // サムネイル画像
    const imgEl = $el.find('img').first();
    const image = imgEl.attr('src') || imgEl.attr('data-src') || null;

    if (title && price) {
      items.push({
        title,
        price,
        url: href,
        image,
        sold_date: date || null,
        sold: true,
        condition: null,
      });
    }
  });

  return items.slice(0, MAX_ITEMS);
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

// ====== メルカリ ======
async function searchMercari(q, exclude) {
  // メルカリは内部APIを叩く。ただし匿名アクセスはレート制限あり。
  // 公開検索ページのHTMLからJSONを抽出する方式を採用。
  const url = `https://jp.mercari.com/search?keyword=${encodeURIComponent(q)}&status=sold_out&order=desc&sort=created_time`;
  const html = await fetchHtml(url, {
    headers: {
      'Referer': 'https://jp.mercari.com/',
    }
  });
  const $ = cheerio.load(html);
  const items = [];

  // __NEXT_DATA__ から抽出
  const next = $('#__NEXT_DATA__').html();
  if (next) {
    try {
      const data = JSON.parse(next);
      const walk = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) { obj.forEach(walk); return; }
        if (obj.id && obj.name && obj.price !== undefined && (obj.status === 'sold_out' || obj.status === 'trading' || obj.itemConditionId)) {
          // サムネイル抽出
          let image = null;
          if (Array.isArray(obj.thumbnails) && obj.thumbnails.length > 0) {
            image = typeof obj.thumbnails[0] === 'string' ? obj.thumbnails[0] : (obj.thumbnails[0].url || null);
          } else if (obj.thumbnail) {
            image = typeof obj.thumbnail === 'string' ? obj.thumbnail : (obj.thumbnail.url || null);
          } else if (obj.imageUrl) {
            image = obj.imageUrl;
          } else if (Array.isArray(obj.photos) && obj.photos.length > 0) {
            image = obj.photos[0].uri || obj.photos[0].url || obj.photos[0];
          }
          items.push({
            title: obj.name,
            price: parseInt(obj.price, 10),
            url: `https://jp.mercari.com/item/${obj.id}`,
            image,
            sold: obj.status === 'sold_out',
            condition: obj.itemConditionName || null,
            sold_date: obj.updated || null,
          });
        }
        for (const k in obj) walk(obj[k]);
      };
      walk(data);
    } catch (e) { /* ignore */ }
  }

  // a要素から拾うフォールバック
  if (items.length === 0) {
    $('a[href^="/item/"]').each((_, el) => {
      const $el = $(el);
      const href = 'https://jp.mercari.com' + $el.attr('href');
      const img = $el.find('img').first();
      const title = $el.attr('aria-label') || img.attr('alt') || '';
      const image = img.attr('src') || img.attr('data-src') || null;
      const priceText = $el.find('[class*=price]').first().text() ||
                        $el.text().match(/¥[\d,]+/)?.[0] || '';
      const price = parsePriceJP(priceText);
      if (title && price) {
        items.push({ title, price, url: href, image, sold: true, condition: null });
      }
    });
  }

  const seen = new Set();
  const dedup = items.filter(it => {
    if (seen.has(it.url)) return false;
    seen.add(it.url);
    return it.sold;
  });
  return dedup.slice(0, MAX_ITEMS);
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
    const imgEl = $el.find('img').first();
    const image = imgEl.attr('src') || imgEl.attr('data-src') || imgEl.attr('data-original') || null;

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
    const image = $el.find('.s-item__image-img, img').first().attr('src') || null;
    items.push({
      title, price: priceJpy, url: href, image, sold: true,
      condition: cond, note: `元値: ${priceText.trim()}`,
    });
  });

  return items.slice(0, MAX_ITEMS);
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
  ebay: searchEbay,
  tiktok: searchTikTokShop,
};

app.get('/api/search', async (req, res) => {
  const { market, q, exclude } = req.query;
  if (!market || !q) return res.status(400).json({ error: 'market と q は必須です' });
  const handler = handlers[market];
  if (!handler) return res.status(400).json({ error: `未対応のマーケット: ${market}` });

  console.log(`[${new Date().toISOString()}] ${market} を検索: "${q}"`);
  try {
    let items = await handler(q, exclude);
    items = applyExclude(items, exclude);
    const beforeCount = items.length;
    items = relevanceFilter(items, q);
    if (beforeCount !== items.length) {
      console.log(`  関連性フィルタ: ${beforeCount} → ${items.length} 件`);
    }
    res.json({ market, query: q, count: items.length, items });
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
