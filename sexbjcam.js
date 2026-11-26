const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

// 注意：2026-11-27 核查时 sexbjcam.com 在公开 DNS 里已无记录（NXDOMAIN），
// 从这边和云端浏览器都打不开，无法对照真站验证。本文件沿用仓库原有结构，
// 另补了与 sexkbj2.js 相同的两处播放修正：解包 VidHide 风格打包代码取 m3u8、
// 找不到直链时返回空列表而不是播放页地址。若域名恢复，可直接用。

const appConfig = {
  ver: 1,
  title: 'SexBJCam',
  site: 'https://sexbjcam.com',
  tabs: [
    { name: '最新', ext: { id: '/?filter=latest' } },
    { name: 'KOREAN BJ', ext: { id: '/category/korean-bj/' } },
    { name: 'CHINESE GIRL', ext: { id: '/category/chinese-girl/' } },
  ],
}

async function getConfig() {
  return jsonify(appConfig)
}

function normalizeUrl(rawUrl, baseUrl) {
  if (!rawUrl) return ''
  let u = String(rawUrl).trim()
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('//')) return 'https:' + u
  const base = (baseUrl || appConfig.site).replace(/\/+$/, '')
  return u.startsWith('/') ? base + u : base + '/' + u
}

async function getCards(ext) {
  ext = argsify(ext)
  let cards = []
  let { page = 1, id } = ext
  let url = appConfig.site + id

  if (page > 1) {
    if (id.includes('?')) {
      url = appConfig.site + id + '&page=' + page
    } else {
      url = appConfig.site + id.replace(/\/?$/, '/') + 'page/' + page + '/'
    }
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
    if (html.includes('Just a moment') || html.includes('cf-browser-verification') || html.includes('Checking your browser')) {
      $print('被 Cloudflare 拦截了')
      return jsonify({ list: [] })
    }

    const $ = cheerio.load(html)
    let items = $('article.loop-video, article.thumb-block, .videos-list article, .thumb-block')

    items.each((_, el) => {
      const a = $(el).find('a').first()
      let href = a.attr('href') || ''
      let title = a.attr('data-title') || $(el).find('img').attr('alt') || a.attr('title') || ''
      let cover =
        $(el).find('img.video-main-thumb').attr('src') ||
        $(el).find('img').attr('src') ||
        $(el).find('img').attr('data-src') ||
        $(el).find('img').attr('data-main-thumb') ||
        ''
      let duration = $(el).find('.duration').text().trim() || $(el).find('span.duration').text().trim() || ''

      if (href && title) {
        href = normalizeUrl(href, appConfig.site)
        cover = normalizeUrl(cover, appConfig.site)
        cards.push({
          vod_id: href,
          vod_name: title.trim(),
          vod_pic: cover,
          vod_remarks: duration,
          ext: { url: href },
        })
      }
    })
    $print('抓到视频数量: ' + cards.length)
  } catch (e) {
    $print('getCards 错误: ' + e)
  }

  return jsonify({ list: cards })
}

async function getTracks(ext) {
  ext = argsify(ext)
  let tracks = []
  const url = ext.url

  try {
    const { data } = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': appConfig.site + '/',
      },
    })

    const html = typeof data === 'string' ? data : JSON.stringify(data || '')
    const $ = cheerio.load(html)
    let iframeSrc = ''

    $('iframe').each((_, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src') || ''
      if (src && (src.includes('playerrecord') || src.includes('recordplay') || src.includes('/e/'))) {
        iframeSrc = normalizeUrl(src, url)
      }
    })

    if (!iframeSrc) {
      let firstSrc = $('iframe').first().attr('src') || $('iframe').first().attr('data-src') || ''
      if (firstSrc) {
        iframeSrc = normalizeUrl(firstSrc, url)
      }
    }

    if (iframeSrc) {
      tracks.push({
        name: '播放 (Iframe已提取)',
        pan: '',
        ext: {
          url: iframeSrc,
          referer: url,
        },
      })
    } else {
      // 兜底：若无 iframe，尝试直接用详情页本身去抓 m3u8
      tracks.push({
        name: '直连尝试 (未见Iframe)',
        pan: '',
        ext: {
          url: url,
          referer: appConfig.site + '/',
        },
      })
    }
  } catch (e) {
    tracks.push({
      name: 'getTracks异常: ' + String(e).slice(0, 30),
      pan: '',
      ext: { url: url, referer: appConfig.site + '/' },
    })
  }

  return jsonify({
    list: [
      {
        title: '在线播放',
        tracks: tracks,
      },
    ],
  })
}

// VidHide 风格的打包播放代码（sexkbj.com 同款问题）：m3u8 藏在
// eval(function(p,a,c,k,e,d){...}('...',36,603,'词|典'.split('|'),0,{}))
// 里，原文里没有完整地址，正则搜不到。按字典一次还原再取 m3u8。
function unpackPackedJs(html) {
  try {
    const m = html.match(/\}\('((?:\\.|[^'\\])*)',(\d+),(\d+),'((?:\\.|[^'\\])*)'\.split\('\|'\)/)
    if (!m) return ''
    const p = m[1]
    const a = parseInt(m[2], 10)
    const c = parseInt(m[3], 10)
    const k = m[4].split('|')
    const d = {}
    for (let i = 0; i < c; i++) d[i.toString(a)] = k[i] || i.toString(a)
    return p.replace(/\b\w+\b/g, function (w) {
      return Object.prototype.hasOwnProperty.call(d, w) ? d[w] : w
    })
  } catch (e) {
    return ''
  }
}

