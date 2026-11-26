// koreanbj.js — KoreanBJ 的 XPTV JS 扩展源
// 站点：https://koreanbj.tv ，API 驱动
// 实测结构（2026-11-27）：
//   列表 API：GET /api/videos?sort=newest|trending&limit=N&page=N
//     返回 {videos:[{id,slug,title,thumbnailUrl,coverUrl,durationSeconds,views,
//     creditCost,isPremium,actorName,...}], page}
//     sort 只接受 newest / trending；offset 参数无效，用 page 翻页。
//   搜索 API：GET /api/search?q=<关键词> 返回 {results:[同上结构]}
//   详情页：https://koreanbj.tv/videos/<slug>（服务端渲染），免费视频在页面里有
//     <video src="https://store*.gofile.io/download/direct/<id>/<file>.mp4">；
//     videoUrl 字段有时是 null，别只认它。收费视频 videoUrl:null 且无
//     <video> 标签，只有预览片段。
//   免费判断：creditCost==0 且 !isPremium。注意 creditCost==0 但
//   isPremium==true 的视频是 premiumLocked，同样播不了（实测 videoUrl
//   为 null、无 <video> 标签）。需要积分/会员的视频一律不显示（2026-11-27
//   用户要求：反正播不了，别在 XPTV 里出现）。
//   gofile 直链注意：store*.gofile.io 的 mp4 地址会 302 跳到
//   file-*.gofile.io，且跳转后的地址仍校验 Referer 必须是详情页地址；
//   播放器跟随跳转时可能丢 Referer 导致 403 黑屏，所以 getPlayinfo 里
//   先用 $fetch 跟随一次跳转，把最终地址连同 Referer 一起返回。
//
// 依赖：运行环境提供的 createCheerio()、$fetch、jsonify、argsify、$print。

const cheerio = createCheerio()
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const appConfig = {
  ver: 1,
  title: 'KoreanBJ',
  site: 'https://koreanbj.tv',
  tabs: [
    {
      name: '最新',
      ext: {
        sort: 'newest',
      },
    },
    {
      name: '最热',
      ext: {
        sort: 'trending',
      },
    },
  ],
}

function fmtDuration(sec) {
  sec = parseInt(sec, 10) || 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = (h > 0 ? String(m).padStart(2, '0') : String(m))
  const ss = String(s).padStart(2, '0')
  return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss
}

function isFree(v) {
  return v && (v.creditCost === 0 || v.creditCost === null) && !v.isPremium
}

function mapVideo(v) {
  const detailUrl = appConfig.site + '/videos/' + v.slug
  const remarks = fmtDuration(v.durationSeconds)
  return {
    vod_id: detailUrl,
    vod_name: (v.title || v.slug || '').trim(),
    vod_pic: v.thumbnailUrl || v.coverUrl || '',
    vod_remarks: remarks,
    ext: {
      url: detailUrl,
      slug: v.slug,
    },
  }
}

function parseJson(data) {
  if (!data) return null
  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch (e) {
      return null
    }
  }
  return data
}

async function getConfig() {
  return jsonify(appConfig)
}

async function getCards(ext) {
  ext = argsify(ext)
  let cards = []
  const sort = ext.sort || 'newest'
  const page = ext.page || 1
  const url = appConfig.site + '/api/videos?sort=' + encodeURIComponent(sort) + '&limit=24&page=' + page

  try {
    const { data } = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': appConfig.site + '/',
        'Accept': 'application/json, */*',
      },
    })
    const json = parseJson(data)
    const videos = (json && json.videos) || []
    videos.forEach((v) => {
      if (v && v.slug && isFree(v)) cards.push(mapVideo(v))
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
              referer: appConfig.site + '/',
            },
          },
        ],
      },
    ],
  })
}

async function resolveGofileRedirect(url, referer) {
  if (!url || url.indexOf('gofile.io') === -1) return url
  try {
    const res = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': referer,
        'Range': 'bytes=0-0',
      },
    })
    const req = (res && res.request) || {}
    const finalUrl = (req.res && req.res.responseUrl) || req.responseURL || ''
    if (finalUrl && finalUrl.indexOf('http') === 0 && finalUrl !== url) return finalUrl
    const loc = (res && res.headers && (res.headers.location || res.headers.Location)) || ''
    if (loc && loc.indexOf('http') === 0 && loc !== url) return loc
    return url
  } catch (e) {
    try {
      const loc = (e && e.response && e.response.headers && (e.response.headers.location || e.response.headers.Location)) || ''
      if (loc && loc.indexOf('http') === 0 && loc !== url) return loc
    } catch (_) {}
    return url
  }
}

function extractGofileMp4(html) {
  if (!html || typeof html !== 'string') return ''
  // 详情页 SSR 数据里的 videoUrl 是完整视频；收费视频这里是 null，
  // 预览地址在 previewVideoUrl / previewUrls 里，不取。
  const m = html.match(/videoUrl:"(https?:\/\/[^"]+\.mp4[^"]*)"/)
  if (m && m[1] && m[1].indexOf('preview') === -1) return m[1]
  // 兜底：主播放器 <video src="...gofile...mp4">
  const v = html.match(/<video[^>]*src="(https?:\/\/[^"]*gofile\.io[^"]+\.mp4[^"]*)"/i)
  if (v && v[1]) return v[1]
  return ''
}

async function getPlayinfo(ext) {
  ext = argsify(ext)
  let targetUrl = ext.url
  let referer = ext.referer || (appConfig.site + '/')
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
      finalMediaUrl = extractGofileMp4(html)
      if (finalMediaUrl && finalMediaUrl.indexOf('gofile.io') !== -1) {
        // 用详情页地址当 Referer 跟随一次 302，拿最终 file-*.gofile.io 地址
        finalMediaUrl = await resolveGofileRedirect(finalMediaUrl, targetUrl)
      }
    }

    if (finalMediaUrl) {
      $print('提取到直链: ' + finalMediaUrl)
    } else {
      $print('该视频需积分/未公开直链，返回空列表')
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

  const url = appConfig.site + '/api/search?q=' + encodeURIComponent(text)

  try {
    const { data } = await $fetch.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': appConfig.site + '/',
        'Accept': 'application/json, */*',
      },
    })
    const json = parseJson(data)
    const results = (json && json.results) || []
    results.forEach((v) => {
      if (v && v.slug && isFree(v)) cards.push(mapVideo(v))
    })
  } catch (e) {
    $print('search 错误: ' + e)
  }

  return jsonify({
    list: cards,
  })
}
