// 91porna.js — 91porna（91porna.com）的 XPTV JS 扩展源
// 站点：https://91porna.com ，成人视频站，免费看片、无需下载、每日更新。
// 实测结构（2026-11-28，本机 curl 直接取到真实 HTML）：
//   列表：/comic/index/video?category=<分类>，每页 23 条，翻页
//         &page=N（play 分类最后一页 8236）。列表页自带
//         application/ld+json 的 ItemList：每条有 url
//         （/comic/index/detail?video_key=N）、name（标题）、
//         primaryImageOfPage.url（封面，无签名）、datePublished。
//         卡片 DOM：.video-item > a[href*="detail?video_key="]，
//         内含 <img data-src="https://pic.qnlycc.cn/...jpeg?auth_key=<到期时间戳>-0-0-<hash>">
//         （封面带签名，实测有效期约 3 小时，列表每次现取现用）、
//         右下角时长（如 10:59）、标题文字、标签。
//   分类（站内导航实测）：new_update 最近更新、play 正在播放、
//         now_hot 当前最热、now_month_hot 本月最热、original
//         国产原创、ten_minutes 10分钟以上、twenty_minutes
//         20分钟以上、hd 高清、now_month_collect 本月收藏、
//         month_hot 上月最热、now_month_comment 本月讨论、
//         max_collect 收藏最多。
//   搜索：/comic/index/search?keyword=<关键词>（站内链接实测格式，
//         搜索结果页结构与列表页相同，用同一解析）。
//   详情：/comic/index/detail?video_key=N，静态 HTML 里没有直链。
//         播放走接口：POST /api/posts/<id>/playback，body 为空
//         JSON {}，Content-Type: application/json（详情页内嵌
//         dxPlayback 脚本实测，2026-11-28）。成功返回
//         {status:1, data:{manifest_method:'GET',
//         videos:[{index, url}], cdn:{m3u8Enabled, otherEnabled,
//         authKey, authValue, app}}}，url 即 m3u8。
//         m3u8 请求要带两个头：cdn.authKey（实测固定值
//         "x-cdn-auth"）和 x-cdn-app（实测 "065"）；authValue
//         每次接口返回（详情页 #cdn-config 里也嵌了一份同值，
//         data-video_cdn_auth_value="4aae16c3b20ec822f87518504478bb35"，
//         2026-11-28 实测）。getPlayinfo 把这两个头随 urls 一起
//         返回（与 xchina.js 的做法一致）。
//   ⚠️ 未验证（需电视实测裁决）：
//     1. 本机准备阶段发不出 POST（沙箱只读策略拦 POST，GET
//        该接口返回 405，证明接口只接受 POST），所以 playback
//        接口返回的真实 m3u8 还没拿到过，post id 取 video_key
//        也是按 _detail_.id 与 video_key 一致推断的；
//     2. XPTV 播放器是否真的会用 getPlayinfo 返回的 headers
//        去取 m3u8——若不带头，CDN 很可能 403，这与之前 gofile
//        跳转丢 Referer 的黑屏是同一类问题。若电视上黑屏，
//        先看是不是这个原因，不要再改列表解析。
//   封面签名 auth_key 约 3 小时过期，列表现取现用即可。
//
// 依赖：运行环境提供的 createCheerio()、$fetch、jsonify、argsify、$print。

