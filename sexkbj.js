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

function resolveUrl(rawUrl, baseUrl) {
  let u = (rawUrl || '').trim()
  if (!u) return ''
  if (u.startsWith('http://') || u.startsWith('https://')) {
    return u
  }
  if (u.startsWith('//')) {
    return 'https:' + u
  }
  if (u.startsWith('/')) {
    const originMatch = (baseUrl || appConfig.site).match(/^(https?:\/\/[^/]+)/i)
    const origin = originMatch ? originMatch[1] : appConfig.site
    return origin + u
  }
  const baseDir = (baseUrl || appConfig.site + '/').replace(/[^/]*$/, '')
  return baseDir + u
}

function extractMediaUrl(htmlText) {
  if (!htmlText || typeof htmlText !== 'string') return ''
  const cleaned = htmlText.replace(/\\\//g, '/')

  const patterns = [
    /(https?:\/\/[^"'\\\s<>]+?master\.m3u8[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?\/video\/video\.m3u8[^"'\\\s<>]*)/i,
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
      let cover = $(el).find('img.video-main-thumb').attr('src') \vert{}\vert{}$(el).find('img').attr('src') ||
                 $(el).find('img').attr('data-src') \vert{}\vert{}$(el).attr('data-main-thumb') || ''
      let duration = $(el).find('.duration').text().trim() \vert{}\vert{}$(el).find('span.duration').text().trim() || ''

      if (href && title) {
        href = resolveUrl(href, appConfig.site)
        cover = resolveUrl(cover, appConfig.site)
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

    const $ = cheerio.load(data)
    let foundIframes = []

    $('iframe').each((_, el) => {
      const rawSrc = $(el).attr('src') \vert{}\vert{}$(el).attr('data-src') || ''
      const fullSrc = resolveUrl(rawSrc, url)
      if (fullSrc) {
        foundIframes.push(fullSrc)
      }
    })

    $print('找到 iframe 数量: ' + foundIframes.length + ' -> ' + JSON.stringify(foundIframes))

    let iframeSrc = foundIframes.find(src =>
      /playerrecord|recordplay|\/e\/|streamwish|filemoon|embed|player/i.test(src)
    ) || foundIframes[0] || ''

    if (iframeSrc) {
      tracks.push({
        name: '播放',
        pan: '',
        ext: {
          url: iframeSrc,
          referer: url,
        },
      })
    } else {
      // 如果没有 iframe，也尝试直接把详情页传给 getPlayinfo 兜底查找
      tracks.push({
        name: '播放',
        pan: '',
        ext: {
          url: url,
          referer: 'https://sexkbj.com/',
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
    const { data } = await $fetch.get(playUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': referer,
      },
    })

    let mediaUrl = extractMediaUrl(data)

    // 如果第一层没有直接拿到视频流，尝试找内层嵌套 iframe 再查一次
    if (!mediaUrl && typeof data === 'string') {
      const $ = cheerio.load(data)
      const innerRaw = $('iframe').first().attr('src') \vert{}\vert{}$('iframe').first().attr('data-src') || ''
      const innerUrl = resolveUrl(innerRaw, playUrl)

      if (innerUrl && innerUrl !== playUrl) {
        $print('尝试二层 iframe: ' + innerUrl)
        const subRes = await $fetch.get(innerUrl, {
          headers: {
            'User-Agent': UA,
            'Referer': playUrl,
          },
        })
        playUrl = innerUrl
        referer = ext.referer || 'https://sexkbj.com/'
        mediaUrl = extractMediaUrl(subRes.data)
      }
    }

    if (mediaUrl) {
      playUrl = mediaUrl
      $print('解析到播放地址: ' + playUrl)
    } else {
      $print('未能直接解析出 m3u8/mp4，当前返回地址: ' + playUrl)
    }
  } catch (e) {
    $print('getPlayinfo 错误: ' + e)
  }

  return jsonify({
    urls: [playUrl],
    headers: [{
      'User-Agent': UA,
      'Referer': referer,
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
      let cover = $(el).find('img').attr('src') \vert{}\vert{}$(el).find('img').attr('data-src') || ''
      let duration = $(el).find('.duration').text().trim() || ''

      if (href && title) {
        href = resolveUrl(href, appConfig.site)
        cover = resolveUrl(cover, appConfig.site)
        cards.push({
          vod_id: href,
          vod_name: title.trim(),
          vod_pic: cover,
          vod_remarks: duration,
          ext: {
            url: href,
