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
                 $(el).attr('data-main-thumb') || ''
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

    const $ = cheerio.load(data)

    let iframeSrc = ''
    $('iframe').each((_, el) => {
      let src = $(el).attr('src') || ''
      if (src && (src.includes('playerrecord') || src.includes('recordplay') || src.includes('/e/') || src.includes('streamwish') || src.includes('filemoon'))) {
        if (!src.startsWith('http')) src = 'https:' + src
        iframeSrc = src
      }
    })

    if (iframeSrc) {
      tracks.push({
        name: '播放',
        pan: '',
        ext: {
          url: iframeSrc,
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

  try {
    const { data } = await $fetch.get(playUrl, {
      headers: {
        'User-Agent': UA,
        'Referer': 'https://sexkbj.com/',
      },
    })

    // 优先匹配 master.m3u8
    let match = data.match(/(https?:\/\/[^"'\\s]+?master\.m3u8[^"'\\s]*)/i)
    if (!match) {
      match = data.match(/(https?:\/\/[^"'\\s]+?\/video\/video\.m3u8[^"'\\s]*)/i)
    }
    if (!match) {
      match = data.match(/(https?:\/\/[^"'\\s]+?\.m3u8[^"'\\s]*)/i)
    }
    if (!match) {
      match = data.match(/["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i)
    }

    if (match && match[1]) {
      playUrl = match[1]
      $print('解析到播放地址: ' + playUrl)
    } else {
      $print('未能解析出 m3u8，返回原地址')
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
