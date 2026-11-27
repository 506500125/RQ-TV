// koreanbj2.js — KoreanBJ2 的 XPTV JS 扩展源
// 站点：https://ww1.koreanbj.club （koreanbj.club 会 301 跳到 ww1 子域）
// 命名注意：为与 koreanbj.tv 的 KoreanBJ（csp_koreanbj）区分，本源命名
// KoreanBJ2，api csp_koreanbj2。
// 实测结构（2026-11-27，浏览器实测；站方 Cloudflare 挡直接抓取）：
//   首页：/ ，「Latest videos」，每页 21 条；翻页 /page/N/（末页 3773）。
//   分类：/category/<slug>/ ，翻页 /category/<slug>/page/N/。
//   搜索：/?s=<关键词>，字段名 s。
//   卡片：<article> > <a href="/video/<slug>/"> > <img>；
//         链接文字是「标题 播放量 时长」，如 ruruka820_32 0 04:23；
//         封面 wp-content/uploads/…jpg；详情地址必须是 /video/ 前缀。
//   详情：/video/<slug>/ ，主播放器（Player 1）iframe 在页面加载时就有：
//     https://31cek.xyz/embed/kbj.php?url=<直链 mp4>&poster=<封面>
//     url 参数就是真 mp4（hidden-kbj.onlyfanleaks.me/videos/*.mp4，
//     2026-11-27 实测 200/206、真 video/mp4、无需 Referer）。
//     Player 2 是 VOE 嵌入（io12379storege.xyz/e/<id>/），真实流地址
//     藏在混淆 JS 里，静态提取不可靠，作为后备。
//   封面：img 的 src 是绝对地址的 wp-content 图片；原始 HTML 里可能
//     是懒加载占位（data-src/srcset），pickCover 会优先取真实地址。
//
// 依赖：运行环境提供的 createCheerio()、$fetch、jsonify、argsify、$print。

const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const appConfig = {
  ver: 1,
  title: 'KoreanBJ2',
  site: 'https://ww1.koreanbj.club',
  tabs: [
    {
      name: '最新',
      ext: {
        id: '/',
      },
    },
    {
      name: 'KBJ',
      ext: {
        id: '/category/kbj/',
      },
    },
    {
      name: 'Panda TV',
      ext: {
        id: '/category/pandatv/',
      },
    },
    {
      name: 'Fantrie',
      ext: {
        id: '/category/fantrie/',
      },
    },
    {
      name: 'SoopLive',
      ext: {
        id: '/tag/sooplive/',
      },
    },
    {
      name: 'Twitch',
      ext: {
        id: '/category/twitch/',
      },
    },
  ],
}

