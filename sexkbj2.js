// sexkbj2.js — SexKBJ 的 XPTV JS 扩展源
// 格式：XPTV 扩展（getConfig / getCards / getTracks / getPlayinfo / search），
// 与仓库里已有的 sexkbj.js 同一套写法，my.json 里用 api "csp_sexkbj2" 注册。
// 站点：https://sexkbj.com ，WordPress 视频站
// 实测结构（2026-11-27）：
//   列表：<article class="... thumb-block ...">，内含详情链接、标题、封面（data-src）、
//         时长 <span class="duration">
//   分类：/category/korean-bj/ /category/korean-amateur/ /category/afreecatv/
//         /category/premium/ ，翻页 /category/<slug>/page/<n>/，首页翻页 /page/<n>/
//   搜索：/?s=<关键词>
//   详情：播放器是 <IFRAME SRC="https://sexkbj.top/embed/<id>">（VidHide 托管，
//         带签名的 master.m3u8 藏在一段 Dean Edwards 打包代码里，
//         getPlayinfo 会现取 embed 页、解包、取出 hls2 的 master.m3u8 再交给播放器。
//         签名有时效（约 36 小时），每次播放都要现取现解，不能写死。
//         注意：这台服务器直接请求这条 m3u8 会返回 403（CDN 似乎按 IP/ASN 校验），
//         电视上的家宽 IP 不一定一样，到底能不能播要在电视上实测。
//
// 依赖：运行环境提供的 createCheerio()、$fetch、jsonify、argsify、$print。

const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const appConfig = {
  ver: 1,
  title: 'SexKBJ2',
  site: 'https://sexkbj.com',
  tabs: [
    {
      name: '最新',
      ext: {
        id: '/',
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
    {
      name: 'AFREECATV',
      ext: {
        id: '/category/afreecatv/',
      },
    },
    {
      name: 'Premium',
      ext: {
        id: '/category/premium/',
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

  // 注意：站内封面叫 <名字>.mp4.jpg / <名字>.mp4-640x360.jpg，.mp4 后面必须
  // 是 ?、#、引号、空白或结尾才算真正的流地址，否则会把封面图当成视频。
  const patterns = [
    /(https?:\/\/[^"'\\\s<>]+?sexkbj\.top[^"'\\\s<>]*?\.m3u8(?=[?#"'\\\s<>]|$)[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?index-v1-a1\.m3u8(?=[?#"'\\\s<>]|$)[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?master\.m3u8(?=[?#"'\\\s<>]|$)[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?\.m3u8(?=[?#"'\\\s<>]|$)[^"'\\\s<>]*)/i,
    /(https?:\/\/[^"'\\\s<>]+?\.mp4(?=[?#"'\\\s<>]|$)[^"'\\\s<>]*)/i,
  ]

  for (const reg of patterns) {
    const m = cleaned.match(reg)
    if (m && m[1]) {
      return m[1]
    }
  }
  return ''
}

// VidHide embed 页的播放地址藏在一段 Dean Edwards 打包代码里：
// eval(function(p,a,c,k,e,d){...}('...',36,603,'词|典'.split('|'),0,{}))
// 打包后的原文里根本没有完整的 m3u8 地址，所以上面那个正则在 embed 页上
// 永远匹配不到。把打包代码按字典一次还原，就能拿到 JWPlayer 的 links.hls2
//（带签名的 master.m3u8，签名里有生成时间 s 和 36 小时有效期 e，
// 每次播放都要现取现解，不能写死）。
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
    // 一次性按词替换，避免还原出来的词被二次替换
    return p.replace(/\b\w+\b/g, function (w) {
      return Object.prototype.hasOwnProperty.call(d, w) ? d[w] : w
    })
  } catch (e) {
    return ''
  }
}

function extractM3u8FromEmbed(html) {
  if (!html || typeof html !== 'string') return ''
  const unpacked = unpackPackedJs(html)
  if (!unpacked) return ''
  // 优先取带签名的 master.m3u8（hls2）；hls3 是 master.txt，不作首选
  const m = unpacked.match(/https?:\/\/[^\s"'<>]+?\.m3u8(?:[?#][^\s"'<>]*)?/)
  return m ? m[0] : ''
}

async function fetchEmbedM3u8(embedUrl) {
  const { data } = await $fetch.get(embedUrl, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://sexkbj.com/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })
  return extractM3u8FromEmbed(data)
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
  let playReferer = referer

  try {
    if (isDirectMediaUrl(targetUrl)) {
      finalMediaUrl = targetUrl
    } else if (targetUrl) {
      // 1) 目标就是 embed 页：直接解包取 m3u8
      if (targetUrl.indexOf('/embed/') !== -1) {
        finalMediaUrl = await fetchEmbedM3u8(targetUrl)
        playReferer = targetUrl
      }
      // 2) 目标是详情页：先找 iframe，再解包 embed 页
      if (!finalMediaUrl) {
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
            playReferer = nextUrl
            try {
              finalMediaUrl = await fetchEmbedM3u8(nextUrl)
            } catch (e) {
              finalMediaUrl = ''
            }
            if (!finalMediaUrl) {
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
      }
    }

    if (finalMediaUrl) {
      $print('提取到直链: ' + finalMediaUrl)
    } else {
      $print('未能提取到 m3u8 直链，返回空列表（播放会黑屏）')
    }
  } catch (e) {
    $print('getPlayinfo 错误: ' + e)
  }

  return jsonify({
    urls: finalMediaUrl ? [finalMediaUrl] : [],
    headers: [{
      'User-Agent': UA,
      'Referer': playReferer,
      'Origin': 'https://sexkbj.top',
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
