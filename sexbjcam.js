const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const appConfig = {
  ver: 1,
  title: 'SexBJCam',
  site: 'https://sexbjcam.com',
  tabs: [
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

function extractM3u8(html) {
  if (!html || typeof html !== 'string') return ''
  const text = html.replace(/\\\//g, '/')
  const regs = [
    /(https?:\/\/[^"'\\\s<>]+?so279tk\.cc[^"'\\\s<>]*?master\.m3u8[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?master\.m3u8[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?\/video\/video\.m3u8[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?\.m3u8[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?\.mp4[^"'\\\s<>]*)/i,
  ]
  for (const r of regs) {
    const hit = text.match(r)
    if (hit && hit[1]) return hit[1]
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
        'Referer': 'https://sexbjcam.com/',
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
        'Referer': 'https://sexbjcam.com/',
      },
    })

    const directStream = extractM3u8(data)
    if (directStream) {
      tracks.push({
        name: '播放',
        pan: '',
        ext: {
          url: directStream,
          referer: 'https://sexbjcam.com/',
          isDirect: true,
        },
      })
    } else {
      const $ = cheerio.load(data)
      let iframes = []

      $('iframe').each((_, el) => {
        const src = fixLink($(el).attr('src') || $(el).attr('data-src') || '', url)
        if (src) iframes.push(src)
      })

      $print('找到 iframe: ' + JSON.stringify(iframes))

      let iframeSrc = iframes.find(src =>
        /playerrecord|recordplay|\/e\/|embed|player|so279tk/i.test(src)
      ) || iframes[0] || ''

      if (iframeSrc) {
        tracks.push({
          name: '播放',
          pan: '',
          ext: {
            url: iframeSrc,
            referer: url,
            isDirect: false,
          },
        })
      }
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
  let referer = ext.referer || 'https://sexbjcam.com/'

  try {
    if (!ext.isDirect && playUrl) {
      const { data } = await $fetch.get(playUrl, {
        headers: {
          'User-Agent': UA,
          'Referer': referer,
        },
      })

      let found = extractM3u8(data)

      // 若第一层页面里还有一层 iframe，再往下查一次
      if (!found && typeof data === 'string') {
        const $ = cheerio.load(data)
        const subRaw = $('iframe').first().attr('src') || $('iframe').first().attr('data-src') || ''
        const subUrl = fixLink(subRaw, playUrl)
        if (subUrl && subUrl !== playUrl) {
          $print('检查二层 iframe: ' + subUrl)
          const subRes = await $fetch.get(subUrl, {
            headers: {
              'User-Agent': UA,
              'Referer': playUrl,
            },
          })
          playUrl = subUrl
          found = extractM3u8(subRes.data)
        }
      }

      if (found) {
        playUrl = found
        $print('解析到播放地址: ' + playUrl)
      } else {
        $print('未能解析出 m3u8，当前返回地址: ' + playUrl)
      }
    }
  } catch (e) {
    $print('getPlayinfo 错误: ' + e)
  }

  return jsonify({
    urls: [playUrl],
    headers: [{
      'User-Agent': UA,
      'Referer': 'https://sexbjcam.com/',
      'Origin': 'https://sexbjcam.com',
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
        'Referer': 'https://sexbjcam.com/',
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
