// xnxsz.js — 妙灵图集（xnxsz.com）的 XPTV JS 扩展源
// 站点：https://xnxsz.com ，WordPress + B2 主题的足控视频站
// 实测结构（2026-11-27）：
//   列表：首页 /（52 条/页），翻页 /page/N（不带尾斜杠，/page/2 实测 200）。
//         分类页：/zaixianbofang（在线播放）、/jxzy（精选资源）、
//         /quan（密·圈）、/hj（合集专区），翻页 /<分类>/page/N
//         （/zaixianbofang/page/2 实测 200）。
//   搜索：/?s=<关键词>（/?s=足 实测 200，20 条）。
//   卡片：li.post-list-item，标题在 .post-info h2 a，封面在
//         a.thumb-link picture img.post-thumb 的 data-src（img 的 src
//         是默认占位图 default-img.jpg，必须用 data-src；source 的
//         data-srcset 也是同一地址）。卡片无时长徽标。
//   流地址（2026-11-27 实测验证）：封面就是视频预览图，地址形如
//         https://<子域>.meijao123.com/video/m3u8/<年>/<月>/<日>/<hash>/vod.gif
//         把尾巴的 vod.gif 换成 index.m3u8 就是真 HLS：
//         https://mj4.meijao123.com/video/m3u8/2026/11/27/d714f780/index.m3u8
//         实测 200、#EXTM3U、无需 Referer；分段 0000.ts 实测 200、1.9MB。
//         详情页 og:image 是同一个 vod.gif 地址，所以详情页也能推导。
//   注意：站里播放器本身要登录/VIP，但 CDN 上的 HLS 文件不校验，
//         XPTV 直接拿 index.m3u8 就能播。精选资源/密·圈/合集专区列表
//         的封面不是 vod.gif（是普通图），这类卡片的流地址走详情页
//         og:image 推导；推导不到的返回空列表，不给黑屏。
//   封面主机名不固定（实测有 mj4、jg 等），只认路径模式，不写死主机。
//
// 依赖：运行环境提供的 createCheerio()、$fetch、jsonify、argsify、$print。