function extractM3u8FromPacked(html) {
  if (!html || typeof html !== 'string') return ''
  const unpacked = unpackPackedJs(html)
  if (!unpacked) return ''
  const m = unpacked.match(/https?:\/\/[^\s"'<>]+?\.m3u8(?:[?#][^\s"'<>]*)?/)
  return m ? m[0] : ''
}

async function getPlayinfo(ext) {
  ext = argsify(ext)
  let targetUrl = ext.url
  let referer = ext.referer || (appConfig.site + '/')
  let finalUrl = ''
  let effectiveReferer = referer

  try {
    if (targetUrl && /\.(m3u8|mp4)(\?|#|$)/i.test(targetUrl)) {
      // 目标本身就是直链
      finalUrl = targetUrl
      effectiveReferer = referer
    } else {
    const res = await $fetch.get(targetUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': referer,
      },
    })

    let rawText = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || '')
    // 兼容转义斜杠、Unicode 斜杠以及协议相对路径
    let cleanText = rawText.replace(/\\\//g, '/').replace(/\\u002F/gi, '/')

    let allM3u8 = cleanText.match(/(?:https?:)?\/\/[^"'\\\s<>]+?\.m3u8[^"'\\\s<>]*/gi) || []
    allM3u8 = [...new Set(allM3u8)].map((u) => {
      let cleaned = u.replace(/['")\]}>]+$/, '')
      return cleaned.startsWith('//') ? 'https:' + cleaned : cleaned
    })

    let filtered = allM3u8.filter((u) => !/(ad|preroll|midroll|postroll|promo|sponsor|vast)/i.test(u))

    let picked =
      filtered.find((u) => /so279tk\.cc/i.test(u) && /master\.m3u8/i.test(u)) ||
      filtered.find((u) => /master\.m3u8/i.test(u)) ||
      filtered.find((u) => /\/video\/video\.m3u8/i.test(u)) ||
      filtered[0] ||
      allM3u8[0] ||
      ''

    if (picked) {
      finalUrl = picked
      // 切片与播放清单通常校验播放器页面（即 targetUrl）作为 Referer
      effectiveReferer = targetUrl
    } else {
      // 先试解包（VidHide 风格的打包代码，m3u8 藏在字典里）
      const unpackedM3u8 = extractM3u8FromPacked(cleanText)
      if (unpackedM3u8) {
        finalUrl = unpackedM3u8
        effectiveReferer = targetUrl
      } else {
      // 如果没直接拿到 m3u8，看看 iframe 内部是否还嵌套了第二层 iframe
      const nestedMatch = cleanText.match(/<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/i)
      if (nestedMatch && nestedMatch[1]) {
        const nestedUrl = normalizeUrl(nestedMatch[1], targetUrl)
        const subRes = await $fetch.get(nestedUrl, {
          headers: {
            'User-Agent': UA,
            'Referer': targetUrl,
          },
        })
        const subRaw = typeof subRes.data === 'string' ? subRes.data : JSON.stringify(subRes.data || '')
        const subClean = subRaw.replace(/\\\//g, '/').replace(/\\u002F/gi, '/')
        let subM3u8 = subClean.match(/(?:https?:)?\/\/[^"'\\\s<>]+?\.m3u8[^"'\\\s<>]*/gi) || []
        subM3u8 = [...new Set(subM3u8)].map((u) => {
          let cleaned = u.replace(/['")\]}>]+$/, '')
          return cleaned.startsWith('//') ? 'https:' + cleaned : cleaned
        })
        const subFiltered = subM3u8.filter((u) => !/(ad|preroll|midroll|postroll|promo|sponsor|vast)/i.test(u))
        const subPicked = subFiltered[0] || subM3u8[0] || ''
        if (subPicked) {
          finalUrl = subPicked
          effectiveReferer = nestedUrl
        } else {
          const subUnpacked = extractM3u8FromPacked(subClean)
          if (subUnpacked) {
            finalUrl = subUnpacked
            effectiveReferer = nestedUrl
          }
        }
      }
      }
    }
    } // else: 目标不是直链，上面已处理
  } catch (e) {
    $print('getPlayinfo 错误: ' + e)
  }

  let origin = ''
  try {
    const m = effectiveReferer.match(/^(https?:\/\/[^/]+)/i)
    if (m) origin = m[1]
  } catch (_) {}

  const headerObj = {
    'User-Agent': UA,
    'Referer': effectiveReferer,
  }
  if (origin) {
    headerObj['Origin'] = origin
  }

  return jsonify({
    // 找不到直链就返回空列表，不要把播放页地址当成视频地址返回（会黑屏）
    urls: finalUrl ? [finalUrl] : [],
    headers: [headerObj],
  })
}

async function search(ext) {
  ext = argsify(ext)
  let cards = []
  const text = ext.text || ''
  if (!text) return jsonify({ list: cards })

  const url = appConfig.site + '/?s=' + encodeURIComponent(text)
  try {
    const { data } = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': appConfig.site + '/',
      },
    })

    const html = typeof data === 'string' ? data : JSON.stringify(data || '')
    const $ = cheerio.load(html)
    let items = $('article.loop-video, article.thumb-block, .videos-list article, .thumb-block')

    items.each((_, el) => {
      const a = $(el).find('a').first()
      let href = a.attr('href') || ''
      let title = a.attr('data-title') || $(el).find('img').attr('alt') || ''
      let cover = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || ''
      let duration = $(el).find('.duration').text().trim() || ''

      if (href && title) {
        cards.push({
          vod_id: normalizeUrl(href, appConfig.site),
          vod_name: title.trim(),
          vod_pic: normalizeUrl(cover, appConfig.site),
          vod_remarks: duration,
          ext: { url: normalizeUrl(href, appConfig.site) },
        })
      }
    })
  } catch (e) {
    $print('search 错误: ' + e)
  }

  return jsonify({ list: cards })
}

