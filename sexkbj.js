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

    // 1. 先看看详情页源码里是否已经直接带了 m3u8 / mp4
    const directStream = extractStreamUrl(data)
    if (directStream) {
      tracks.push({
        name: '播放',
        pan: '',
        ext: {
          url: directStream,
          referer: 'https://sexkbj.com/',
          direct: true,
        },
      })
    } else {
      // 2. 否则抓取详情页里的 iframe / source / video 地址
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

      $print('详情页候选播放地址: ' + JSON.stringify(candidates))

      const target = candidates[0] || url
      tracks.push({
        name: '播放',
        pan: '',
        ext: {
          url: target,
          referer: url,
          direct: false,
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
  let playUrl = ext.url
  let referer = ext.referer || 'https://sexkbj.com/'

  try {
    if (!ext.direct && playUrl) {
      const { data } = await $fetch.get(playUrl, {
        headers: {
          'User-Agent': UA,
          'Referer': referer,
        },
      })

      let stream = extractStreamUrl(data)

      // 如果第一层页面里还有内层 iframe，再追查一层
      if (!stream && typeof data === 'string') {
        const $ = cheerio.load(data)
        const nextRaw = $('iframe').first().attr('src') || $('iframe').first().attr('data-src') || ''
        const nextUrl = normalizeUrl(nextRaw, playUrl)
        if (nextUrl && nextUrl !== playUrl) {
          $print('继续追踪内层 iframe: ' + nextUrl)
          const subRes = await $fetch.get(nextUrl, {
            headers: {
              'User-Agent': UA,
              'Referer': playUrl,
            },
          })
          playUrl = nextUrl
          stream = extractStreamUrl(subRes.data)
        }
      }

      if (stream) {
        playUrl = stream
        $print('成功提取 m3u8/mp4: ' + playUrl)
      } else {
        $print('未能提取到 m3u8/mp4，当前地址: ' + playUrl)
      }
    }
  } catch (e) {
    $print('getPlayinfo 错误: ' + e)
  }

  return jsonify({
    urls: [playUrl],
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
