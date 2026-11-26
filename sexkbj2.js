// sexkbj2.js — SexKBJ 的 XPTV / TVBox 猫爪源（CatVod JS Spider, type=3）
// 站点: https://sexkbj.com ，WordPress 视频站
// 实测结构（2026-11-27）:
//   首页/分类: <article class="... thumb-block ...">，内含详情链接、标题、封面(data-src)、
//              时长 <span class="duration">、观看数 <span class="views">
//   分类: /category/korean-bj/ /category/korean-amateur/ /category/afreecatv/
//         /category/premium/ ，翻页 /category/<slug>/page/<n>/，首页翻页 /page/<n>/
//   搜索: /?s=<关键词>
//   详情: <h1 class="entry-title">、<meta itemprop="thumbnailUrl">、
//         <meta itemprop="duration" content="P0DT0H44M14S">、#video-actors、
//         播放器是 <IFRAME SRC="https://sexkbj.top/embed/<id>">（VidHide 托管，
//         直链 m3u8 经混淆 JS 动态生成，静态抓不到稳定地址）
//   因此播放不硬解 m3u8：detail 把 embed 地址当作播放源，playerContent 返回
//   parse=1，交给 XPTV / TVBox 自带的解析/嗅探去跑这个 embed 页。
//   如果你的 XPTV 版本播不了 embed 页，说明它解析不了 VidHide，这一点换写法也绕不过。
//
// 依赖: 运行环境提供的 request(url)（返回 HTML 字符串），其余只用纯 JS 正则，
// 不依赖 pdfh/pdfa/pd，避免不同版本选择器口径不一致。

var HOST = 'https://sexkbj.com';
var UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function init(ext) {
    if (ext) {
        HOST = String(ext).replace(/\/+$/, '');
    }
}

function get(url) {
    var res = request(url);
    if (typeof res === 'string') return res;
    if (res && typeof res === 'object') return res.content || res.body || res.data || '';
    return '';
}

function unesc(s) {
    if (!s) return '';
    return String(s)
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); });
}

function pick(str, re) {
    var m = str.match(re);
    return m ? unesc(m[1].trim()) : '';
}

function parseDurationISO(s) {
    // P0DT0H44M14S -> 44:14 ；P0DT1H2M3S -> 1:02:03
    var m = String(s || '').match(/P(?:\d+D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return String(s || '');
    var h = parseInt(m[1] || '0', 10), mi = parseInt(m[2] || '0', 10), se = parseInt(m[3] || '0', 10);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    if (h > 0) return h + ':' + two(mi) + ':' + two(se);
    return mi + ':' + two(se);
}

function parseList(html) {
    var list = [];
    var re = /<article[^>]*class="[^"]*thumb-block[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
    var m;
    while ((m = re.exec(html)) !== null) {
        var block = m[1];
        var href = pick(block, /<a\s+href="([^"]+)"/);
        if (!href) continue;
        if (href.charAt(0) === '/') href = HOST + href;
        var title = pick(block, /<a\s+href="[^"]+"\s+title="([^"]+)"/)
            || pick(block, /<header[^>]*>\s*<span>([^<]+)<\/span>/);
        var pic = pick(block, /<img[^>]*data-src="([^"]+)"/)
            || pick(block, /<img[^>]*src="([^"]+)"/);
        var duration = pick(block, /<span class="duration">[\s\S]*?([\d:]+)\s*<\/span>/);
        var views = pick(block, /<span class="views">[\s\S]*?([\d,]+)\s*<\/span>/);
        list.push({
            vod_id: href,
            vod_name: title,
            vod_pic: pic,
            vod_remarks: duration || (views ? views + ' views' : '')
        });
    }
    return list;
}

function homeContent(filter) {
    return JSON.stringify({
        class: [
            { type_id: 'latest', type_name: '最新' },
            { type_id: 'korean-bj', type_name: 'Korean BJ' },
            { type_id: 'korean-amateur', type_name: 'Korean Amateur' },
            { type_id: 'afreecatv', type_name: 'AFREECATV' },
            { type_id: 'premium', type_name: 'Premium' }
        ],
        filters: {}
    });
}

