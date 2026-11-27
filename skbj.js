// skbj.js — SKBJ 的 XPTV JS 扩展源
// 站点：https://skbj.tv ，服务端渲染（与 koreanbj.tv 同一套后端数据）
// 实测结构（2026-11-27）：
//   列表：/videos?page=N，卡片 <a href="/videos/<slug>">，内含 img（封面）、
//         <h2> 标题、时长 <span class="absolute right-2 bottom-2">、观看数。
//         分类：/videos?duration=long|medium|short（按时长），默认最新。
//   搜索：/search?q=<关键词>，同一套卡片。
//   详情：/videos/<slug>，免费视频页面里有
//     videoUrl:"https://store*.gofile.io/download/direct/<id>/<file>.mp4"
//     和 <video src="同地址">；收费视频 videoUrl:null，只有 preview 预览片段。
//   gofile 直链注意（2026-11-27 实测，SKBJ 黑屏的原因）：
//     store*.gofile.io 的 mp4 地址会 302 跳到 file-*.gofile.io，且跳转后
//     的地址仍校验 Referer 必须是详情页地址；播放器跟随跳转时丢了 Referer
//     就会 403 黑屏。所以 getPlayinfo 里先用 $fetch 跟随一次跳转，把最终
//     地址连同 Referer（详情页地址）一起返回。最终地址加详情页 Referer
//     实测 206、真 mp4 数据。
//   列表页看不出是否收费，点播收费视频返回空列表（XPTV 会提示无法播放，
//   而不是黑屏）。2026-11-27 修正：列表页其实自带价格——服务端数据
//   （RSC payload）里每个视频都有 creditCost / isPremium，顺序与卡片
//   一致，且 coverUrl 里带视频 slug，可按 slug 对上号。所以 getCards /
//   search 直接在列表里过滤掉收费的，只留免费的。
//   实例：pse0210 BJ차도하 2026-11-11，creditCost 28、videoUrl:null、
//   creditLocked:true，站里根本没给免费直链，播不了是收费不是 bug。
//   最新第 1 页实测 24 个里只有 2 个免费。
//
// 依赖：运行环境提供的 createCheerio()、$fetch、jsonify、argsify、$print。

