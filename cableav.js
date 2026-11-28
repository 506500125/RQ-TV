// cableav.js — CableAV（cableav.video）的 XPTV JS 扩展源
// 站点：https://cableav.video ，成人视频站，约 97,462 部视频，
// 无需登录、无 VIP、无付费墙，浏览器里可正常播放。
// 实测结构（2026-11-28，浏览器实测 + 本机 curl 验证）：
//   列表：服务端静态 HTML，每页 12 条。最新 /latest.html，
//         翻页 /latest-N.html（实测 Page 1 of 8122，末页
//         /latest-8122.html）。分类页同格式：/<slug>.html，
//         翻页推断为 /<slug>-N.html（与 latest 的格式一致，
//         分类翻页未逐个实测）。
//   分类（页面右侧“分类”侧边栏实测 20 项，href 均为 ASCII slug）：
//         guochanav 国产视频、guochanxinpian 国产新片、
//         tanhadashen 探花大神、wanoujiejie 玩偶姐姐、madou 麻豆、
//         ribenwuma 日本无码、ribenyouma 日本有码、
//         mitaoyingxiang 蜜桃影像、guodongchuanmei 果冻传媒、
//         xingkongwuxian 星空传媒、huangjiahuaren 皇家华人、
//         tianmeichuanmei 天美传媒、xingshijie 性视界、
//         aidouchuanmei 爱豆传媒、tuzishengxian 兔子先生、
//         oumeigaoqing 欧美高清、dongmanjuqing 动漫剧情、
//         rihanwuma 日韩无码、rihanyouma 日韩有码、
//         xingbashipin 杏吧。
//         注意：顶部导航另有 /category/<中文名>.html 的同名分类，
//         href 与侧边栏不同；这里用侧边栏的 ASCII slug，稳定。
//   卡片：<article>，缩略图链接 <a href="/info-<id>.html"> 包裹
//         <img src="/uploads/.../*.jpg" alt="标题">，标题链接与
//         缩略图链接相同（href 一致，文本 = img alt）；标题下方
//         只有一行元数据“日期 浏览量 点赞 点踩”，卡片上没有时长，
//         所以 vod_remarks 取日期。图片属性名（src 与 data-src
//         之别）浏览器无障碍视图无法证实，代码里 data-src、
//         data-original、src、srcset 都试。
//   详情：/info-<id>.html，页面里唯一一个 <iframe>（main > article 内），
//         src 原文（2026-11-28 09:27–09:32 浏览器实测）：
//         /index/data/dplayer.html?video=https://t27.cdn2020.com/video/m3u8/2026/11/27/356ea4fe/index.m3u8
//         video 参数就是真 m3u8 直链。本机 curl 实测：该 m3u8
//         200、真 #EXTM3U；首个分段 0000.ts 200、905KB、真 MPEG-TS；
//         全程不带 Referer 也能拿到，无需鉴权头。
//   搜索：顶部搜索图标 href 为 /search?k=（实测）；
//         之前记录的 /search.html?k= 与本次实测不一致，以本次为准。
//   ⚠️ 未验证（需电视实测裁决）：
//     1. 分类页翻页 /<slug>-N.html 是按 latest 的格式推断的，
//        未逐个实测；
//     2. 列表解析用的是浏览器观测到的结构拼的模拟数据测的，
//        不是真实 HTML（本机 curl 取不到站内 HTML，000），
//        电视上卡片能不能抓出来见了才算数；
//     3. XPTV 里 $fetch 能否取到 cableav.video 的 HTML（本站
//        对本机 curl 是 000/Cloudflare 挡），电视网络下待验证。
//
// 依赖：运行环境提供的 createCheerio()、$fetch、jsonify、argsify、$print。