function homeVideoContent() {
    var html = get(HOST + '/');
    return JSON.stringify({ list: parseList(html) });
}

function categoryContent(tid, pg, filter, extend) {
    pg = parseInt(pg || '1', 10) || 1;
    var url;
    if (tid === 'latest') {
        url = pg > 1 ? HOST + '/page/' + pg + '/' : HOST + '/';
    } else {
        url = pg > 1
            ? HOST + '/category/' + tid + '/page/' + pg + '/'
            : HOST + '/category/' + tid + '/';
    }
    var html = get(url);
    return JSON.stringify({
        page: pg,
        pagecount: 9999,
        limit: 30,
        total: 999999,
        list: parseList(html)
    });
}

function searchContent(key, quick) {
    var html = get(HOST + '/?s=' + encodeURIComponent(key));
    return JSON.stringify({ list: parseList(html) });
}

function detailContent(ids) {
    var id = ids[0];
    var html = get(id);
    var title = pick(html, /<h1[^>]*class="entry-title"[^>]*>([^<]+)<\/h1>/)
        || pick(html, /<title>([^<]+?)\s*[&–-]/);
    var pic = pick(html, /<meta[^>]*itemprop="thumbnailUrl"[^>]*content="([^"]+)"/)
        || pick(html, /<meta[^>]*content="([^"]+)"[^>]*itemprop="thumbnailUrl"/);
    var duration = parseDurationISO(pick(html, /<meta[^>]*itemprop="duration"[^>]*content="([^"]+)"/));
    var actors = '';
    var actorBlock = html.match(/<div id="video-actors">([\s\S]*?)<\/div>/);
    if (actorBlock) {
        var names = [];
        var am = actorBlock[1].match(/<a[^>]*>([^<]+)<\/a>/g) || [];
        for (var i = 0; i < am.length; i++) {
            var t = am[i].replace(/<[^>]+>/g, '').trim();
            if (t) names.push(unesc(t));
        }
        actors = names.join(' / ');
    }
    var tags = '';
    var tagBlock = html.match(/<div class="tags-list">([\s\S]*?)<\/div>/);
    if (tagBlock) {
        var tn = [];
        var tm = tagBlock[1].match(/<a[^>]*>(?:<i[^>]*><\/i>)?([^<]+)<\/a>/g) || [];
        for (var j = 0; j < tm.length; j++) {
            var tt = tm[j].replace(/<[^>]+>/g, '').trim();
            if (tt) tn.push(unesc(tt));
        }
        tags = tn.join(',');
    }
    var embed = pick(html, /<IFRAME\s+SRC="([^"]+)"/i);
    return JSON.stringify({
        list: [{
            vod_id: id,
            vod_name: title,
            vod_pic: pic,
            vod_year: '',
            vod_area: '',
            vod_actor: actors,
            vod_director: '',
            vod_remarks: duration,
            vod_content: tags,
            vod_play_from: 'SexKBJ',
            vod_play_url: embed
        }]
    });
}

function playerContent(flag, id, vipFlags) {
    var url = String(id || '');
    // 详情页直传过来的可能是详情 URL，先取一遍 embed 地址
    if (url.indexOf('/embed/') === -1 && url.indexOf('.mp4') === -1 && url.indexOf('.m3u8') === -1) {
        try {
            var html = get(url);
            var embed = pick(html, /<IFRAME\s+SRC="([^"]+)"/i);
            if (embed) url = embed;
        } catch (e) {}
    }
    if (/\.m3u8|\.mp4/.test(url)) {
        return JSON.stringify({
            parse: 0,
            url: url,
            header: { 'User-Agent': UA, 'Referer': HOST + '/' }
        });
    }
    // embed 页（VidHide）：交给播放器解析/嗅探，不要硬返回它当直链
    return JSON.stringify({
        parse: 1,
        jx: 1,
        url: url,
        header: { 'User-Agent': UA, 'Referer': HOST + '/' }
    });
}
