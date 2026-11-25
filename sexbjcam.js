const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const appConfig = {
  ver: 1,
  title: 'SexBJCam',
  site: 'https://sexbjcam.com',
  tabs: [
    {
      name: '首页',
      ext: {
        id: '/',
      },
    },
    {
      name: '最新',
      ext: {
        id: '/?filter=latest',
      },
    },
    {
      name: 'KOREAN BJ',
      ext: {
        id: '/category/korean-bj/',
      },
    },
    {
      name: 'CHINESE GIRL',
      ext: {
        id: '/category/chinese-girl/',
      },
    },
  ],
}

function fixLink(raw, base) {
  let u = String(raw || '').trim()
  if (!u) return ''
  u = u.replace(/\\\//g, '/')
  if (u.startsWith('http://') || u.startsWith('https://')) return u
  if (u.startsWith('//')) return 'https:' + u
  if (u.startsWith('/')) {
    const m = String(base || appConfig.site).match(/^(https?:\/\/[^/]+)/i)
    return (m ? m[1] : appConfig.site) + u
  }
  return appConfig.site + '/' + u.replace(/^\.?\//, '')
}

function findRealStream(html) {
  if (!html || typeof html !== 'string') return ''
  const text = html.replace(/\\\//g, '/')
  const matches = text.match(/https?:\/\/[^"'\\\s<>]+?\.(?:m3u8|mp4)[^"'\\\s<>]*/gi) || []
  const unique = [...new Set(matches)]

  if (unique.length > 0) {
    $print('抓到的流地址: ' + JSON.stringify(unique))
  }

  const noAd = unique.filter(u =>
    !/(\/ads?\/|preroll|midroll|postroll|commercial|promo|sponsor|vast|ima)/i.test(u)
  )

  return (
    noAd.find(u => /so279tk\.cc/i.test(u) && /master\.m3u8/i.test(u)) ||
    noAd.find(u => /so279tk\.cc/i.test(u)) ||
    noAd.find(u => /master\.m3u8/i.test(u)) ||
    ''
  )
}

async function getConfig() {
  return jsonify(appConfig)
}

async function getCards(ext) {
  ext = argsify(ext)
  let cards = []
  let { page = 1, id = '/' } = ext

  let basePath = id === '/' ? '' : id
  let url = appConfig.site + basePath
  if (page > 1) {
    if (basePath.includes('?')) {
      url = appConfig.site + basePath + '&page=' + page
    } else if (basePath === '') {
      url = appConfig.site + '/page/' + page + '/'
    } else {
      url = appConfig.site + (basePath.endsWith('/') ? basePath : basePath + '/') + 'page/' + page + '/'
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

    if (!data || typeof data !== 'string') {
      $print('getCards 响应为空')
      return jsonify({ list: [] })
    }

    if (data.includes('Just a moment') || data.includes('cf-browser-verification') || data.includes('Checking your browser')) {
      $print('被 Cloudflare 拦截了')
      return jsonify({ list: [] })
    }

    const $ = cheerio.load(data)
    let items = $('article, .thumb-block, .video-item, .videos-list > div, .loop-video')

    const seen = new Set()
    items.each((_, el) => {
      const a = $(el).find('a[href]').first()
      let href = fixLink(a.attr('href') || '', appConfig.site)
      if (!href || href === appConfig.site + '/' || seen.has(href)) return

      const img = $(el).find('img').first()
      let title = (
        a.attr('data-title') ||
        a.attr('title') ||
        img.attr('alt') ||
        img.attr('title') ||
        $(el).find('.title, .video-title, h2, h3').first().text() ||
        ''
      ).trim()

      let cover = fixLink(
        img.attr('data-src') ||
        img.attr('data-original') ||
        img.attr('data-lazy-src') ||
        img.attr('data-main-thumb') ||
        img.attr('src') ||
        '',
        appConfig.site
      )

      let duration = (
        $(el).find('.duration, span.duration, .time, .length').first().text() || ''
      ).trim()

      if (href && title) {
        seen.add(href)
        cards.push({
          vod_id: href,
          vod_name: title,
          vod_pic: cover,
          vod_remarks: duration,
          ext: {
            url: href,
          },
        })
      }
    })

    $print('sexbjcam 抓到视频数量: ' + cards.length)
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
        'Referer': appConfig.site + '/',
      },
    })

    const $ = cheerio.load(data)

    let iframeSrc = ''
    $('iframe').each((_, el) => {
      let src = $(el).attr('src') || $(el).attr('data-src') || ''
      if (src && (src.includes('playerrecord') || src.includes('recordplay') || src.includes('/e/'))) {
        iframeSrc = fixLink(src, url)
      }
    })

    if (!iframeSrc) {
      const firstIframe = $('iframe').first().attr('src') || $('iframe').first().attr('data-src') || ''
      if (firstIframe) iframeSrc = fixLink(firstIframe, url)
    }

    if (iframeSrc) {
      tracks.push({
        name: '播放',
        pan: '',
        ext: {
          url: iframeSrc,
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
  let playUrl = ext.url
  let referer = ext.referer || (appConfig.site + '/')
  let realStream = ''

  try {
    if (playUrl) {
      const { data } = await $fetch.get(playUrl, {
        headers: {
          'User-Agent': UA,
          'Referer': referer,
        },
      })

      realStream = findRealStream(data)

      if (!realStream && typeof data === 'string') {
        const $ = cheerio.load(data)
        const nextRaw = $('iframe').first().attr('src') || $('iframe').first().attr('data-src') || ''
        const nextUrl = fixLink(nextRaw, playUrl)
        if (nextUrl && nextUrl !== playUrl) {
          const subRes = await $fetch.get(nextUrl, {
            headers: {
              'User-Agent': UA,
              'Referer': playUrl,
            },
          })
          realStream = findRealStream(subRes.data)
        }
      }
    }

    if (realStream) {
      $print('解析到正片播放地址: ' + realStream)
    } else {
      $print('静态源码里未找到正片 m3u8/mp4，返回空链接避免误播广告')
    }
  } catch (e) {
    $print('getPlayinfo 错误: ' + e)
  }

  return jsonify({
    urls: realStream ? [realStream] : [],
    headers: [{
      'User-Agent': UA,
      'Referer': appConfig.site + '/',
      'Origin': appConfig.site,
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
        'Referer': appConfig.site + '/',
      },
    })

    const $ = cheerio.load(data)
    let items = $('article, .thumb-block, .video-item, .videos-list > div, .loop-video')

    const seen = new Set()
    items.each((_, el) => {
      const a = $(el).find('a[href]').first()
      let href = fixLink(a.attr('href') || '', appConfig.site)
      if (!href || href === appConfig.site + '/' || seen.has(href)) return

      const img = $(el).find('img').first()
      let title = (
        a.attr('data-title') ||
        a.attr('title') ||
        img.attr('alt') ||
        img.attr('title') ||
        $(el).find('.title, .video-title, h2, h3').first().text() ||
        ''
      ).trim()

      let cover = fixLink(
        img.attr('data-src') ||
        img.attr('data-original') ||
        img.attr('data-lazy-src') ||
        img.attr('data-main-thumb') ||
        img.attr('src') ||
        '',
        appConfig.site
      )

      let duration = (
        $(el).find('.duration, span.duration, .time, .length').first().text() || ''
      ).trim()

      if (href && title) {
        seen.add(href)
        cards.push({
          vod_id: href,
          vod_name: title,
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
