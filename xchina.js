// xchina.js — 小黄书 xChina（xchina.co）的 XPTV JS 扩展源
// 站点：https://xchina.co ，华语成人综合站（视频/套图/小说）
// 实测结构（2026-11-27，浏览器实测 + 用户提供的详情页源码）：
//   列表：/videos/new（23 条/页，标题“最新影片 共 5,787 部”，分页
//         /videos/new/N，N 最大 200）。
//   分类：大分类 /video-category/<slug>（jav 日本AV、cn 国产、
//         movie 电影、ai AI视频、other 其他）；系列/厂商
//         /video-series/<数字>（有码 4、无码 5、麻豆传媒 21、
//         香蕉视频 8、糖心Vlog 20、模特私拍 62、星空传媒 133、
//         热舞 44、ED Mosaic 60、蜜桃传媒 70、爱豆传媒 78、直播 54、
//         天美传媒 120、果冻传媒 33、探花 27、华语 61）。
//         分类页翻页格式未实测，暂按 /<分类>/N 推断（与 /videos/new/N
//         同一规律），若翻页不对只影响第 2 页以后。
//   搜索：/search?q=<关键词>（实测 /search?q=国产 正常出结果）。
//   卡片（浏览器无障碍树实测，无 class 名，全部用结构选择器）：
//         <main> 的直接子元素 <a href="/video/<id>">；内含
//         <img src="https://r2.xchina.download/cover/<id>.webp"
//         alt="完整标题">（第一个子元素）；标题文字与 img alt 相同；
//         角标是 <a> 内的纯文本节点：左上 有码/无码、右上番号
//         （如 LUXU-1922）、左下 时长（如 82:42）；标题下方元信息
//         行右侧是发布日期；作者、评论数是可选字段（有的卡片没有）。
//   详情：/video/<id>，站内自带播放器，无登录/付费遮挡，VIP 只
//         影响下载和去广告。播放器不是 <video src>，而是：
//         <div id="video-player" data-src="/hls/<id>/master.m3u8"
//         data-poster="https://r2.xchina.download/cover/<id>.webp" ...>
//         （用户 2026-11-27 提供的详情页源码，视频 6b0981af08d38）。
//         data-src 是相对地址，拼上 https://xchina.co 就是真 HLS。
//         注意：本机（VM）直连 xchina.co 会被 Cloudflare 403，
//         master.m3u8 未能从本机验证；用户浏览器能正常打开本站，
//         电视端（用户网络）应能正常取到，仍需电视实测确认播放。
//   封面：r2.xchina.download/cover/<id>.webp，与 data-poster 同地址。
//
// 依赖：运行环境提供的 createCheerio()、$fetch、jsonify、argsify、$print。

const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const appConfig = {
  ver: 1,
  title: 'XChina',
  site: 'https://xchina.co',
  tabs: [
    {
      name: '最新',
      ext: {
        id: '/videos/new',
      },
    },
    {
      name: '日本AV',
      ext: {
        id: '/video-category/jav',
      },
    },
    {
      name: '国产',
      ext: {
        id: '/video-category/cn',
      },
    },
    {
      name: '电影',
      ext: {
        id: '/video-category/movie',
      },
    },
    {
      name: 'AI视频',
      ext: {
        id: '/video-category/ai',
      },
    },
    {
      name: '有码',
      ext: {
        id: '/video-series/4',
      },
    },
    {
      name: '无码',
      ext: {
        id: '/video-series/5',
      },
    },
    {
      name: '探花',
      ext: {
        id: '/video-series/27',
      },
    },
    {
      name: '华语',
      ext: {
        id: '/video-series/61',
      },
    },
    {
      name: '麻豆传媒',
      ext: {
        id: '/video-series/21',
      },
    },
    {
      name: '糖心Vlog',
      ext: {
        id: '/video-series/20',
      },
    },
  ],
}

function normalizeUrl(rawUrl, baseUrl) {
  let u = String(rawUrl || '').trim()
  if (!u) return ''
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('//')) return 'https:' + u
  if (u.startsWith('/')) return appConfig.site + u
  return appConfig.site + '/' + u
}

async function getConfig() {
  return jsonify(appConfig)
}

