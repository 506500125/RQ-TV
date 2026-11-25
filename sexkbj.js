const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const appConfig = {
  ver: 1,
  title: 'SexKBJ',
  site: 'https://sexkbj.com',
  tabs: [
    {
      name: '最新',
      ext: {
        id: '/?filter=latest',
      },
    },
    {
      name: '最热',
      ext: {
        id: '/?filter=most-viewed',
      },
    },
    {
      name: 'Korean BJ',
      ext: {
        id: '/category/korean-bj/',
      },
    },
    {
      name: 'Korean Amateur',
      ext: {
        id: '/category/korean-amateur/',
      },
    },
  ],
}

function normalizeUrl(rawUrl, baseUrl) {
  let u = String(rawUrl || '').trim()
  if (!u) return ''
  u = u.replace(/\\\//g, '/')
  if (u.startsWith('http://') || u.startsWith('https://')) {
    return u
  }
  if (u.startsWith('//')) {
    return 'https:' + u
  }
  if (u.startsWith('/')) {
    const m = String(baseUrl || appConfig.site).match(/^(https?:\/\/[^/]+)/i)
    return (m ? m[1] : appConfig.site) + u
  }
  return appConfig.site + '/' + u.replace(/^\.?\//, '')
}

function isDirectMediaUrl(u) {
  if (!u || typeof u !== 'string') return false
  return /\.(m3u8|mp4)(\?|$)/i.test(u)
}

function extractStreamUrl(text) {
  if (!text || typeof text !== 'string') return ''
  const cleaned = text.replace(/\\\//g, '/')

  const patterns = [
    /(https?:\/\/[^"'\\\s<>]+?sexkbj\.top[^"'\\\s<>]*?\.m3u8[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?index-v1-a1\.m3u8[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?master\.m3u8[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?\.m3u8[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?\.mp4[^"'\\\s<>]*)/i,
  ]

  for (const reg of patterns) {
    const m = cleaned.match(reg)
    if (m && m[1]) {
      return m[1]
    }
  }
  return ''
}

async function getConfig() {
  return jsonify(appConfig)
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
      url = appConfig.site + id + 'page/' + page + '/'
    }
  }

  try {
    const { data } = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://sexkbj.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    })

    if (data.includes('Just a moment') || data.includes('cf-browser-verification') || data.includes('Checking your browser')) {
      $print('被 Cloudflare 拦截了')
      return jsonify({ list: [] })
    }

    const $ = cheerio.load(data)
    let items = $('article.loop-video, article.thumb-block, .videos-list article, .thumb-block')

    items.each((_, el) => {
      const a = $(el).find('a').first()
      let href = a.attr('href') || ''
      let title = a.attr('data-title') || $(el).find('img').attr('alt') || a.attr('title') || ''
      let cover = $(el).find('img.video-main-thumb').attr('src') ||
                 $(el).find('img').attr('src') ||
                 $(el).find('img').attr('data-src') ||
                 $(el).find('img').attr('data-main-thumb') || ''
      let duration = $(el).find('.duration').text().trim() || $(el).find('span.duration').text().trim() || ''

      if (href && title) {
        if (!href.startsWith('http')) href = appConfig.site + href
        cards.push({
          vod_id: href,
          vod_name: title.trim(),
          vod_pic: cover,
          vod_remarks: duration,
          ext: {
            url: href,
          },
        })
      }
    })

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
  let tracks = []
  const url = ext.url

  try {
    const { data } = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://sexkbj.com/',
      },
    })

    const directStream = extractStreamUrl(data)
    if (directStream) {
      tracks.push({
        name: '播放',
        pan: '',
        ext: {
          url: directStream,
          referer: 'https://sexkbj.com/',
        },
      })
    } else {
      const $ = cheerio.load(data)
      let candidates = []

      $('iframe').each((_, el) => {
        const src = normalizeUrl($(el).attr('src') || $(el).attr('data-src') || '', url)
        if (src) candidates.push(src)
      })

      $('video source, video').each((_, el) => {
        const src = normalizeUrl($(el).attr('src') || $(el).attr('data-src') || '', url)
        if (src) candidates.push(src)
      })

      $print('详情页候选地址: ' + JSON.stringify(candidates))

      tracks.push({
        name: '播放',
        pan: '',
        ext: {
          url: candidates[0] || url,
          referer: url,
        },
      })
    }
  } catch (e) {
    $print('getTracks 错误: ' + e)
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

async function getPlayinfo(ext) {
  ext = argsify(ext)
  let targetUrl = ext.url
  let referer = ext.referer || 'https://sexkbj.com/'
  let finalMediaUrl = ''

  try {
    if (isDirectMediaUrl(targetUrl)) {
      finalMediaUrl = targetUrl
    } else if (targetUrl) {
      const { data } = await $fetch.get(targetUrl, {
        headers: {
          'User-Agent': UA,
          'Referer': referer,
        },
      })

      finalMediaUrl = extractStreamUrl(data)

      if (!finalMediaUrl && typeof data === 'string') {
        const $ = cheerio.load(data)
        const nextRaw = $('iframe').first().attr('src') || $('iframe').first().attr('data-src') || ''
        const nextUrl = normalizeUrl(nextRaw, targetUrl)
        if (nextUrl && nextUrl !== targetUrl) {
          $print('检查内层 iframe: ' + nextUrl)
          const subRes = await $fetch.get(nextUrl, {
            headers: {
              'User-Agent': UA,
              'Referer': targetUrl,
            },
          })
          finalMediaUrl = extractStreamUrl(subRes.data)
        }
      }
    }

    if (finalMediaUrl) {
      $print('提取到直链: ' + finalMediaUrl)
    } else {
      $print('未能从静态响应中提取到动态 m3u8/mp4 直链（该站流地址由前端播放器脚本动态生成）')
    }
  } catch (e) {
    $print('getPlayinfo 错误: ' + e)
  }

  return jsonify({
    urls: finalMediaUrl ? [finalMediaUrl] : [],
    headers: [{
      'User-Agent': UA,
      'Referer': 'https://sexkbj.com/',
      'Origin': 'https://sexkbj.com',
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
    const { data } = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://sexkbj.com/',
      },
    })

    const $ = cheerio.load(data)
    let items = $('article.loop-video, article.thumb-block, .videos-list article, .thumb-block')

    items.each((_, el) => {
      const a = $(el).find('a').first()
      let href = a.attr('href') || ''
      let title = a.attr('data-title') || $(el).find('img').attr('alt') || ''
      let cover = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || ''
      let duration = $(el).find('.duration').text().trim() || ''

      if (href && title) {
        if (!href.startsWith('http')) href = appConfig.site + href
        cards.push({
          vod_id: href,
          vod_name: title.trim(),
          vod_pic: cover,
          vod_remarks: duration,
          ext: {
            url: href,
          },
        })
      }
    })
  } catch (e) {
    $print('search 错误: ' + e)
  }

  return jsonify({
    list: cards,
  })
}
