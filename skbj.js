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
//   而不是黑屏）。
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

function parseCards($) {
  const cards = []
  const seen = {}
  $('a[href^="/videos/"]').each((_, el) => {
    const a = $(el)
    const href = a.attr('href') || ''
    if (!href || seen[href]) return
    const title = (a.find('h2').first().text().trim() || a.find('h3').first().text().trim())
    if (!title) return
    seen[href] = true
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

async function resolveGofileRedirect(url, referer) {
  if (!url || url.indexOf('gofile.io') === -1) return url
  var headers = {
    'User-Agent': UA,
    'Referer': referer,
    'Range': 'bytes=0-0',
  }
  // 1) 尽量不跟随跳转，直接读 302 的 Location。XPTV 的 $fetch 若支持
  //    redirect:'manual'，这里就能拿到最终地址；不支持时也无害。
  //    注意：跳转目标每个文件都不一样（实测有 file-na-chi-1，也有
  //    file-eu-par-1），不能靠猜主机名，必须真拿到 Location。
  try {
    var res1 = await $fetch.get(url, { headers: headers, redirect: 'manual' })
    var loc1 = pickHeader(res1 && res1.headers, 'location')
    if (loc1 && loc1.indexOf('http') === 0 && loc1 !== url) return loc1
    var fin1 = finalUrlFromResponse(res1)
    if (fin1 && fin1 !== url) return fin1
  } catch (e) {}
  // 2) 跟随一次跳转，从响应对象里找最终地址
  try {
    var res2 = await $fetch.get(url, { headers: headers })
    var fin2 = finalUrlFromResponse(res2)
    if (fin2 && fin2 !== url) return fin2
    var loc2 = pickHeader(res2 && res2.headers, 'location')
    if (loc2 && loc2.indexOf('http') === 0 && loc2 !== url) return loc2
  } catch (e) {
    try {
      var loc3 = pickHeader(e && e.response && e.response.headers, 'location')
      if (loc3 && loc3.indexOf('http') === 0 && loc3 !== url) return loc3
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
    cards = parseCards($)
  } catch (e) {
    $print('search 错误: ' + e)
  }

  return jsonify({
    list: cards,
  })
}