// 从详情页 HTML 里提播放地址：优先 #video-player 的 data-src，
// 其次任意含 /hls/ 的 data-src，再次任意绝对 .m3u8 地址。
// data-src 是相对地址时拼上本站域名。
function extractM3u8(html) {
  if (!html || typeof html !== 'string') return ''
  var m = html.match(/id=["']video-player["'][^>]*data-src=["']([^"']+\.m3u8[^"']*)["']/i)
  if (m && m[1]) return normalizeUrl(m[1])
  var m2 = html.match(/data-src=["']([^"']*\/hls\/[^"']*\.m3u8[^"']*)["']/i)
  if (m2 && m2[1]) return normalizeUrl(m2[1])
  var m3 = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i)
  if (m3 && m3[1]) return m3[1]
  return ''
}

function parseCards($) {
  const cards = []
  const seen = {}
  // 卡片就是 <a href="/video/<id>">，内含 /cover/ 封面图。
  // 不用 class 名（浏览器视图里拿不到），用结构 + 封面地址认卡片；
  // /video/<id>/download 这类带后缀的链接不要。
  $('a[href^="/video/"]').each((_, el) => {
    const a = $(el)
    const href = a.attr('href') || ''
    if (!/^\/video\/[A-Za-z0-9]+$/.test(href)) return
    if (seen[href]) return
    const img = a.find('img').first()
    if (!img || !img.length) return
    const src = String(img.attr('src') || img.attr('data-src') || '').trim()
    if (!src || src.indexOf('/cover/') === -1) return
    seen[href] = true
    const detailUrl = normalizeUrl(href)
    // 标题：img alt 是完整标题（与可见标题相同），优先用它，避免
    // <a> 文本里标题重复出现；没有 alt 时取链接文本的第一行。
    let title = String(img.attr('alt') || '').trim()
    if (!title) {
      title = a.text().replace(/\s+/g, ' ').trim().split('  ')[0]
    }
    if (!title) return
    // 时长：<a> 文本里第一个 时:分(:秒) 形式的串（如 82:42、25:56）
    let duration = ''
    const dm = a.text().match(/(\d{1,3}:\d{2}(?::\d{2})?)/)
    if (dm) duration = dm[1]
    cards.push({
      vod_id: detailUrl,
      vod_name: title,
      vod_pic: normalizeUrl(src),
      vod_remarks: duration,
      ext: {
        url: detailUrl,
      },
    })
  })
  return cards
}

async function getCards(ext) {
  ext = argsify(ext)
  let cards = []
  let { page = 1, id } = ext
  // 最新：/videos/new，翻页 /videos/new/N；分类：/<分类>，翻页
  // /<分类>/N（与 /videos/new/N 同一规律推断，未实测）。
  let base = String(id || '/videos/new').replace(/\/$/, '')
  let url = appConfig.site + base
  if (page > 1) url = url + '/' + page

  try {
    const { data } = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': appConfig.site + '/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })
    const html = typeof data === 'string' ? data : JSON.stringify(data || '')
    const $ = cheerio.load(html)
    cards = parseCards($)
    $print('抓到视频数量: ' + cards.length)
  } catch (e) {
    $print('getCards 错误: ' + e)
  }

  return jsonify({
    list: cards,
  })
}

async function getTracks(ext) {
  ext = argsify(ext)
  const url = ext.url
  return jsonify({
    list: [
      {
        title: '在线播放',
        tracks: [
          {
            name: '播放',
            pan: '',
            ext: {
              url: url,
              referer: appConfig.site + '/',
            },
          },
        ],
      },
    ],
  })
}

async function getPlayinfo(ext) {
  ext = argsify(ext)
  let targetUrl = ext.url
  let referer = ext.referer || (appConfig.site + '/')
  let finalMediaUrl = ''

  try {
    if (targetUrl && /\.(m3u8|mp4)(\?|#|$)/i.test(targetUrl)) {
      finalMediaUrl = targetUrl
    } else if (targetUrl) {
      const { data } = await $fetch.get(targetUrl, {
        headers: {
          'User-Agent': UA,
          'Referer': referer,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })
      const html = typeof data === 'string' ? data : JSON.stringify(data || '')
      finalMediaUrl = extractM3u8(html)
    }

    if (finalMediaUrl) {
      $print('提取到直链: ' + finalMediaUrl)
    } else {
      $print('未找到可播放的流地址，返回空列表')
    }
  } catch (e) {
    $print('getPlayinfo 错误: ' + e)
  }

  return jsonify({
    urls: finalMediaUrl ? [finalMediaUrl] : [],
    headers: [{
      'User-Agent': UA,
      'Referer': targetUrl || (appConfig.site + '/'),
    }],
  })
}

async function search(ext) {
  ext = argsify(ext)
  let cards = []
  const text = ext.text || ''
  if (!text) return jsonify({ list: cards })

  const url = appConfig.site + '/search?q=' + encodeURIComponent(text)

  try {
    const { data } = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': appConfig.site + '/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })
    const html = typeof data === 'string' ? data : JSON.stringify(data || '')
    const $ = cheerio.load(html)
    cards = parseCards($)
  } catch (e) {
    $print('search 错误: ' + e)
  }

  return jsonify({
    list: cards,
  })
}