const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const appConfig = {
  ver: 1,
  title: 'XNXSZ',
  site: 'https://xnxsz.com',
  tabs: [
    {
      name: '最新',
      ext: {
        id: '/',
      },
    },
    {
      name: '在线播放',
      ext: {
        id: '/zaixianbofang',
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

// 封面 vod.gif -> HLS index.m3u8。
// 只认 /video/m3u8/ 路径下的 vod.gif，别的图不碰。
function vodGifToM3u8(gifUrl) {
  if (!gifUrl) return ''
  var u = String(gifUrl).trim()
  if (u.indexOf('/video/m3u8/') === -1) return ''
  var base = u.split('?')[0].split('#')[0]
  if (!/vod\.gif$/i.test(base)) return ''
  return base.replace(/vod\.gif$/i, 'index.m3u8')
}

// 从详情页 HTML 里找 vod.gif（og:image 优先，其次任意 meijao123 地址）
function extractVodGif(html) {
  if (!html || typeof html !== 'string') return ''
  var m = html.match(/og:image[^>]*content="([^"]*\/video\/m3u8\/[^"]*vod\.gif[^"]*)"/i)
  if (m && m[1]) return m[1]
  var m2 = html.match(/(https?:\/\/[^"'\s<>]+\/video\/m3u8\/[^"'\s<>]*vod\.gif)/i)
  if (m2 && m2[1]) return m2[1]
  return ''
}

// 卡片封面：img 的 data-src 优先（真图），source 的 data-srcset 次之，
// img 的 src 兜底（但默认占位图 default-img.jpg 和 data: 不算）。
function pickCardCover(item) {
  var img = item.find('img.post-thumb').first()
  if (!img || !img.length) img = item.find('img').first()
  var ds = img ? String(img.attr('data-src') || '').trim() : ''
  if (ds && ds.indexOf('http') === 0) return ds
  var ss = item.find('source[data-srcset]').first().attr('data-srcset') || ''
  if (ss && String(ss).indexOf('http') === 0) return String(ss).trim()
  var src = img ? String(img.attr('src') || '').trim() : ''
  if (src && src.indexOf('http') === 0 && src.indexOf('default-img') === -1 && src.indexOf('data:') !== 0) return src
  return ''
}

function parseCards($) {
  const cards = []
  const seen = {}
  $('li.post-list-item').each((_, el) => {
    const item = $(el)
    const link = item.find('a.thumb-link[href*="/archives/"]').first()
    const href = link.attr('href') || ''
    if (!href || seen[href]) return
    seen[href] = true
    const detailUrl = normalizeUrl(href)
    // 标题：h2 a 优先，img alt 兜底
    let title = item.find('.post-info h2 a').first().text().trim()
    if (!title) {
      const img = item.find('img.post-thumb').first()
      title = img ? String(img.attr('alt') || '').trim() : ''
    }
    if (!title) return
    const cover = pickCardCover(item)
    // 只留视频帖：卡片上的类型徽标是「视频」才要，「下载」的是资源帖
    // （网盘/图集），不是视频、播不了。无徽标的保留（详情页再推导）。
    const badge = item.find('.post-pay-type b').first().text().trim()
    if (badge === '下载') return
    // 备注：分类标签（如 在线播放），无时长徽标
    const cat = item.find('.post-list-cat a').first().text().trim()
    cards.push({
      vod_id: detailUrl,
      vod_name: title,
      vod_pic: cover,
      vod_remarks: cat || '',
      ext: {
        url: detailUrl,
        pic: cover,
      },
    })
  })
  return cards
}

async function getCards(ext) {
  ext = argsify(ext)
  let cards = []
  let { page = 1, id } = ext
  // id 是 '/' 或 '/zaixianbofang' 这类；翻页是 /page/N 或 /<分类>/page/N，
  // 均不带尾斜杠。'/' 去掉尾斜杠后为空串，拼出来就是 /page/N。
  let base = String(id || '/').replace(/\/$/, '')
  let url = appConfig.site + base
  if (page > 1) url = url + '/page/' + page

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
  return jsonify({
    list: [
      {
        title: '在线播放',
        tracks: [
          {
            name: '播放',
            pan: '',
            ext: {
              url: url,
              pic: ext.pic || '',
              referer: appConfig.site + '/',
            },
          },
        ],
      },
    ],
  })
}

async function getPlayinfo(ext) {
  ext = argsify(ext)
  let targetUrl = ext.url
  let referer = ext.referer || (appConfig.site + '/')
  let finalMediaUrl = ''

  try {
    // 1) 列表封面本身就是 vod.gif 时直接推导，不用再请求详情页
    if (ext.pic) finalMediaUrl = vodGifToM3u8(ext.pic)
    // 2) 封面不是 vod.gif 的（精选资源等分类），读详情页 og:image 推导
    if (!finalMediaUrl && targetUrl) {
      const { data } = await $fetch.get(targetUrl, {
        headers: {
          'User-Agent': UA,
          'Referer': referer,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })
      const html = typeof data === 'string' ? data : JSON.stringify(data || '')
      const gif = extractVodGif(html)
      if (gif) finalMediaUrl = vodGifToM3u8(gif)
    }

    if (finalMediaUrl) {
      $print('提取到直链: ' + finalMediaUrl)
    } else {
      $print('未找到可播放的流地址，返回空列表')
    }
  } catch (e) {
    $print('getPlayinfo 错误: ' + e)
  }

  return jsonify({
    urls: finalMediaUrl ? [finalMediaUrl] : [],
    headers: [{
      'User-Agent': UA,
      'Referer': targetUrl || (appConfig.site + '/'),
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