function normalizeUrl(rawUrl) {
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

// 封面可能藏在懒加载属性里（data-src / srcset），src 本身可能是占位图；
// 也可能是相对地址，统一转成绝对地址再交给 XPTV。
function pickCover(img) {
  if (!img || !img.length) return ''
  var attrs = [
    img.attr('data-src'), img.attr('data-lazy-src'), img.attr('data-original'),
    img.attr('src'), img.attr('srcset'), img.attr('data-srcset'),
  ]
  for (var i = 0; i < attrs.length; i++) {
    var c = String(attrs[i] || '').trim()
    if (!c || c.indexOf('data:') === 0) continue
    if (c.indexOf('placeholder') !== -1) continue
    // srcset 是 "url 300w, url 600w" 形式，取第一条
    if (/,\s*\S+\s+\d+w/.test(c)) c = c.split(',')[0].trim().split(/\s+/)[0]
    if (!c) continue
    return normalizeUrl(c)
  }
  return ''
}

function parseCards($) {
  const cards = []
  const seen = {}
  $('article a[href*="/video/"]').each((_, el) => {
    const a = $(el)
    const href = a.attr('href') || ''
    if (!href || seen[href]) return
    let img = a.find('img').first()
    if (!img.length) img = a.closest('article').find('img').first()
    const cover = pickCover(img)
    // 链接文字是「标题 播放量 时长」，且可能重复拼接，先取第一段
    let text = a.text().replace(/\s+/g, ' ').trim()
    const durMatch = text.match(/(\d{1,2}:\d{2}(?::\d{2})?)/)
    const duration = durMatch ? durMatch[1] : ''
    let title = (img.attr('alt') || '').trim()
    if (!title && text) {
      // 去掉时长和它前面的播放量数字，剩下的第一段就是标题
      let head = durMatch ? text.slice(0, durMatch.index).trim() : text
      head = head.replace(/\s+\d+\s*$/, '').trim()
      title = head
    }
    if (!title) return
    seen[href] = true
    const detailUrl = normalizeUrl(href)
    cards.push({
      vod_id: detailUrl,
      vod_name: title,
      vod_pic: cover,
      vod_remarks: duration,
      ext: {
        url: detailUrl,
      },
    })
  })
  return cards
}

async function fetchHtml(url) {
  const { data } = await $fetch.get(url, {
    headers: {
      'User-Agent': UA,
      'Referer': appConfig.site + '/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  })
  return typeof data === 'string' ? data : JSON.stringify(data || '')
}

async function getCards(ext) {
  ext = argsify(ext)
  let cards = []
  const page = ext.page || 1
  let { id } = ext
  let url = appConfig.site + id
  if (page > 1) {
    url = url + 'page/' + page + '/'
  }

  try {
    const html = await fetchHtml(url)
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

function findDirectMedia(html) {
  if (!html || typeof html !== 'string') return ''
  var re = /https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/gi
  var m
  while ((m = re.exec(html)) !== null) {
    var u = m[0]
    if (u.indexOf('preview') !== -1) continue
    // 嵌入页地址本身不是媒体（如 31cek 嵌入串里的 mp4 参数会被整段匹配到），跳过
    if (/31cek|kbj\.php|\/embed\//i.test(u)) continue
    return u
  }
  return ''
}

// 从 31cek 嵌入地址里提取直链 mp4（2026-11-27 浏览器实测）：
// 详情页加载时就有的播放器 iframe src 是
//   https://31cek.xyz/embed/kbj.php?url=<直链 mp4>&poster=<封面>
// url 参数就是真 mp4，实测 200/206、真 video/mp4，且不需要 Referer。
function extractEmbedMp4(html) {
  if (!html || typeof html !== 'string') return ''
  var m = html.match(/31cek\.xyz\/embed\/kbj\.php\?url=([^&"'\s<>]+)/i)
  if (m && m[1]) {
    try { return decodeURIComponent(m[1]) } catch (e) { return m[1] }
  }
  // 兜底：页面里直接出现的 onlyfanleaks 直链
  var d = html.match(/https?:\/\/hidden-kbj\.onlyfanleaks\.me\/videos\/[^"'\s<>]+\.mp4/i)
  if (d && d[0]) return d[0]
  // 通用：任何嵌入地址里经过编码的 url=<mp4> 参数
  var g = html.match(/[?&]url=(https?%3A%2F%2F[^&"'\s<>]+\.mp4)/i)
  if (g && g[1]) {
    try { return decodeURIComponent(g[1]) } catch (e) { return g[1] }
  }
  // 通用：任何嵌入地址里明文的 url=<mp4> 参数（非 31cek 的嵌入页也可能这样传直链）
  var p = html.match(/[?&]url=(https?:\/\/[^&"'\s<>]+\.mp4)/i)
  if (p && p[1]) return p[1]
  return ''
}

function findEmbedUrl(html) {
  if (!html || typeof html !== 'string') return ''
  // 播放器嵌入 iframe：VOE 一类，形如 https://<host>/e/<id>/
  const iframes = html.match(/<iframe[^>]*src="([^"]+)"/gi) || []
  for (const tag of iframes) {
    const m = tag.match(/src="([^"]+)"/i)
    if (!m) continue
    const src = m[1]
    // 排除广告 iframe
    if (/puny-version|ads|popads|adserver|doubleclick/i.test(src)) continue
    if (/\/e\/[A-Za-z0-9]+/i.test(src) || /voe|storege/i.test(src)) return src
  }
  return ''
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
      const html = await fetchHtml(targetUrl)
      // 优先：31cek 嵌入里的 url 参数就是直链 mp4
      finalMediaUrl = extractEmbedMp4(html)
      if (!finalMediaUrl) finalMediaUrl = findDirectMedia(html)
      if (!finalMediaUrl) {
        const embedUrl = findEmbedUrl(html)
        if (embedUrl) {
          $print('找到嵌入播放器: ' + embedUrl)
          try {
            const embedHtml = await fetchHtml(embedUrl)
            finalMediaUrl = findDirectMedia(embedHtml)
          } catch (e2) {
            $print('嵌入页抓取失败: ' + e2)
          }
        }
      }
    }

    if (finalMediaUrl) {
      $print('提取到直链: ' + finalMediaUrl)
    } else {
      $print('未找到可播直链，返回空列表')
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

  const url = appConfig.site + '/?s=' + encodeURIComponent(text)

  try {
    const html = await fetchHtml(url)
    const $ = cheerio.load(html)
    cards = parseCards($)
  } catch (e) {
    $print('search 错误: ' + e)
  }

  return jsonify({
    list: cards,
  })
}
