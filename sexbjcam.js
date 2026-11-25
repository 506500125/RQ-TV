// sexbjcam.js
const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1'

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
      url = `${appConfig.site}${id}&page=${page}`
    } else {
      url = `${appConfig.site}${id}page/${page}/`
    }
  }

  try {
    const { data } = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': appConfig.site + '/',
      },
    })

    const $ = cheerio.load(data)

    $('article.loop-video.thumb-block').each((_, el) => {
      const a = $(el).find('a').first()
      const href = a.attr('href')
      const title = a.attr('data-title') || $(el).find('img.video-main-thumb').attr('alt') || ''
      let cover = $(el).find('img.video-main-thumb').attr('src') || $(el).attr('data-main-thumb') || ''
      const duration = $(el).find('span.duration').text().trim()

      if (href && title) {
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
    $print('getCards error: ' + e)
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

    // 提取 playerrecord 的 iframe
    let iframeSrc = ''
    $('iframe').each((_, el) => {
      const src = $(el).attr('src') || ''
      if (src.includes('playerrecord') || src.includes('recordplay') || src.includes('/e/')) {
        iframeSrc = src
      }
    })

    if (iframeSrc) {
      if (!iframeSrc.startsWith('http')) {
        iframeSrc = 'https:' + iframeSrc
      }
      tracks.push({
        name: '播放',
        pan: '',
        ext: {
          url: iframeSrc,
        },
      })
    }
  } catch (e) {
    $print('getTracks error: ' + e)
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
  const url = ext.url

  // 目前直接返回 embed 地址
  // 注意：XPTV 不一定能直接播放第三方 embed 页面，可能需要进一步解析 m3u8
  return jsonify({
    urls: [url],
    headers: [{
      'User-Agent': UA,
      'Referer': appConfig.site,
    }],
  })
}

async function search(ext) {
  ext = argsify(ext)
  let cards = []
  const text = ext.text || ''
  const page = ext.page || 1

  if (!text) return jsonify({ list: cards })

  const url = `${appConfig.site}/?s=${encodeURIComponent(text)}`

  try {
    const { data } = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': appConfig.site + '/',
      },
    })

    const $ = cheerio.load(data)

    $('article.loop-video.thumb-block').each((_, el) => {
      const a = $(el).find('a').first()
      const href = a.attr('href')
      const title = a.attr('data-title') || $(el).find('img.video-main-thumb').attr('alt') || ''
      let cover = $(el).find('img.video-main-thumb').attr('src') || $(el).attr('data-main-thumb') || ''
      const duration = $(el).find('span.duration').text().trim()

      if (href && title) {
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
    $print('search error: ' + e)
  }

  return jsonify({
    list: cards,
  })
}
