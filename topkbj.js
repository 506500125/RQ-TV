// topkbj.js — TopKBJ 的 XPTV JS 扩展源
// 站点：https://topkbj.com ，Next.js 服务端渲染
// 实测结构（2026-11-27）：
//   列表：/latest?page=N（共约 10659 条），卡片 .video-grid a[href^="/video/"]，
//         img alt=标题、src=封面（相对路径）、时长徽标、演员、日期。
//         分类：/tag/pandatv（PandaTV）。
//   搜索：/search?q=<关键词>，同一套卡片。
//   详情：/video/<slug>，播放器是
//         <iframe src="/api/video-player?url=<编码的 playerrecord 地址>">，
//         取该地址返回的 HTML 里有直链 master.m3u8（so279tk.cc，
//         实测 200、真 #EXTM3U 清单）。每次点播现取现解。
//
// 依赖：运行环境提供的 createCheerio()、$fetch、jsonify、argsify、$print。

const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const appConfig = {
  ver: 1,
  title: 'TopKBJ',
  site: 'https://topkbj.com',
  tabs: [
    {
      name: '最新',
      ext: {
        id: '/latest',
      },
    },
    {
      name: 'PandaTV',
      ext: {
        id: '/tag/pandatv',
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
  $('.video-grid a[href^="/video/"]').each((_, el) => {
    const a = $(el)
    const href = a.attr('href') || ''
    if (!href || seen[href]) return
    const img = a.find('img').first()
    const title = (img.attr('alt') || a.find('h3').first().text() || '').trim()
    if (!title) return
    seen[href] = true
    let duration = ''
    a.find('div').each((_, dv) => {
      const t = $(dv).text().trim()
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(t)) duration = t
    })
    const detailUrl = normalizeUrl(href)
    cards.push({
      vod_id: detailUrl,
      vod_name: title,
      vod_pic: normalizeUrl(img.attr('src') || ''),
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
  let tracks = []

  try {
    const { data } = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': appConfig.site + '/',
      },
    })
    const html = typeof data === 'string' ? data : JSON.stringify(data || '')
    const $ = cheerio.load(html)
    let playerUrl = ''
    $('iframe').each((_, el) => {
      const src = $(el).attr('src') || ''
      if (src.indexOf('video-player?url=') !== -1) playerUrl = normalizeUrl(src, url)
    })
    if (!playerUrl) {
      const firstSrc = $('iframe').first().attr('src') || ''
      if (firstSrc) playerUrl = normalizeUrl(firstSrc, url)
    }
    tracks.push({
      name: '播放',
      pan: '',
      ext: {
        url: playerUrl || url,
        referer: url,
      },
    })
  } catch (e) {
    $print('getTracks 错误: ' + e)
    tracks.push({
      name: '播放',
      pan: '',
      ext: {
        url: url,
        referer: appConfig.site + '/',
      },
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

function extractM3u8(html) {
  if (!html || typeof html !== 'string') return ''
  const m = html.match(/https?:\/\/[^\s"'<>\\]+?\.m3u8(?:[?#][^\s"'<>\\]*)?/)
  return m ? m[0] : ''
}

async function getPlayinfo(ext) {
  ext = argsify(ext)
  let targetUrl = ext.url
  let referer = ext.referer || (appConfig.site + '/')
  let finalMediaUrl = ''
  let playReferer = referer

  try {
    if (targetUrl && /\.m3u8(\?|#|$)/i.test(targetUrl)) {
      finalMediaUrl = targetUrl
    } else if (targetUrl) {
      // 目标是详情页：先找播放器 iframe，再取播放器页里的 m3u8
      let playerUrl = targetUrl
      if (targetUrl.indexOf('video-player?url=') === -1) {
        const { data } = await $fetch.get(targetUrl, {
          headers: {
            'User-Agent': UA,
            'Referer': referer,
          },
        })
        const html = typeof data === 'string' ? data : JSON.stringify(data || '')
        const $ = cheerio.load(html)
        let found = ''
        $('iframe').each((_, el) => {
          const src = $(el).attr('src') || ''
          if (src.indexOf('video-player?url=') !== -1) found = normalizeUrl(src, targetUrl)
        })
        if (found) playerUrl = found
      }
      playReferer = playerUrl
      const { data } = await $fetch.get(playerUrl, {
        headers: {
          'User-Agent': UA,
          'Referer': referer,
        },
      })
      const html = typeof data === 'string' ? data : JSON.stringify(data || '')
      finalMediaUrl = extractM3u8(html)
    }

    if (finalMediaUrl) {
      $print('提取到直链: ' + finalMediaUrl)
    } else {
      $print('未能提取到 m3u8 直链，返回空列表')
    }
  } catch (e) {
    $print('getPlayinfo 错误: ' + e)
  }

  return jsonify({
    urls: finalMediaUrl ? [finalMediaUrl] : [],
    headers: [{
      'User-Agent': UA,
      'Referer': playReferer,
      'Origin': appConfig.site,
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