const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const appConfig = {
  ver: 1,
  title: 'CableAV',
  site: 'https://cableav.video',
  tabs: [
    { name: '最新', ext: { id: 'latest' } },
    { name: '国产视频', ext: { id: 'guochanav' } },
    { name: '国产新片', ext: { id: 'guochanxinpian' } },
    { name: '探花大神', ext: { id: 'tanhadashen' } },
    { name: '玩偶姐姐', ext: { id: 'wanoujiejie' } },
    { name: '麻豆', ext: { id: 'madou' } },
    { name: '日本无码', ext: { id: 'ribenwuma' } },
    { name: '日本有码', ext: { id: 'ribenyouma' } },
    { name: '蜜桃影像', ext: { id: 'mitaoyingxiang' } },
    { name: '果冻传媒', ext: { id: 'guodongchuanmei' } },
    { name: '星空传媒', ext: { id: 'xingkongwuxian' } },
    { name: '皇家华人', ext: { id: 'huangjiahuaren' } },
    { name: '天美传媒', ext: { id: 'tianmeichuanmei' } },
    { name: '性视界', ext: { id: 'xingshijie' } },
    { name: '爱豆传媒', ext: { id: 'aidouchuanmei' } },
    { name: '兔子先生', ext: { id: 'tuzishengxian' } },
    { name: '欧美高清', ext: { id: 'oumeigaoqing' } },
    { name: '动漫剧情', ext: { id: 'dongmanjuqing' } },
    { name: '日韩无码', ext: { id: 'rihanwuma' } },
    { name: '日韩有码', ext: { id: 'rihanyouma' } },
    { name: '杏吧', ext: { id: 'xingbashipin' } },
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

function pickCover(img) {
  if (!img || !img.length) return ''
  const raw = String(
    img.attr('data-src') || img.attr('data-original') || img.attr('src') || ''
  ).trim()
  if (raw && !/^data:image\//i.test(raw)) return normalizeUrl(raw)
  const srcset = String(img.attr('srcset') || img.attr('data-srcset') || '').trim()
  if (srcset) {
    const first = srcset.split(',')[0].trim().split(/\s+/)[0]
    if (first && !/^data:image\//i.test(first)) return normalizeUrl(first)
  }
  return ''
}

async function getConfig() {
  return jsonify(appConfig)
}

// 列表页解析：卡片为 <article>，内含指向 /info-<id>.html 的链接
// （缩略图链接与标题链接 href 相同），img alt 即标题，
// 标题下方元数据行里取日期（卡片无时长）。
function parseCards($, html) {
  const cards = []
  const seen = {}
  $('article a[href^="/info-"]').each((_, el) => {
    const a = $(el)
    const href = String(a.attr('href') || '').trim()
    const m = href.match(/^\/info-(\d+)\.html/)
    if (!m) return
    const detailUrl = appConfig.site + '/info-' + m[1] + '.html'
    if (seen[detailUrl]) return
    const article = a.closest('article')
    const img = article.find('img').first()
    const pic = pickCover(img)
    let title = String(img.attr('alt') || '').trim()
    if (!title) title = article.find('a[href="/info-' + m[1] + '.html"]').last().text().replace(/\s+/g, ' ').trim()
    if (!title) return
    const meta = article.text().replace(/\s+/g, ' ').trim()
    const dm = meta.match(/(\d{4}-\d{2}-\d{2})/)
    seen[detailUrl] = true
    cards.push({
      vod_id: detailUrl,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: dm ? dm[1] : '',
      ext: { url: detailUrl },
    })
  })
  return cards
}

async function fetchCards(url) {
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
  return parseCards($, html)
}

function listUrl(slug, page) {
  // latest: /latest.html, /latest-2.html；分类: /<slug>.html, /<slug>-2.html
  if (page > 1) return appConfig.site + '/' + slug + '-' + page + '.html'
  return appConfig.site + '/' + slug + '.html'
}

async function getCards(ext) {
  ext = argsify(ext)
  let cards = []
  let { page = 1, id } = ext
  const slug = String(id || 'latest')

  try {
    cards = await fetchCards(listUrl(slug, page))
    $print('抓到视频数量: ' + cards.length)
  } catch (e) {
    $print('getCards 错误: ' + e)
  }

  return jsonify({ list: cards })
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
              referer: url || (appConfig.site + '/'),
            },
          },
        ],
      },
    ],
  })
}

// 从详情页 HTML 里提 m3u8：唯一 iframe 的 src 是
// /index/data/dplayer.html?video=<m3u8 直链>，video 参数即真流地址；
// 兜底：HTML 里直接出现的 .m3u8 地址。
function extractStreamUrl(html) {
  if (!html) return ''
  const iframeM = String(html).match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i)
  if (iframeM) {
    const src = iframeM[1]
    const vm = src.match(/[?&]video=([^&"']+)/i)
    if (vm) {
      try {
        const decoded = decodeURIComponent(vm[1])
        if (/\.m3u8(\?|#|$)/i.test(decoded)) return decoded
      } catch (e) {
        if (/\.m3u8(\?|#|$)/i.test(vm[1])) return vm[1]
      }
    }
  }
  const direct = String(html).match(/https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?/i)
  if (direct) return direct[0]
  return ''
}

async function getPlayinfo(ext) {
  ext = argsify(ext)
  let targetUrl = ext.url
  let referer = ext.referer || targetUrl || (appConfig.site + '/')
  let finalMediaUrl = ''

  try {
    if (targetUrl && /\.(m3u8|mp4)(\?|#|$)/i.test(targetUrl)) {
      finalMediaUrl = targetUrl
    } else if (targetUrl) {
      const { data } = await $fetch.get(targetUrl, {
        headers: {
          'User-Agent': UA,
          'Referer': referer,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })
      const html = typeof data === 'string' ? data : JSON.stringify(data || '')
      finalMediaUrl = extractStreamUrl(html)
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
    headers: [{ 'User-Agent': UA, 'Referer': referer }],
  })
}

async function search(ext) {
  ext = argsify(ext)
  let cards = []
  const text = ext.text || ''
  if (!text) return jsonify({ list: cards })

  const url = appConfig.site + '/search?k=' + encodeURIComponent(text)

  try {
    cards = await fetchCards(url)
    $print('搜索到视频数量: ' + cards.length)
  } catch (e) {
    $print('search 错误: ' + e)
  }

  return jsonify({ list: cards })
}