const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const appConfig = {
  ver: 1,
  title: 'SKBJ',
  site: 'https://skbj.tv',
  tabs: [
    {
      name: '最新',
      ext: {
        id: '/videos',
      },
    },
    {
      name: '最热',
      ext: {
        id: '/videos?sort=trending',
      },
    },
    {
      name: '长视频',
      ext: {
        id: '/videos?duration=long',
      },
    },
    {
      name: '中等',
      ext: {
        id: '/videos?duration=medium',
      },
    },
    {
      name: '短视频',
      ext: {
        id: '/videos?duration=short',
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

// 从列表/搜索页的服务端数据（RSC payload）里按 slug 建价格表。
// 每个视频对象形如：
//   coverUrl:".../videos-media/<slug>/thumb-xxx.webp",previewVideoUrl:"...",
//   durationSeconds:140,...,creditCost:128,isPremium:!1
// 返回 { slug: { cost, premium } }。拿不到价格信息时返回空表，调用方
// 保留全部卡片（宁可多显示，不可误删）。
function buildCostMap(html) {
  var map = {}
  if (!html) return map
  var re = /videos-media\/([A-Za-z0-9\-_]+)\/[^"]*"[\s\S]{0,600}?creditCost:(\d+),isPremium:(!0|!1)/g
  var m
  while ((m = re.exec(html)) !== null) {
    map[m[1]] = { cost: parseInt(m[2], 10) || 0, premium: m[3] === '!0' }
  }
  return map
}

function parseCards($, costMap) {
  const cards = []
  const seen = {}
  $('a[href^="/videos/"]').each((_, el) => {
    const a = $(el)
    const href = a.attr('href') || ''
    if (!href || seen[href]) return
    const title = (a.find('h2').first().text().trim() || a.find('h3').first().text().trim())
    if (!title) return
    seen[href] = true
    // 收费视频（creditCost>0 或 isPremium）在列表里直接藏掉，播不了
    // 的不显示；价格表里没这个 slug 时保留。
    const slug = href.replace(/^\/videos\//, '').replace(/\/$/, '')
    const info = (costMap && costMap[slug]) || null
    if (info && (info.cost > 0 || info.premium)) return
    const img = a.find('img').first()
    let cover = img.attr('src') || ''
    // 时长在缩略图右下角的徽标里
    let duration = ''
    a.find('.aspect-video span').each((_, sp) => {
      const t = $(sp).text().trim()
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) duration = t
    })
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

async function getCards(ext) {
  ext = argsify(ext)
  let cards = []
  let { page = 1, id } = ext
  let url = appConfig.site + id
  if (page > 1) {
    url = url + (id.indexOf('?') !== -1 ? '&page=' + page : '?page=' + page)
  }

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
    cards = parseCards($, buildCostMap(html))
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

// 从响应头里按名字取 Location（不区分大小写）
function pickHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return ''
  if (headers[name]) return String(headers[name])
  var lower = name.toLowerCase()
  for (var k in headers) {
    if (k && k.toLowerCase() === lower) return String(headers[k])
  }
  return ''
}

// 从 $fetch 响应对象里能拿到的任何字段里找最终地址。
// 不同运行环境字段名不一样，这里把常见的都试一遍。
function finalUrlFromResponse(res) {
  if (!res || typeof res !== 'object') return ''
  var cands = [
    res.url, res.responseUrl, res.responseURL, res.finalUrl,
    res.finalURL, res.requestUrl, res.effectiveUrl,
  ]
  for (var i = 0; i < cands.length; i++) {
    if (cands[i] && String(cands[i]).indexOf('http') === 0) return String(cands[i])
  }
  var req = res.request
  if (req && typeof req === 'object') {
    if (req.url && String(req.url).indexOf('http') === 0) return String(req.url)
    if (req.responseURL && String(req.responseURL).indexOf('http') === 0) return String(req.responseURL)
    if (req.res && req.res.responseUrl && String(req.res.responseUrl).indexOf('http') === 0) return String(req.res.responseUrl)
  }
  return ''
}

// 把可能是相对地址的 Location 解析成绝对地址
function resolveLocation(base, loc) {
  if (!loc) return ''
  var l = String(loc).trim()
  if (!l) return ''
  if (l.indexOf('http://') === 0 || l.indexOf('https://') === 0) return l
  if (l.indexOf('//') === 0) return 'https:' + l
  var m = String(base).match(/^(https?:\/\/[^\/]+)/)
  var origin = m ? m[1] : ''
  if (l.charAt(0) === '/') return origin + l
  var b = String(base).split('?')[0]
  var slash = b.lastIndexOf('/')
  return (slash > 0 ? b.slice(0, slash + 1) : origin + '/') + l
}

async function resolveGofileRedirect(url, referer) {
  if (!url || url.indexOf('gofile.io') === -1) return url
  var headers = {
    'User-Agent': UA,
    'Referer': referer,
    'Range': 'bytes=0-0',
  }
  // gofile 跳转目标每个文件都不一样（实测有 file-na-chi-1、file-eu-par-1，
  // 还有 store-na-phx-4、store-eu-par-6、store10 等中间站），不能靠猜
  // 主机名，必须一跳一跳真拿到 Location。循环最多 5 跳：每跳都尽量
  // 不跟随跳转、直接读 302 的 Location；某跳无 Location 说明已直出，
  // 该跳地址就是最终地址。
  var current = url
  for (var hop = 0; hop < 5; hop++) {
    var loc = ''
    // a) 标准 fetch（若运行环境提供）
    try {
      if (typeof fetch === 'function') {
        var fr = await fetch(current, { method: 'GET', headers: headers, redirect: 'manual' })
        if (fr && fr.headers) {
          if (typeof fr.headers.get === 'function') loc = fr.headers.get('location') || fr.headers.get('Location') || ''
          else loc = pickHeader(fr.headers, 'location')
        }
        if (!loc && fr && fr.url && String(fr.url).indexOf('http') === 0 && fr.url !== current) return String(fr.url)
      }
    } catch (e) {}
    // b) $fetch 不跟随跳转
    if (!loc) {
      try {
        var res = await $fetch.get(current, { headers: headers, redirect: 'manual' })
        loc = pickHeader(res && res.headers, 'location')
        if (!loc) {
          var fin = finalUrlFromResponse(res)
          if (fin && fin !== current) return fin
        }
      } catch (e) {
        try {
          loc = pickHeader(e && e.response && e.response.headers, 'location')
        } catch (_) {}
      }
    }
    if (!loc) break
    var next = resolveLocation(current, loc)
    if (!next || next === current) break
    current = next
  }
  if (current !== url) return current
  // 跟随一次跳转，从响应对象里找最终地址（旧兜底）
  try {
    var res2 = await $fetch.get(url, { headers: headers })
    var fin2 = finalUrlFromResponse(res2)
    if (fin2 && fin2 !== url) return fin2
    var loc2 = pickHeader(res2 && res2.headers, 'location')
    if (loc2) {
      var n2 = resolveLocation(url, loc2)
      if (n2 && n2 !== url) return n2
    }
  } catch (e) {
    try {
      var loc3 = pickHeader(e && e.response && e.response.headers, 'location')
      if (loc3) {
        var n3 = resolveLocation(url, loc3)
        if (n3 && n3 !== url) return n3
      }
    } catch (_) {}
  }
  return url
}

function extractGofileMp4(html) {
  if (!html || typeof html !== 'string') return ''
  // 详情页 SSR 数据里的 videoUrl 是完整视频；收费视频这里是 null，
  // 预览地址在 previewVideoUrl / previewUrls 里，不取。
  const m = html.match(/videoUrl:"(https?:\/\/[^"]+\.mp4[^"]*)"/)
  if (m && m[1] && m[1].indexOf('preview') === -1) return m[1]
  // 兜底：主播放器 <video src="...gofile...mp4">
  const v = html.match(/<video[^>]*src="(https?:\/\/[^"]*gofile\.io[^"]+\.mp4[^"]*)"/i)
  if (v && v[1]) return v[1]
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
      const { data } = await $fetch.get(targetUrl, {
        headers: {
          'User-Agent': UA,
          'Referer': referer,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })
      const html = typeof data === 'string' ? data : JSON.stringify(data || '')
      finalMediaUrl = extractGofileMp4(html)
      if (finalMediaUrl && finalMediaUrl.indexOf('gofile.io') !== -1) {
        // 用详情页地址当 Referer 跟随一次 302，拿最终 file-*.gofile.io 地址
        finalMediaUrl = await resolveGofileRedirect(finalMediaUrl, targetUrl)
      }
    }

    if (finalMediaUrl) {
      $print('提取到直链: ' + finalMediaUrl)
    } else {
      $print('该视频需积分/未公开直链，返回空列表')
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
    cards = parseCards($, buildCostMap(html))
  } catch (e) {
    $print('search 错误: ' + e)
  }

  return jsonify({
    list: cards,
  })
}