const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const appConfig = {
  ver: 1,
  title: '91Porna',
  site: 'https://91porna.com',
  tabs: [
    { name: '最新', ext: { id: 'new_update' } },
    { name: '正在播放', ext: { id: 'play' } },
    { name: '当前最热', ext: { id: 'now_hot' } },
    { name: '本月最热', ext: { id: 'now_month_hot' } },
    { name: '国产原创', ext: { id: 'original' } },
    { name: '10分钟以上', ext: { id: 'ten_minutes' } },
    { name: '20分钟以上', ext: { id: 'twenty_minutes' } },
    { name: '高清', ext: { id: 'hd' } },
    { name: '本月收藏', ext: { id: 'now_month_collect' } },
    { name: '上月最热', ext: { id: 'month_hot' } },
    { name: '本月讨论', ext: { id: 'now_month_comment' } },
    { name: '收藏最多', ext: { id: 'max_collect' } },
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

// 列表页解析：优先用 JSON-LD ItemList（结构稳定，23 条/页），
// 再用卡片 DOM 补时长；JSON-LD 拿不到时整段走 DOM。
// 卡片 DOM：.video-item a[href*="detail?video_key="]，封面取
// img 的 data-src（带签名）> src，时长是卡片内第一个 时:分。
function parseCards($, html) {
  const cards = []
  const seen = {}
  const byKey = {}
  // 注意：video_key 是纯数字字符串，Object.keys() 会按数字升序重排，
  // 必须另外记插入顺序（JSON-LD 顺序 = 站内顺序），否则列表顺序全乱。
  const order = []
  function remember(key) {
    if (!byKey[key]) { byKey[key] = {}; order.push(key) }
  }

  function pushCard(key, title, pic, duration) {
    if (!key || seen[key]) return
    if (!title) return
    seen[key] = true
    const detailUrl = appConfig.site + '/comic/index/detail?video_key=' + key
    cards.push({
      vod_id: detailUrl,
      vod_name: title,
      vod_pic: pic || '',
      vod_remarks: duration || '',
      ext: { url: detailUrl },
    })
  }

  // 1) JSON-LD ItemList
  try {
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)?.[1] || 'null')
    const graph = Array.isArray(ld) ? ld : (ld && ld['@graph'] ? ld['@graph'] : [])
    for (const node of graph) {
      if (!node || node['@type'] !== 'ItemList' || !Array.isArray(node.itemListElement)) continue
      for (const item of node.itemListElement) {
        const it = item && item.item ? item.item : item
        if (!it) continue
        const url = String(it.url || '')
        const km = url.match(/video_key=(\d+)/)
        if (!km) continue
        const pic = it.primaryImageOfPage && it.primaryImageOfPage.url
          ? String(it.primaryImageOfPage.url)
          : ''
        remember(km[1])
        byKey[km[1]].title = String(it.name || '').trim()
        byKey[km[1]].pic = pic
      }
    }
  } catch (e) { /* JSON-LD 解析失败就走 DOM */ }

  // 2) 卡片 DOM：封面（带签名的 data-src）+ 时长
  $('.video-item a[href*="detail?video_key="]').each((_, el) => {
    const a = $(el)
    const href = a.attr('href') || ''
    const km = href.match(/video_key=(\d+)/)
    if (!km) return
    const key = km[1]
    remember(key)
    const img = a.find('img').first()
    const pic = img && img.length
      ? String(img.attr('data-src') || img.attr('src') || '').trim()
      : ''
    const text = a.text().replace(/\s+/g, ' ').trim()
    const dm = text.match(/(\d{1,3}:\d{2}(?::\d{2})?)/)
    const duration = dm ? dm[1] : ''
    // 每张卡片有两个指向详情页的 <a>（封面一个、标题一个），后一个
    // 的文本里没有时长/封面，空值不能覆盖前面已取到的值。
    if (pic) byKey[key].pic = pic
    if (duration) byKey[key].duration = duration
    // 标题：卡片文字去掉时长和标签后取最长一段；JSON-LD 有标题时优先用它
    if (!byKey[key].title) {
      const parts = text.split('|').map(s => s.trim()).filter(Boolean)
      byKey[key].title = parts.sort((x, y) => y.length - x.length)[0] || ''
    }
  })

  // JSON-LD 有但 DOM 没扫到的卡片也保留（封面用 JSON-LD 的无签名地址）
  for (const key of order) {
    const c = byKey[key]
    pushCard(key, c.title, c.pic, c.duration || '')
  }
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

async function getCards(ext) {
  ext = argsify(ext)
  let cards = []
  let { page = 1, id } = ext
  const category = String(id || 'new_update')
  let url = appConfig.site + '/comic/index/video?category=' + encodeURIComponent(category)
  if (page > 1) url += '&page=' + page

  try {
    cards = await fetchCards(url)
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

// 从详情页 URL 或 HTML 里取 post id（即 video_key，与 _detail_.id 一致）。
function extractPostId(detailUrl, html) {
  let m = String(detailUrl || '').match(/video_key=(\d+)/)
  if (m) return m[1]
  m = String(html || '').match(/videoId\s*=\s*['"](\d+)['"]/)
  if (m) return m[1]
  m = String(html || '').match(/"_detail_"\s*=\s*\{\s*"id"\s*:\s*(\d+)/)
  if (m) return m[1]
  return ''
}

// 详情页 #cdn-config 里嵌的鉴权值（接口返回里也有，取不到时用它兜底）。
function extractCdnConfig(html) {
  const cfg = { authKey: '', authValue: '', app: '' }
  if (!html) return cfg
  let m = html.match(/data-video_cdn_auth_key="([^"]*)"/i)
  if (m) cfg.authKey = m[1]
  m = html.match(/data-video_cdn_auth_value="([^"]*)"/i)
  if (m) cfg.authValue = m[1]
  m = html.match(/data-cdn_app="([^"]*)"/i)
  if (m) cfg.app = m[1]
  return cfg
}

async function getPlayinfo(ext) {
  ext = argsify(ext)
  let targetUrl = ext.url
  let referer = ext.referer || targetUrl || (appConfig.site + '/')
  let finalMediaUrl = ''
  let headers = [{ 'User-Agent': UA, 'Referer': referer }]

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
      const postId = extractPostId(targetUrl, html)
      const pageCfg = extractCdnConfig(html)

      if (postId) {
        // 播放接口：POST /api/posts/<id>/playback，body {}。
        // 返回 {status:1, data:{manifest_method:'GET',
        // videos:[{index, url}], cdn:{...}}}。
        const apiUrl = appConfig.site + '/api/posts/' + postId + '/playback'
        const res = await $fetch.post(apiUrl, '{}', {
          headers: {
            'User-Agent': UA,
            'Referer': targetUrl,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/plain, */*',
          },
        })
        const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
        if (body && body.status === 1 && body.data && body.data.manifest_method === 'GET') {
          const videos = Array.isArray(body.data.videos) ? body.data.videos : []
          if (videos.length && videos[0].url) finalMediaUrl = videos[0].url
          const cdn = body.data.cdn || {}
          const authKey = cdn.authKey || pageCfg.authKey
          const authValue = cdn.authValue || pageCfg.authValue
          const app = cdn.app || pageCfg.app
          if (authKey && authValue) {
            // m3u8/分段请求要带这两个头（站内 hls.js 的 xhrSetup 做法），
            // 随 urls 一起返回；播放器是否真用它，待电视实测。
            headers = [{
              'User-Agent': UA,
              'Referer': targetUrl,
              [authKey]: authValue,
              'x-cdn-app': app,
            }]
          }
        } else {
          $print('playback 接口未返回可用地址: ' + JSON.stringify(body || '').slice(0, 200))
        }
      } else {
        $print('详情页取不到 post id，无法调播放接口')
      }
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
    headers: headers,
  })
}

async function search(ext) {
  ext = argsify(ext)
  let cards = []
  const text = ext.text || ''
  if (!text) return jsonify({ list: cards })

  const url = appConfig.site + '/comic/index/search?keyword=' + encodeURIComponent(text)

  try {
    cards = await fetchCards(url)
    $print('搜索到视频数量: ' + cards.length)
  } catch (e) {
    $print('search 错误: ' + e)
  }

  return jsonify({ list: cards })
}
