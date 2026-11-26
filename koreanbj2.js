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
//   详情：/video/<slug>/ ，播放器是点 ▶ 后才注入的 VOE 嵌入 iframe
//     （如 https://io12379storege.xyz/e/<id>/），初始页面结构里没有；
//     VOE 把真实流地址藏在混淆 JS 里，静态提取不可靠。getPlayinfo 会
//     先找页面里的直链（mp4/m3u8）和嵌入 iframe，再去嵌入页里找直链；
//     找不到就返回空列表（提示无法播放），不把网页地址当视频地址交出去。
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
  const m = html.match(/https?:\/\/[^"'\s<>]+\.(?:m3u8|mp4)(?:\?[^"'\s<>]*)?/i)
  if (m && m[0] && m[0].indexOf('preview') === -1) return m[0]
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
      finalMediaUrl = findDirectMedia(html)
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
