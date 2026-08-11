/* ============================================================
   2026 釜山五天四夜 — 互動行程規劃 App
   v3：智慧排程（交通＋停留時間試算）／購物排入行程／清單排序
       ／版本紀錄與 Google 試算表同步
   ============================================================ */
(function () {
  'use strict';

  const WON2NT = 0.0215; // 1₩ ≈ NT$0.0215

  /* ---------- 工具（先宣告，供資料合併使用） ---------- */
  const $ = (q, el) => (el || document).querySelector(q);
  const $$ = (q, el) => Array.from((el || document).querySelectorAll(q));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const gmap = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  const nmap = q => 'https://map.naver.com/p/search/' + encodeURIComponent(q);
  const gsearch = q => 'https://www.google.com/search?q=' + encodeURIComponent(q);
  // CatchTable（캐치테이블）：帶關鍵字直接開到該店的搜尋結果，點進去就能訂位／線上候位
  const ctable = q => 'https://app.catchtable.co.kr/ct/map/COMMON?showTabs=true&serviceType=INTEGRATION' +
    '&keyword=' + encodeURIComponent(q) + '&keywordSearch=' + encodeURIComponent(q) + '&bottomSheetHeightType=HALF';
  // 有店家專頁代號（ctS）就直連 CatchTable Global 的繁中店家頁：
  // catchtable.net 全站設了 Universal/App Link，手機裝了 CatchTable Global App
  // 點連結會自動開 App 到該店頁面；沒裝則開繁中網頁版（Google/Apple 帳號可訂位，免韓國門號）
  const ctShop = s => 'https://www.catchtable.net/zh-TW/shop/' + s;
  const tabling = q => 'https://www.tabling.co.kr/search?keyword=' + encodeURIComponent(q);
  const money = n => 'NT$' + Number(n).toLocaleString('en-US');
  const ceil5 = m => Math.ceil(m / 5) * 5;
  const fmtT = m => {
    let h = Math.floor(m / 60);
    const nx = h >= 24;
    if (nx) h -= 24;
    return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}${nx ? '+1' : ''}`;
  };
  const kmTxt = km => km < 1 ? Math.round(km * 1000) + 'm' : km.toFixed(1) + 'km';
  const durTxt = m => {
    const h = Math.floor(m / 60), r = m % 60;
    return h ? (r ? `${h}小時${r}分` : `${h}小時`) : `${m}分`;
  };
  function havKm(a, b) {
    const d = Math.PI / 180, R = 6371;
    const s = Math.sin((b.lat - a.lat) * d / 2) ** 2 +
      Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin((b.lng - a.lng) * d / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  /* ---------- 資料合併：座標／停留／門市 ---------- */
  const ALL = [...SPOTS, ...FOODS, ...SHOPS];
  const DB = {};
  ALL.forEach((it, idx) => {
    it._idx = idx;
    Object.assign(it, META[it.id] || {});
    if (it.kind === 'shop') {
      it._store = STORES[it.store] || null;
      if (it._store) { it.lat = it._store.lat; it.lng = it._store.lng; it.zone = it._store.zone; }
    }
    if (it.lat == null) { it.lat = HOTEL.lat; it.lng = HOTEL.lng; it.zone = 'seomyeon'; }
    it._km = havKm(HOTEL, it);
    /* 搜尋用全文索引：名稱／韓文／區域／門市／描述／標籤／分類 */
    const catL = it.kind === 'spot' ? '景點' : (it.kind === 'food' ? (FOOD_CATS[it.cat] || {}).label : (SHOP_CATS[it.cat] || {}).label);
    it._hay = [it.name, it.kr, it.area, it.buy, it.desc, it.tag, it.price, catL,
      it._store ? it._store.name : '', (META[it.id] || {}).img || '',
      (it.links || {}).tel || ''].join(' ').toLowerCase();
    DB[it.id] = it;
  });
  const matchQ = (it, q) => !q || q.toLowerCase().split(/\s+/).every(t => it._hay.includes(t));

  /* 同品牌分店索引：讓旅客能依當天動線改選最近的一家 */
  const BRANDS = {};
  ALL.forEach(it => { if (it.brand) (BRANDS[it.brand] = BRANDS[it.brand] || []).push(it); });
  const siblings = it => (it.brand && BRANDS[it.brand]) ? BRANDS[it.brand].filter(x => x.id !== it.id) : [];
  const selectedBrands = () => {
    const s = new Set();
    ALL.forEach(it => { if (it.brand && state.sel.has(it.id)) s.add(it.brand); });
    return s;
  };

  const state = {
    sel: new Set(),
    tab: 'spot',            // spot | food | shop
    foodCat: 'all',
    shopCat: 'all',
    region: 'all',
    store: 'all',           // 購物門市篩選（樂天百貨／新世界／NOCLAIM…）
    storeExpand: false,     // 門市列是否展開全部
    q: '',                  // 關鍵字搜尋
    sort: 'rec',            // rec | price | dist
    autoFill: true,
    fromShare: false,
    draftOpen: false,
    pins: {},               // 手動調整：{ 項目id: { d:第幾天(0-4), s:時段key或null } }
    stPins: {},             // 購物門市手動指定：{ 門市key: { d:第幾天(0-4) } }
    ord: {},                // 當日手動排序：{ 第幾天: [停靠點key…] }（key＝項目id／st:門市／d5shop／anchor）
    dayCl: null             // 整天對調：Day2-4 各自負責的生活圈，null＝系統自動安排
  };

  const gimg = q => 'https://www.google.com/search?udm=2&q=' + encodeURIComponent(q); // Google 圖片搜尋
  function linkRow(links, imgQuery) {
    if (!links && !imgQuery) return '';
    links = links || {};
    const a = [];
    if (links.tel) a.push(`<button type="button" class="telbtn" data-tel="${esc(links.tel)}" title="點一下複製電話——貼到 NAVER 地圖搜尋最快最準">📞 ${esc(links.tel)} <em>複製</em></button>`);
    if (links.g) a.push(`<a href="${gmap(links.g)}" target="_blank" rel="noopener">📍 Google地圖</a>`);
    if (links.zh) a.push(`<a href="${esc(links.zh)}" target="_blank" rel="noopener">🇹🇼 繁中介紹</a>`);
    if (links.o) a.push(`<a href="${esc(links.o)}" target="_blank" rel="noopener">🌐 官網／介紹</a>`);
    if (links.s) a.push(`<a href="${gsearch(links.s)}" target="_blank" rel="noopener">🔎 商品介紹</a>`);
    if (links.ctS) a.push(`<a class="bk" href="${ctShop(links.ctS)}" target="_blank" rel="noopener">🍽 CatchTable ${links.ctBook ? '訂位／候位' : '線上候位'}・App直達</a>`);
    else if (links.ct) a.push(`<a class="bk" href="${ctable(links.ct)}" target="_blank" rel="noopener">🍽 CatchTable ${links.ctBook ? '訂位／候位' : '線上候位'}</a>`);
    if (links.tb) a.push(`<a class="bk" href="${tabling(links.tb)}" target="_blank" rel="noopener">⏳ Tabling 候位</a>`);
    if (imgQuery) a.push(`<a href="${gimg(imgQuery)}" target="_blank" rel="noopener">📷 實景圖片</a>`);
    if (links.n) a.push(`<a href="${nmap(links.n)}" target="_blank" rel="noopener">🗺️ NAVER</a>`);
    return `<div class="links" onclick="event.stopPropagation()">${a.join('')}</div>`;
  }
  // 圖片搜尋關鍵字：優先用「對準清單品項」的精準韓文商品名，其次店名
  const imgQ = it => {
    if (it.img) return it.img;
    if (it.kr) return it.kr;
    const L = it.links || {};
    if (L.s) return L.s;
    if (L.o) { // 從 Olive Young 等搜尋連結取出商品關鍵字
      const m = L.o.match(/[?&](?:query|keyword)=([^&]+)/);
      if (m) { try { return decodeURIComponent(m[1]); } catch (e) {} }
    }
    return it.kind === 'shop' ? it.name : (L.g || it.name);
  };

  function catInfo(it) {
    if (it.kind === 'spot') return { label: '景點', icon: '🗼' };
    if (it.kind === 'food') return FOOD_CATS[it.cat];
    return SHOP_CATS[it.cat];
  }

  /* ---------- 儲存 / 分享 ---------- */
  function save() {
    try {
      localStorage.setItem('busan_sel_v2', JSON.stringify([...state.sel]));
      localStorage.setItem('busan_af_v2', state.autoFill ? '1' : '0');
      localStorage.setItem('busan_pins_v1', JSON.stringify(state.pins));
      localStorage.setItem('busan_stpin_v1', JSON.stringify(state.stPins));
      localStorage.setItem('busan_ord_v1', JSON.stringify(state.ord));
      localStorage.setItem('busan_daycl_v1', JSON.stringify(state.dayCl));
    } catch (e) {}
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem('busan_sel_v2') || '[]');
      s.forEach(id => { if (DB[id]) state.sel.add(id); });
      state.autoFill = localStorage.getItem('busan_af_v2') !== '0';
      try { state.pins = JSON.parse(localStorage.getItem('busan_pins_v1') || '{}') || {}; } catch (e) { state.pins = {}; }
      try { state.stPins = JSON.parse(localStorage.getItem('busan_stpin_v1') || '{}') || {}; } catch (e) { state.stPins = {}; }
      try { state.ord = JSON.parse(localStorage.getItem('busan_ord_v1') || '{}') || {}; } catch (e) { state.ord = {}; }
      try { state.dayCl = JSON.parse(localStorage.getItem('busan_daycl_v1') || 'null'); } catch (e) { state.dayCl = null; }
    } catch (e) {}
  }
  const encPins = () => Object.entries(state.pins)
    .filter(([id]) => state.sel.has(id))
    .map(([id, v]) => id + '-' + v.d + (v.s ? '-' + v.s : '')).join('.');
  const encStPins = () => Object.entries(state.stPins)
    .filter(([k]) => STORES[k])
    .map(([k, v]) => k + '-' + v.d).join('.');
  const encOrd = () => Object.entries(state.ord)
    .filter(([, keys]) => keys && keys.length)
    .map(([d, keys]) => d + '.' + keys.join('.')).join('~');
  const extraParams = () => {
    const p = encPins(), sp = encStPins(), o = encOrd();
    const dc = state.dayCl ? '&dc=' + state.dayCl.join('.') : '';
    return (p ? '&p=' + p : '') + (sp ? '&sp=' + sp : '') + (o ? '&o=' + encodeURIComponent(o) : '') + dc;
  };
  function shareUrl() {
    const ids = [...state.sel].sort();
    return CONFIG.baseUrl + '?s=' + ids.join('.') + (state.autoFill ? '' : '&af=0') + extraParams();
  }
  function parseUrl() {
    const p = new URLSearchParams(location.search);
    const s = p.get('s');
    if (!s) return false;
    const ids = s.split('.').filter(id => DB[id]);
    if (!ids.length) return false;
    state.sel = new Set(ids);
    state.autoFill = p.get('af') !== '0';
    const pin = p.get('p');
    state.pins = {};
    if (pin) pin.split('.').forEach((t, i) => {
      const a = t.split('-');
      if (a[0] && DB[a[0]] && a[1] != null) state.pins[a[0]] = { d: +a[1], s: a[2] || null, t: i };
    });
    const sp = p.get('sp');
    state.stPins = {};
    if (sp) sp.split('.').forEach(t => {
      const i = t.lastIndexOf('-');
      if (i <= 0) return;
      const k = t.slice(0, i), d = +t.slice(i + 1);
      if (STORES[k] && d >= 0 && d <= 4) state.stPins[k] = { d };
    });
    const o = p.get('o');
    state.ord = {};
    if (o) o.split('~').forEach(seg => {
      const a = seg.split('.');
      const d = +a[0];
      if (d >= 0 && d <= 4 && a.length > 1) state.ord[d] = a.slice(1);
    });
    const dc = p.get('dc');
    state.dayCl = (dc && dc.split('.').length === 3 && dc.split('.').every(c => CLUSTERS[c])) ? dc.split('.') : null;
    state.fromShare = true;
    return true;
  }

  /* ---------- 版本紀錄 ---------- */
  function loadVers() { try { return JSON.parse(localStorage.getItem('busan_vers_v1') || '[]'); } catch (e) { return []; } }
  function saveVers(v) { try { localStorage.setItem('busan_vers_v1', JSON.stringify(v)); } catch (e) {} }
  const selKey = () => [...state.sel].sort().join('.');
  function snapshotVersion() {
    let vs = loadVers();
    const key = selKey();
    if (!key || vs.some(v => v.ids === key)) return vs;
    let n = 0;
    try { n = +localStorage.getItem('busan_vn') || 0; } catch (e) {}
    n += 1;
    try { localStorage.setItem('busan_vn', String(n)); } catch (e) {}
    vs.push({ id: 'v' + n, name: '版本' + n, ts: Date.now(), ids: key, af: state.autoFill });
    if (vs.length > 10) vs = vs.slice(vs.length - 10);
    saveVers(vs);
    return vs;
  }
  function curVersionName() {
    const v = loadVers().find(x => x.ids === selKey());
    return v ? v.name : '未存版本';
  }

  /* ---------- 計數 ---------- */
  function counts() {
    let sp = 0, fo = 0, sh = 0;
    state.sel.forEach(id => {
      const k = DB[id].kind;
      if (k === 'spot') sp++; else if (k === 'food') fo++; else sh++;
    });
    return { sp, fo, sh };
  }
  const ready = () => { const c = counts(); return c.sp >= CONFIG.minSpots && c.fo >= CONFIG.minFoods; };

  /* ============================================================
     交通試算（保守估）：預設計程車，地鐵更順時改搭，短程步行
     ============================================================ */
  function metroInfo(za, zb) {
    const A = ZONES[za], B = ZONES[zb];
    if (!A || !B || !A.st || !B.st || A.st === B.st) return null;
    const sa = STATIONS[A.st], sb = STATIONS[B.st];
    let stops = null, label = '', ride = 0;
    for (const L of [1, 2]) {
      if (sa['l' + L] != null && sb['l' + L] != null) {
        stops = Math.abs(sa['l' + L] - sb['l' + L]);
        ride = stops * 2.2;
        label = `${L}號線 ${A.st}→${B.st}（${stops}站）`;
        break;
      }
    }
    if (stops == null) {
      const hub = STATIONS['西面'];
      const la = sa.l1 != null ? 1 : 2, lb = sb.l1 != null ? 1 : 2;
      stops = Math.abs(sa['l' + la] - hub['l' + la]) + Math.abs(sb['l' + lb] - hub['l' + lb]);
      ride = stops * 2.2 + 5;
      label = `${la}→${lb}號線 ${A.st}→西面轉乘→${B.st}`;
    }
    const mins = Math.ceil(A.walk + B.walk + ride + 8); // 進出站＋候車緩衝
    const won = stops <= 9 ? 1600 : 1800;
    return { mins, label, fareNT: Math.round(won * WON2NT) };
  }

  function transCalc(from, to) {
    const line = havKm(from, to);
    const wKm = line * 1.25;
    if (wKm <= 1.1) {
      const mins = Math.max(2, Math.ceil(wKm / 4.2 * 60) + 2);
      return { mode: 'walk', mins, fare2: 0, km: wKm,
        desc: `🚶 步行約${mins}分（${kmTxt(wKm)}）`,
        short: `🚶${mins}分` };
    }
    const tKm = line * 1.35;
    const speed = tKm < 3 ? 14 : tKm < 8 ? 19 : 24; // 市區保守時速
    const taxiMins = Math.ceil(tKm / speed * 60) + 5; // 含叫車上車緩衝
    let won = 4800 + Math.max(0, tKm - 2) * 790;
    won = Math.ceil(won / 100) * 100;
    const taxiNT = Math.round(won * WON2NT / 10) * 10;
    const mi = metroInfo(from.zone, to.zone);
    if (mi && mi.mins <= taxiMins + 10) {
      return { mode: 'metro', mins: mi.mins, fare2: mi.fareNT * 2, km: line,
        desc: `🚇 地鐵${mi.label} 約${mi.mins}分・約NT$${mi.fareNT}／人（此段搭地鐵更順）`,
        short: `🚇${mi.mins}分 NT$${mi.fareNT}/人` };
    }
    return { mode: 'taxi', mins: taxiMins, fare2: taxiNT, km: tKm,
      desc: `🚕 計程車約${taxiMins}分（${kmTxt(tKm)}・約NT$${taxiNT}／2人一台）`,
      short: `🚕${taxiMins}分 NT$${taxiNT}` };
  }

  /* ============================================================
     行程產生演算法（同樣勾選必產生同樣結果）
     ============================================================ */
  const SLOT_LABELS = {
    brunch: '早午餐', morning: '上午', lunch: '午餐', afternoon: '下午',
    cafe: '咖啡時光', sweet: '甜點小食', evening: '傍晚', dinner: '晚餐', night: '夜晚・宵夜',
    latelunch: '抵達首餐', pmstroll: '午後', pmcafe: '咖啡時光', d1dinner: '晚餐', d1night: '夜晚・宵夜',
    d5brunch: '早餐', d5shop: '最後採購', d5lunch: '輕食午餐'
  };
  // 每種 slot 可接受的項目型態
  const ACCEPT = {
    brunch: ['brunch'], morning: ['SPOT'], lunch: ['lunch', 'meal'], afternoon: ['SPOT'],
    cafe: ['cafe'], sweet: ['dessert', 'snack'], evening: ['SPOT'], dinner: ['dinner', 'meal', 'lunch'],
    night: ['SPOT', 'supper', 'snack', 'dessert'],
    latelunch: ['lunch', 'meal', 'brunch', 'snack'], pmstroll: ['SPOT'], pmcafe: ['cafe', 'dessert'],
    d1dinner: ['dinner', 'meal', 'lunch'], d1night: ['SPOT', 'supper', 'snack', 'dessert'],
    d5brunch: ['brunch'], d5lunch: ['lunch', 'meal']
  };
  // 各時段的概略時間，用來比對店家營業時間（避免排到已打烊的時段）
  const SLOT_NOMINAL = {
    brunch: 540, morning: 615, lunch: 690, afternoon: 840, cafe: 945, sweet: 1005,
    evening: 1050, dinner: 1065, night: 1200, latelunch: 825, pmstroll: 930, pmcafe: 1005,
    d1dinner: 1080, d1night: 1230, d5brunch: 525, d5shop: 600, d5lunch: 680
  };
  // 該時段是否落在店家營業時間內（收尾預留 30 分鐘）
  function slotOpen(item, slotKey) {
    const t = SLOT_NOMINAL[slotKey];
    if (t == null) return true;
    if (item.close != null && t + 30 > item.close) return false;
    if (item.open != null && t < item.open) return false;
    return true;
  }

  // 時段分組：同組內可依地理位置重排，跨組維持先後（上午→午餐→下午→晚餐→夜間）
  const SLOT_BAND = {
    brunch: 0, d5brunch: 0, morning: 0,
    latelunch: 1, lunch: 1, d5lunch: 1,
    afternoon: 2, pmstroll: 2, cafe: 2, sweet: 2, pmcafe: 2, d5shop: 2,
    evening: 3, dinner: 3, d1dinner: 3,
    night: 4, d1night: 4
  };

  // 正餐 slot 與各自「最晚可接受的開始時間」——路線最佳化不得把正餐擠出這個區間
  const MEAL_SLOTS = ['brunch', 'd5brunch', 'lunch', 'latelunch', 'd5lunch', 'dinner', 'd1dinner'];
  // 每個時段「最晚可以開始」的時間——上午的景點不該被排到晚上，午餐不該排到下午四點
  const SLOT_LATEST = {
    brunch: 690, d5brunch: 690, morning: 840,
    lunch: 840, d5lunch: 810, latelunch: 900,
    afternoon: 1050, pmstroll: 1050,
    cafe: 1110, pmcafe: 1140, sweet: 1200,
    evening: 1230, dinner: 1230, d1dinner: 1260,
    night: 1320, d1night: 1320
  };
  const DOW_TXT = ['日','一','二','三','四','五','六'];
  // 這家店在這天有開嗎？（closedDow: 0=週日 … 6=週六）
  const openOnDay = (o, day) =>
    !(o && o.closedDow && day && day.dow != null && o.closedDow.indexOf(day.dow) >= 0);

  // 正餐＝會吃飽的一頓（咖啡／甜點／小吃不算），用來檢查兩餐間隔
  const isRealMeal = it => it && it.kind === 'food' &&
    ['brunch', 'lunch', 'dinner', 'meal'].indexOf(it.slot) >= 0;
  // 30 分鐘就解決的外帶輕食（早餐三明治、貝果）不等於「一頓正餐」——
  // 用 3.5 小時把下一餐整個擋掉會排不出行程，只要不緊接著吃就好
  const isLightMeal = it => isRealMeal(it) && (it.stay || 60) < (CONFIG.lightMealStay || 40);

  const isMealStop = st => st.type === 'cell' && st.cell && st.cell.item && MEAL_SLOTS.indexOf(st.slotKey) >= 0;
  function timingOk(tl) {
    return tl.every(r => {
      if (r.k !== 'item' || !r.slotKey) return true;
      const latest = SLOT_LATEST[r.slotKey];
      return latest == null || r.t <= latest;
    });
  }

  // 某天已排入項目的座標 → 供「距離感知」的補位推薦與路線最佳化
  function dayPoints(day) {
    const pts = [];
    day.slotKeys.forEach(k => {
      const c = day.slots[k];
      if (c && c.item) pts.push({ lat: c.item.lat, lng: c.item.lng });
    });
    return pts;
  }
  function nearestKm(pts, it) {
    if (!pts.length) return 0;
    let m = Infinity;
    pts.forEach(p => { const d = havKm(p, it); if (d < m) m = d; });
    return m;
  }

  // 各時段「不早於」的開始時間（分鐘制；交通試算若更晚則以抵達為準）
  const SLOT_TARGET = {
    brunch: 540, lunch: 690, evening: 1050, dinner: 1020, night: 1200,
    latelunch: 825, d1dinner: 1080, d1night: 1230,
    d5brunch: 525, d5shop: 600, d5lunch: 680
  };
  // 景點時段偏好 → 可放的 slot 順序（依日型）
  const SPOT_PREF = {
    morning: ['morning', 'afternoon', 'pmstroll', 'evening'],
    afternoon: ['afternoon', 'pmstroll', 'morning', 'evening'],
    evening: ['evening', 'night', 'd1night', 'afternoon'],
    night: ['night', 'd1night', 'evening']
  };
  // 餐飲 slot → 嘗試順序
  const FOOD_PREF = {
    brunch: ['brunch', 'd5brunch', 'latelunch'],
    lunch: ['lunch', 'latelunch', 'd5lunch', 'dinner', 'd1dinner'],
    meal: ['lunch', 'dinner', 'latelunch', 'd1dinner', 'd5lunch'],
    dinner: ['dinner', 'd1dinner'],
    cafe: ['cafe', 'pmcafe', 'sweet'],
    dessert: ['sweet', 'pmcafe', 'cafe', 'night', 'd1night'],
    snack: ['sweet', 'night', 'd1night', 'latelunch'],
    supper: ['night', 'd1night']
  };

  function makeDays() {
    return [
      { key: 'd1', date: '9/26（六）', dow: 6, full: false, cluster: 'seomyeon', theme: '抵達釜山・西面暖身',
        slotKeys: ['latelunch', 'pmstroll', 'pmcafe', 'd1dinner', 'd1night'] },
      { key: 'd2', date: '9/27（日）', dow: 0, full: true, cluster: 'east', theme: '海岸線一日',
        slotKeys: ['brunch', 'morning', 'lunch', 'afternoon', 'cafe', 'sweet', 'evening', 'dinner', 'night'] },
      { key: 'd3', date: '9/28（一）', dow: 1, full: true, cluster: 'gwangalli', theme: '海景與夜色',
        slotKeys: ['brunch', 'morning', 'lunch', 'afternoon', 'cafe', 'sweet', 'evening', 'dinner', 'night'] },
      { key: 'd4', date: '9/29（二）', dow: 2, full: true, cluster: 'nampo', theme: '舊城文化散策',
        slotKeys: ['brunch', 'morning', 'lunch', 'afternoon', 'cafe', 'sweet', 'evening', 'dinner', 'night'] },
      { key: 'd5', date: '9/30（三）', dow: 3, full: false, cluster: 'seomyeon', theme: '西面最終採購・返程',
        slotKeys: ['d5brunch', 'd5shop', 'd5lunch'] }
    ];
  }

  /* ---- 停靠點（seq）輔助 ---- */
  const storeStay = g => Math.min(100, g.store.stay + Math.max(0, g.items.length - 3) * 4);

  /* 停靠點的穩定識別鍵：手動排序（state.ord）靠它跨次重排都對得起來 */
  const stopKey = st => st.type === 'store' ? 'st:' + st.storeId
    : st.type === 'd5shop' ? 'd5shop'
    : (st.cell && st.cell.anchor) ? 'anchor'
    : (st.cell && st.cell.item) ? st.cell.item.id : null;

  function posOfStop(stop, day) {
    if (stop.type === 'store') return { lat: stop.store.lat, lng: stop.store.lng, zone: stop.store.zone };
    if (stop.type === 'd5shop') {
      const s = STORES.oy_seomyeon;
      return { lat: s.lat, lng: s.lng, zone: s.zone };
    }
    const cell = stop.cell;
    if (cell.anchor) {
      const am = ANCHOR_META[day.cluster] || ANCHOR_META.seomyeon;
      return { lat: am.lat, lng: am.lng, zone: am.zone };
    }
    return { lat: cell.item.lat, lng: cell.item.lng, zone: cell.item.zone };
  }
  function stayOfStop(stop, day) {
    if (stop.type === 'store') return storeStay(stop);
    if (stop.type === 'd5shop') return stop.stay;
    const cell = stop.cell;
    if (cell.anchor) return (ANCHOR_META[day.cluster] || {}).stay || 60;
    return cell.item.stay || 60;
  }

  /* ---- 路線最佳化 ----
     餐與景點依時段固定先後（早餐不會跑到晚上），但同一時段內改用「最近鄰」串起來；
     採購站與散步這類沒有時間包袱的停靠點，則插到整條路線繞路最少的位置。 */
  function optimizeDayRoute(day) {
    const seq = day.seq;
    if (!seq || seq.length < 2) return;

    /* 使用者手動排過這天的順序 → 完全照使用者的先後，只重算時間與交通；
       之後才加進來的新停靠點（換天搬來的、空檔加點的）就自動找繞路最少的位置插入 */
    const ordK = state.ord[day._i];
    if (ordK && ordK.length) {
      day.manualOrd = true;
      const CFm = CONFIG.curfew || { normal: 1290, far: 1320, farKm: 12 };
      day.curfewLimit = seq.some(st => havKm(HOTEL, posOfStop(st, day)) >= CFm.farKm) ? CFm.far : CFm.normal;
      const ix = {};
      ordK.forEach((k, i) => { if (ix[k] == null) ix[k] = i + 1; });
      const listed = seq.filter(st => ix[stopKey(st)]);
      const extra = seq.filter(st => !ix[stopKey(st)]);
      listed.sort((a, b) => ix[stopKey(a)] - ix[stopKey(b)]);
      day.seq = listed;
      extra.forEach(st => {
        if (insertFlexible(day, st)) return;
        if (st.type === 'cell' && st.cell) {
          if (st.cell.item && !st.cell.suggest) day.backup.push(st.cell.item);
          if (st.slotKey) day.slots[st.slotKey] = null;
          (day.trimmed = day.trimmed || []).push(st);
          day.overflow = true;
        } else day.seq.push(st);
      });
      return;
    }

    if (day.key === 'd5') return; // 返程日全在西面步行圈，維持「早餐→採購→午餐」的時段順序
    const P = st => posOfStop(st, day);
    const isFlex = st => st.type === 'store' || (st.type === 'cell' && st.cell && st.cell.anchor);
    const bandOf = st => st.type === 'd5shop' ? 0
      : (SLOT_BAND[st.slotKey] != null ? SLOT_BAND[st.slotKey] : 2);

    // 先估當天門禁（有 12 公里外的遠程景點就放寬），供插入位置判斷用
    const CFc = CONFIG.curfew || { normal: 1290, far: 1320, farKm: 12 };
    day.curfewLimit = seq.some(st => havKm(HOTEL, posOfStop(st, day)) >= CFc.farKm) ? CFc.far : CFc.normal;

    // 正餐與「手動指定」的項目固定在時段順序上，其餘才依地理位置彈性安插
    // （手動指定若也走彈性插入，算出的時間超過該時段上限就會被丟回備選＝推翻使用者的決定）
    const isFixed = st => isMealStop(st) || (st.type === 'cell' && st.cell && st.cell.pinned);
    const meals = seq.filter(isFixed).sort((a, b) => bandOf(a) - bandOf(b));
    const rest = seq.filter(st => !isFixed(st));
    day.seq = meals;

    // 先插停留較久的（景點通常最長，先卡位才不會被擠掉），再插採購與散步
    rest.sort((a, b) => (stayOfStop(b, day) || 0) - (stayOfStop(a, day) || 0));
    rest.forEach(st => {
      if (insertFlexible(day, st)) return;
      if (st.type === 'cell' && st.cell) {
        if (st.cell.item && !st.cell.suggest) day.backup.push(st.cell.item);
        if (st.slotKey) day.slots[st.slotKey] = null;
        (day.trimmed = day.trimmed || []).push(st);
        day.overflow = true;
      } else if (st.type === 'store' || st.type === 'd5shop') {
        day.seq.push(st); // 採購站沒有時段包袱，仍放進當天由門禁決定去留
      }
    });
  }

  function insertFlexible(day, stop) {
    const seq = day.seq;
    if (!seq.length) { seq.push(stop); return true; }
    const S = posOfStop(stop, day);
    const store = stop.type === 'store' ? stop.store : null;
    const openMin = store && store.open != null ? store.open : null;
    const closeMin = store && store.close != null ? store.close : null;
    // 先用幾何繞路快速排序（便宜），只對最順的幾個位置做完整時間軸試算（昂貴）
    // 否則每插一個點都要跑 n 次時間軸，項目一多會變成 O(n³)
    const geo = [];
    for (let i = -1; i < seq.length; i++) {
      const A = i < 0 ? HOTEL : P2(seq[i], day);
      const B = i + 1 >= seq.length ? HOTEL : P2(seq[i + 1], day);
      geo.push({ i, det: havKm(A, S) + havKm(S, B) - havKm(A, B) });
    }
    geo.sort((a, b) => a.det - b.det);
    const TRY_TOP = 8;
    const cand = [];
    for (const g of geo.slice(0, TRY_TOP)) {
      const seq2 = seq.slice();
      seq2.splice(g.i + 1, 0, stop);
      const tmp = { key: day.key, cluster: day.cluster, seq: seq2 };
      computeTimeline(tmp);
      const row = tmp.tl.find(r => (r.k === 'store' && r.g === stop) ||
        (r.k === 'item' && stop.cell && r.cell === stop.cell));
      if (!row) continue;
      const hr = tmp.tl.filter(x => x.k === 'hotel').pop();
      cand.push({ i: g.i, det: g.det, start: row.t, end: row.end,
        meals: timingOk(tmp.tl), back: hr ? hr.t : 0 });
    }
    if (!cand.length) return false;
    const CLOSE_BUF = 15;                          // 打烊前留 15 分鐘結帳離場
    const ok = cand.filter(c =>
      c.meals &&                                   // 不能把任何行程擠出它該有的時段
      (closeMin == null || c.end <= closeMin - CLOSE_BUF) &&
      (openMin == null || c.start >= openMin) &&
      c.start <= 1230);
    if (!ok.length) return false;                  // 這天排不進合理時段 → 交給呼叫端列為備選
    // 先看有沒有「能準時回飯店」的排法，有的話只在這些位置裡比繞路
    const CFL = day.key === 'd5' ? 740 : (day.curfewLimit || (CONFIG.curfew || {}).normal || 1290);
    const inTime = ok.filter(c => c.back && c.back <= CFL);
    const pool = inTime.length ? inTime : ok;
    const pick = pool.sort((a, b) => a.det - b.det)[0];
    seq.splice(pick.i + 1, 0, stop);
    return true;
  }
  const P2 = (st, day) => posOfStop(st, day);

  /* ---- 回飯店門禁 ----
     每天都要在 21:30 前回到飯店；當天有跑到 12 公里外的遠程景點才放寬到 22:00。
     超過就把最後面、且最不影響行程的停靠點移出來，改列同區備選。 */
  function enforceCurfew(day) {
    const CF = CONFIG.curfew || { normal: 1290, far: 1320, farKm: 12 };
    const D5_BACK = 740; // 12:20 前回到飯店領行李，才趕得上 12:30 出發往機場

    for (let guard = 0; guard < 20; guard++) {
      computeTimeline(day);
      let limit;
      if (day.key === 'd5') {
        limit = D5_BACK;
      } else {
        const far = day.seq.some(st => havKm(HOTEL, posOfStop(st, day)) >= CF.farKm);
        limit = far ? CF.far : CF.normal;
        day.curfew = limit;
        day.farDay = far;
      }
      const hotelRow = day.tl.filter(r => r.k === 'hotel').pop();
      const back = hotelRow ? hotelRow.t : null;
      if (back == null || back <= limit || !day.seq.length) break;
      // 手動排序的天：使用者的順序說了算，超時只提醒、不擅自刪停靠點
      if (day.manualOrd) { day.curfewSoft = true; break; }

      // 移除優先序：散步錨點 → 自動補位 → 順路採購 → 自己勾的項目 → 最後採購（最後才動）
      const rank = st => {
        if (st.type === 'cell' && st.cell && st.cell.pinned) return 6; // 手動指定的最後才動
        if (st.type === 'store' && st.pinnedStore) return 6;           // 手動指定日期的採購站同樣受保護
        if (st.type === 'd5shop') return 5;
        if (isMealStop(st)) return 4;   // 正餐（含自動補位的）最後才動
        if (st.type === 'cell' && st.cell && st.cell.anchor) return 0;
        if (st.type === 'cell' && st.cell && st.cell.suggest) return 1;
        if (st.type === 'store') return 2;
        return 3;
      };
      // 同一級之內先砍推薦度低的（別為了準時回家把甘川洞、遊艇這種重點砍掉）
      const recOf = st => (st.type === 'cell' && st.cell && st.cell.item) ? (st.cell.item.rec || 0) : 0;
      let si = -1, best = Infinity, bestRec = Infinity;
      day.seq.forEach((st, i) => {
        const r = rank(st), rc = recOf(st);
        if (r < best || (r === best && rc < bestRec) || (r === best && rc === bestRec && i > si)) {
          best = r; bestRec = rc; si = i;
        }
      });
      if (si < 0) break;
      // 只剩自己勾的項目或正餐可砍、又只超時一點點 → 寧可晚幾分鐘回飯店，也不要犧牲重點行程或整天沒好好吃飯
      if (best >= 3 && back <= limit + 30) { day.curfewSoft = true; break; }
      const [removed] = day.seq.splice(si, 1);
      (day.trimmed = day.trimmed || []).push(removed);
      if (removed.type === 'cell' && removed.cell) {
        if (removed.cell.item && !removed.cell.suggest) day.backup.push(removed.cell.item);
        if (removed.slotKey) {
          day.slots[removed.slotKey] = null;
          if (removed.slotKey === 'd5lunch' || removed.slotKey === 'd5brunch') day.lunchDropped = true;
        }
      }
      day.overflow = true;
    }
    computeTimeline(day);
  }

  /* ---- 每日時間軸試算 ---- */
  function computeTimeline(day) {
    const t = CONFIG.trip;
    const rows = [];
    if (day.key === 'd1') {
      rows.push({ k: 'fixed', t: '08:10', text: `✈️ ${t.outbound.dep}（${t.outbound.airline}）`, sub: '建議 06:10 前抵達機場辦理報到與托運' });
      rows.push({ k: 'fixed', t: '11:30', text: '🛬 抵達金海國際機場', sub: '韓國時間比台灣快 1 小時｜入境後可先領 WOWPASS／T-money' });
      rows.push({ k: 'fixed', t: '12:15', text: '🚉 機場 → 西面樂天飯店', sub: '機場輕軌轉地鐵2號線約 40 分（每人約NT$40）／計程車約 25 分（約NT$430-540）' });
      rows.push({ k: 'fixed', t: '13:15', text: `🏨 ${t.hotel.name} 寄放行李`, sub: '15:00 後正式入住｜' + t.hotel.area, links: { g: t.hotel.links.g, o: t.hotel.links.o } });
    }
    if (day.key === 'd5') {
      rows.push({ k: 'fixed', t: '08:30', text: '🧳 整理行李・辦理退房', sub: '行李寄放櫃台，採買完回飯店領取' });
    }
    let cur = { lat: HOTEL.lat, lng: HOTEL.lng, zone: HOTEL.zone };
    let time = day.key === 'd1' ? 820 : day.key === 'd5' ? 520
      : (day.seq[0] && day.seq[0].slotKey === 'brunch' ? 525 : 570);
    let transCost = 0, transMins = 0, transKm = 0;
    let lastMeal = -999;                       // 上一頓正餐的開始時間
    const MEAL_GAP = (CONFIG.mealGap != null) ? CONFIG.mealGap : 210;
    let lastGap = MEAL_GAP;                    // 上一頓要求的間隔（輕食減半）
    const modeCnt = { walk: 0, taxi: 0, metro: 0 };

    day.seq.forEach((stop, si) => {
      const pos = posOfStop(stop, day);
      const tr = transCalc(cur, pos);
      const tKey = stop.slotKey || (stop.type === 'd5shop' ? 'd5shop' : null);
      let target = tKey ? SLOT_TARGET[tKey] : null;
      if (stop.type === 'd5shop' && stop.open) target = Math.max(target || 0, stop.open);
      const near = tr.mode === 'walk' && tr.mins <= 3; // 幾乎同地點，不畫交通列
      const arr0 = time + (near ? 3 : tr.mins);
      let start = ceil5(arr0);
      if (target && target > start) start = target;
      if (near) {
        const gap = start - time;
        if (gap >= 25) rows.push({ k: 'free', t: time, mins: gap });
      } else {
        let dep = start - tr.mins;
        const gap = dep - time;
        if (gap >= 25) rows.push({ k: 'free', t: time, mins: gap });
        else dep = time;
        rows.push({ k: 'trans', dep, arr: dep + tr.mins, tr });
        transCost += tr.fare2; transMins += tr.mins; transKm += (tr.km || 0);
        modeCnt[tr.mode]++;
      }
      // 剛吃完沒多久不會再吃一頓 —— 正餐之間至少間隔 3.5 小時
      const mealItem = stop.type === 'cell' && stop.cell && isRealMeal(stop.cell.item);
      if (mealItem && start < lastMeal + lastGap) start = ceil5(lastMeal + lastGap);
      if (mealItem) {
        lastMeal = start;
        lastGap = isLightMeal(stop.cell.item) ? Math.round(MEAL_GAP / 2) : MEAL_GAP;
      }
      const stay = stayOfStop(stop, day);
      const end = start + stay;
      if (stop.type === 'store') rows.push({ k: 'store', t: start, end, stay, g: stop, si });
      else if (stop.type === 'd5shop') rows.push({ k: 'd5shop', t: start, end, stay, stores: stop.stores, warn: stop.warn, si });
      else rows.push({ k: 'item', t: start, end, stay, slotKey: stop.slotKey, cell: stop.cell, si });
      time = end;
      cur = pos;
    });

    if (day.seq.length) {
      const tr = transCalc(cur, { lat: HOTEL.lat, lng: HOTEL.lng, zone: HOTEL.zone });
      rows.push({ k: 'trans', dep: time, arr: time + tr.mins, tr });
      transCost += tr.fare2; transMins += tr.mins; transKm += (tr.km || 0);
      modeCnt[tr.mode]++;
      time += tr.mins;
      rows.push({ k: 'hotel', t: time, pickup: day.key === 'd5', curfew: day.curfew, soft: day.curfewSoft });
    }
    if (day.key === 'd5') {
      // 機場出發時間依實際回飯店時間動態推算，不早於 12:30
      const dep = Math.max(750, ceil5(time + 10));
      day.squeeze = dep > 750;
      rows.push({ k: 'fixed', t: fmtT(dep), text: '🚕 前往金海國際機場',
        sub: `計程車約 25 分（約NT$430-540）；建議 13:00 前抵達機場辦理退稅、報到與托運${day.squeeze ? `——目前行程 ${fmtT(time)} 才回到飯店，已經偏緊` : ''}` });
      rows.push({ k: 'fixed', t: '15:00', text: `✈️ ${t.inbound.dep}（${t.inbound.airline} ${t.inbound.flightNo}）`, sub: '✅ 已於星宇官網查詢確認班機時刻（如另有改班請以實際訂位為準）' });
      rows.push({ k: 'fixed', t: '16:30', text: '🛬 抵達台中國際機場', sub: '台灣時間｜歡迎回家 🎉' });
    }
    day.tl = rows;
    day.transCost = transCost;
    day.transMins = transMins;
    day.transKm = transKm;
    day.modeCnt = modeCnt;
  }

  function generate() {
    const sel = ALL.filter(it => state.sel.has(it.id)).sort((a, b) => a._idx - b._idx);
    const spots = sel.filter(i => i.kind === 'spot');
    const foods = sel.filter(i => i.kind === 'food');
    const shops = sel.filter(i => i.kind === 'shop');

    const days = makeDays();
    days.forEach((d, i) => { d._i = i; });

    /* 依勾選數量重新分配 Day2-4 的主題區域 */
    const cnt = { east: 0, gwangalli: 0, nampo: 0 };
    [...spots, ...foods].forEach(it => {
      const cs = it.flex || [it.cluster];
      cs.forEach(c => { if (cnt[c] !== undefined) cnt[c] += 1 / cs.length; });
    });
    const bigOrder = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
    const fullDays = days.filter(d => d.full);
    const themes = { east: '海雲台・機張 海岸線一日', gwangalli: '廣安里 海景與夜色', nampo: '南浦洞・甘川洞 舊城文化' };
    // 使用者手動對調過整天 → 直接照他的安排（Day2-4）
    if (state.dayCl && state.dayCl.length === 3) {
      fullDays.forEach((d, i) => { if (CLUSTERS[state.dayCl[i]]) d.cluster = state.dayCl[i]; });
    }
    fullDays.forEach(d => {
      if (state.dayCl) { d.theme = themes[d.cluster]; return; }   // 手動指定就不再自動改派
      if (cnt[d.cluster] === 0 && cnt[bigOrder[0]] >= 6) {
        d.cluster = bigOrder[0];
        d.theme = themes[bigOrder[0]] + '（續）';
        d.repurposed = true;
      } else {
        d.theme = themes[d.cluster];
      }
    });

    // 建 slot 容器
    days.forEach(d => {
      d.slots = {};
      d.slotKeys.forEach(k => { d.slots[k] = null; });
      d.backup = [];
    });

    const daysByCluster = c => days.filter(d => d.cluster === c);

    function tryPlace(item, prefSlots, clusters) {
      const key = item.kind === 'spot' ? 'SPOT' : item.slot;
      for (const c of clusters) {
        for (const sk of prefSlots) {
          for (const d of daysByCluster(c)) {
            if (!(sk in d.slots) || d.slots[sk]) continue;
            const acc = ACCEPT[sk] || [];
            if (!acc.includes(key)) continue;
            if (!slotOpen(item, sk)) continue; // 該時段店家已打烊／尚未開門
            if (!openOnDay(item, d)) continue;  // 這天店家公休
            d.slots[sk] = { item, suggest: false };
            return true;
          }
        }
      }
      return false;
    }

    /* 手動調整優先：使用者指定的日期／時段先卡位，其餘再自動排在它周圍 */
    const pinnedIds = new Set();
    // 最近一次指定的優先卡位（兩項指定同一時段時，後操作的贏）
    [...spots, ...foods]
      .filter(it => state.pins[it.id])
      .sort((a, b) => (state.pins[b.id].t || 0) - (state.pins[a.id].t || 0))
      .forEach(it => {
        const pin = state.pins[it.id];
        const d = days[pin.d];
        if (!d) return;
        const key = it.kind === 'spot' ? 'SPOT' : it.slot;
        const pref = it.kind === 'spot' ? (SPOT_PREF[it.slot] || SPOT_PREF.afternoon)
                                        : (FOOD_PREF[it.slot] || FOOD_PREF.meal);
        // 指定時段最優先；被佔走時退回該型態的偏好順序，再不行就用當天任何空時段
        const put = sk => {
          if (!(sk in d.slots) || d.slots[sk] || sk === 'd5shop') return false;
          d.slots[sk] = { item: it, suggest: false, pinned: true };
          pinnedIds.add(it.id);
          if (!openOnDay(it, d)) d.pinnedClosed = (d.pinnedClosed || []).concat(it);
          return true;
        };
        // 放寬時的順位：先找性質接近的時段（餐廳優先正餐、景點優先白天），且店家要有開
        const RELAX = it.kind === 'spot'
          ? ['morning', 'afternoon', 'pmstroll', 'evening', 'night', 'd1night', 'cafe', 'sweet']
          : ['lunch', 'dinner', 'latelunch', 'd1dinner', 'd5lunch', 'sweet', 'pmcafe', 'cafe',
             'night', 'd1night', 'brunch', 'd5brunch'];
        // 第一輪：指定時段（使用者說了算）→ 第二輪：型態偏好 → 第三輪：性質相近的空時段
        // 使用者已經指定了這天，寧可換個時段也不要讓它掉出行程
        const ok = (pin.s && put(pin.s)) ||
          pref.some(sk => (ACCEPT[sk] || []).includes(key) && slotOpen(it, sk) && put(sk)) ||
          RELAX.some(sk => d.slotKeys.indexOf(sk) >= 0 && slotOpen(it, sk) && put(sk));
        if (!ok) return;
      });

    const unplaced = [];
    // 先放景點（slot 較稀缺）
    spots.forEach(it => {
      if (pinnedIds.has(it.id)) return;
      const clusters = it.flex || [it.cluster];
      if (!tryPlace(it, SPOT_PREF[it.slot] || SPOT_PREF.afternoon, clusters)) unplaced.push(it);
    });
    // 再放餐飲：固定區域者先、彈性（多分店）者後
    const fixedFoods = foods.filter(f => !f.flex && !pinnedIds.has(f.id));
    const flexFoods = foods.filter(f => f.flex && !pinnedIds.has(f.id));
    [...fixedFoods, ...flexFoods].forEach(it => {
      const clusters = it.flex || [it.cluster];
      if (!tryPlace(it, FOOD_PREF[it.slot] || FOOD_PREF.meal, clusters)) unplaced.push(it);
    });
    // 放不進去的 → 掛到主區域日的備選
    unplaced.forEach(it => {
      const home = daysByCluster((it.flex || [it.cluster])[0])[0] || days[0];
      home.backup.push(it);
    });

    /* 自動補位建議（未勾選、清楚標示） */
    if (state.autoFill) {
      const suggested = new Set();
      const usedBrands = selectedBrands(); // 避免補位推薦到已選品牌的另一家分店
      const suggest = (day, slotKey, filter) => {
        if (day.slots[slotKey]) return;
        const cand = FOODS.filter(f =>
          !state.sel.has(f.id) && !suggested.has(f.id) &&
          !(f.brand && usedBrands.has(f.brand)) &&
          (f.flex || [f.cluster]).includes(day.cluster) &&
          (ACCEPT[slotKey] || []).includes(f.slot) &&
          slotOpen(f, slotKey) &&
          openOnDay(f, day) &&
          (!filter || filter(f)));
        // 距離感知：推薦度高但離當天其他行程太遠的店要扣分，避免為了一餐跑十幾公里
        const pts = dayPoints(day);
        const score = f => (f.rec || 0) - 4 * nearestKm(pts, f);
        cand.sort((a, b) => score(b) - score(a) || a._idx - b._idx);
        if (cand.length) {
          suggested.add(cand[0].id);
          if (cand[0].brand) usedBrands.add(cand[0].brand);
          day.slots[slotKey] = { item: cand[0], suggest: true };
        }
      };
      const d1 = days[0], d5 = days[4];
      // Day1 逢中秋連假 → 優先 24hr 店
      suggest(d1, 'latelunch', f => (f.tag || '').includes('24hr'));
      suggest(d1, 'latelunch');
      suggest(d1, 'd1dinner', f => (f.tag || '').includes('24hr'));
      suggest(d1, 'd1dinner');
      days.filter(d => d.full).forEach(d => { suggest(d, 'lunch'); suggest(d, 'dinner'); });
      // Day5 趕飛機：只推薦西面步行圈的午餐
      suggest(d5, 'd5lunch', f => f.zone === 'seomyeon' || f.zone === 'jeonpo');
    }

    /* 下午與傍晚皆空 → 插入免費散步錨點，避免行程出現大空窗 */
    days.forEach(d => {
      const a = ANCHORS[d.cluster];
      if (!a) return;
      if (d.full) {
        if (!d.slots.afternoon && !d.slots.evening) d.slots.afternoon = { anchor: a };
      } else if (d.key === 'd1' && !d.slots.pmstroll) {
        d.slots.pmstroll = { anchor: a };
      }
    });

    /* ── 購物 → 具體門市 → 排入行程 ── */
    const byStore = {};
    shops.forEach(it => {
      if (!it._store) return;
      (byStore[it.store] = byStore[it.store] || { type: 'store', storeId: it.store, store: it._store, items: [] }).items.push(it);
    });
    const storeGroups = Object.values(byStore);
    const cvsGroup = storeGroups.find(g => g.storeId === 'cvs');
    /* 門市手動指定日期：使用者說了算。指定 Day1-4 者從自動分配抽出；
       指定 Day5 的西面店回到最終採購合併站、非西面店則單獨排進 Day5 */
    const stPinOf = g => {
      const p = state.stPins[g.storeId];
      return (p && p.d >= 0 && p.d <= 4) ? p.d : null;
    };
    const pinnedEarly = storeGroups.filter(g => g !== cvsGroup && stPinOf(g) != null && stPinOf(g) < 4);
    const smGroups = storeGroups.filter(g => g !== cvsGroup && !pinnedEarly.includes(g) && ZONES[g.store.zone].cluster === 'seomyeon');
    const otherGroups = storeGroups.filter(g => g !== cvsGroup && !pinnedEarly.includes(g) && !smGroups.includes(g));
    const pinnedD5Other = otherGroups.filter(g => stPinOf(g) === 4);
    const autoOther = otherGroups.filter(g => stPinOf(g) == null);

    /* 每日停靠序列（不含 d5shop 佔位，稍後客製） */
    days.forEach(d => {
      d.seq = d.slotKeys
        .filter(k => k !== 'd5shop' && d.slots[k])
        .map(k => ({ type: 'cell', slotKey: k, cell: d.slots[k] }));
    });

    /* 非西面門市 → 掛到對應區域日（實際落點交給下方的路線最佳化決定） */
    autoOther
      .sort((a, b) => b.items.length - a.items.length)
      .forEach(g => {
        const cl = ZONES[g.store.zone].cluster;
        const same = days.slice(1, 4).filter(d => d.cluster === cl);
        // 該區域日若碰上這間店公休，就找其他有開的日子（沒有就標示公休）
        const day = same.find(d => openOnDay(g.store, d)) || same[0];
        if (day && openOnDay(g.store, day)) day.seq.push(g);
        else if (day) { g.closedDay = true; day.closedShops = (day.closedShops || []).concat(g); }
        else g.unplaced = true;
      });

    /* 晚開門的西面選品店（NOCLAIM 12:00、ADER 13:00 等 11:00 後才開的店）
       改排 Day 1 下午～傍晚，不塞進 Day 5 上午的最終採購（會撲空） */
    const lateSm = smGroups.filter(g => (g.store.open || 0) >= 660 && stPinOf(g) !== 4);
    const d5Sm = smGroups.filter(g => !lateSm.includes(g));
    lateSm.forEach(g => days[0].seq.push(g));

    /* 手動指定 Day1-4 的門市 → 直接排進那天（位置交給路線最佳化；公休照排但明白提醒） */
    pinnedEarly.forEach(g => {
      const day = days[stPinOf(g)];
      g.pinnedStore = true;
      day.seq.push(g);
      if (!openOnDay(g.store, day)) day.pinnedClosed = (day.pinnedClosed || []).concat({ name: g.store.name });
    });

    /* Day 5：西面最終採購（客製列出門市與品項） */
    const d5 = days[4];
    let d5stop;
    if (d5Sm.length) {
      let stay = d5Sm.reduce((s, g) => s + storeStay(g), 0) + 8 * (d5Sm.length - 1);
      const warn = stay > 100;
      // 起始時間取「最晚開門的那間」，免得先到卻在門口等
      const openAt = d5Sm.reduce((m, g) => Math.max(m, g.store.open || 0), 0);
      d5stop = { type: 'd5shop', stores: d5Sm, stay: Math.min(stay, 110), warn, open: openAt || null };
    } else {
      d5stop = { type: 'd5shop', stores: null, stay: 75 };
    }
    d5.seq = [];
    d5.slotKeys.forEach(k => {
      if (k === 'd5shop') d5.seq.push(d5stop);
      else if (d5.slots[k]) d5.seq.push({ type: 'cell', slotKey: k, cell: d5.slots[k] });
    });
    /* 手動指定 Day5 的非西面門市 → 單獨排進返程日（時間吃緊會照常提醒） */
    pinnedD5Other.forEach(g => { g.pinnedStore = true; d5.seq.push(g); });

    /* 路線最佳化：同時段內依地理位置重排，彈性停靠點插到繞路最少處 */
    days.forEach(optimizeDayRoute);

    /* 時間軸試算＋超時保護（排不下的改列同區備選，不會硬排到深夜） */
    days.forEach(enforceCurfew);

    /* 用餐把關：一天下來若中午或晚上沒安排吃的，補一家離當天動線最近的 */
    if (state.autoFill) {
      const suggested2 = new Set();
      ALL.forEach(it => { if (state.sel.has(it.id)) suggested2.add(it.id); });
      days.forEach(d => {
        if (!d.full) return;
        [['lunch', 660, 900], ['dinner', 1020, 1290]].forEach(([slotKey, from, to]) => {
          const has = d.tl.some(r => r.k === 'item' && r.cell && r.cell.item &&
            r.cell.item.kind === 'food' && r.t >= from - 60 && r.t <= to);
          if (has || d.slots[slotKey]) return;
          const pts = dayPoints(d);
          const cand = FOODS.filter(f =>
            !suggested2.has(f.id) &&
            f.cluster === d.cluster &&
            (ACCEPT[slotKey] || []).indexOf(f.slot) >= 0 &&
            slotOpen(f, slotKey) && openOnDay(f, d))
            .sort((a, b) => ((b.rec || 0) - 4 * nearestKm(pts, b)) - ((a.rec || 0) - 4 * nearestKm(pts, a)));
          if (!cand.length) return;
          // 試著插進去，確認不會害當天超過門禁
          const stop = { type: 'cell', slotKey, cell: { item: cand[0], suggest: true } };
          const backup = d.seq.slice();
          d.slots[slotKey] = stop.cell;
          if (!insertFlexible(d, stop)) { d.slots[slotKey] = null; return; }
          computeTimeline(d);
          const hotelRow = d.tl.filter(r => r.k === 'hotel').pop();
          if (hotelRow && hotelRow.t > (d.curfew || 1290) + 30) {
            d.seq = backup; d.slots[slotKey] = null; computeTimeline(d);
          } else {
            suggested2.add(cand[0].id);
            d.mealFixed = true;
          }
        });
      });
    }

    /* 修剪後若還有餘裕，把備選裡塞得回去的補回來，別浪費空檔 */
    days.forEach(d => {
      if (d.key === 'd5' || !d.trimmed || !d.trimmed.length) return;
      const limit = d.curfew || (CONFIG.curfew || {}).normal || 1290;
      d.trimmed
        .slice()
        .sort((a, b) => {
          const rc = st => (st.cell && st.cell.item && st.cell.item.rec) || 0;
          return rc(b) - rc(a);
        })
        .forEach(stop => {
          const before = d.seq.slice();
          if (!insertFlexible(d, stop)) return;
          computeTimeline(d);
          const hr = d.tl.filter(r => r.k === 'hotel').pop();
          if (hr && hr.t > limit) { d.seq = before; computeTimeline(d); return; }
          if (stop.cell) {
            const bi = d.backup.indexOf(stop.cell.item);
            if (bi >= 0) d.backup.splice(bi, 1);
            if (stop.slotKey) d.slots[stop.slotKey] = stop.cell;
          }
          const ti = d.trimmed.indexOf(stop);
          if (ti >= 0) d.trimmed.splice(ti, 1);
        });
      computeTimeline(d);
      if (!d.backup.length) d.overflow = false;
    });

    /* 備選項目：估算它可以排到哪幾天，讓使用者一鍵換進正選 */
    const dayFreeSlots = d => (d.slotKeys || []).filter(k => k !== 'd5shop' && !d.slots[k]);
    days.forEach(d => {
      (d.backup || []).forEach(it => {
        const key = it.kind === 'spot' ? 'SPOT' : it.slot;
        it._fit = days.map((dd, i) => {
          if (dd.key === 'd5') return null;                       // 返程日不塞
          if (!openOnDay(it, dd)) return null;                    // 這天公休
          const free = dayFreeSlots(dd);
          const hasSlot = free.some(k => (ACCEPT[k] || []).includes(key) && slotOpen(it, k));
          const pts = dayPoints(dd);
          const km = pts.length ? nearestKm(pts, it) : havKm(HOTEL, it);
          const near = (it.flex || [it.cluster]).indexOf(dd.cluster) >= 0;
          const extra = Math.round(km * 2 * 3 + (it.stay || 60));  // 每公里約3分鐘來回
          const back = (dd.tl || []).filter(r => r.k === 'hotel').pop();
          const room = (dd.curfew || 1290) - (back ? back.t : 1290);
          // 沒空位或會超時 → 仍然可以排，但會擠掉當天某一項
          return { i, km, near, fits: hasSlot && extra <= room + 20 };
        }).filter(Boolean)
          .sort((a, b) => (b.fits - a.fits) || (b.near - a.near) || (a.km - b.km));
      });
    });

    /* 車程偏多的日子：算出拿掉哪一站最省，給具體可行動的建議 */
    days.forEach(d => {
      d.hog = null;
      if (!d.seq || d.seq.length < 3 || (d.transMins || 0) < 150) return;
      const base = d.transMins;
      let best = null;
      d.seq.forEach((st, i) => {
        if (st.type === 'd5shop') return;
        const seq2 = d.seq.slice(); seq2.splice(i, 1);
        const tmp = { key: d.key, cluster: d.cluster, seq: seq2, backup: [], slots: d.slots, slotKeys: d.slotKeys, dow: d.dow };
        computeTimeline(tmp);
        const save = base - (tmp.transMins || 0);
        if (!best || save > best.save) {
          const nm = st.type === 'store' ? st.store.name
            : (st.cell && st.cell.item ? st.cell.item.name : (st.cell && st.cell.anchor ? st.cell.anchor.name : ''));
          best = { save, name: nm, km: (d.transKm || 0) - (tmp.transKm || 0) };
        }
      });
      if (best && best.save >= 20) d.hog = best;   // 省得夠多才值得建議
    });

    /* 仍然缺餐就標示出來，別讓人餓半天還不知道 */
    days.forEach(d => {
      if (!d.full) return;
      const foodAt = (from, to) => d.tl.some(r => r.k === 'item' && r.cell && r.cell.item &&
        r.cell.item.kind === 'food' && r.t >= from && r.t <= to);
      d.noLunch = !foodAt(600, 900);
      d.noDinner = !foodAt(960, 1290);
    });

    /* Day5 若因「自動推薦」的午餐超過 12:20 回飯店時限 → 撤掉推薦，改建議機場輕食 */
    if (d5.squeeze) {
      const li = d5.seq.findIndex(st => st.type === 'cell' && st.slotKey === 'd5lunch' && st.cell.suggest);
      if (li >= 0) {
        d5.seq.splice(li, 1);
        d5.slots.d5lunch = null;
        d5.lunchDropped = true;
        computeTimeline(d5);
      }
    }
    const transTotal = days.reduce((s, d) => s + (d.transCost || 0), 0);

    /* 採購清單分組（依門市 → 對應日提示） */
    const shopGroups = {};
    // 這個門市實際被排進哪一天？（沒排進去就別謊稱順路）
    const placedDayOf = g => {
      const i = days.findIndex(d => (d.seq || []).some(st => st === g) ||
        (d.tl || []).some(r => r.k === 'store' && r.g === g) ||
        (d.tl || []).some(r => r.k === 'd5shop' && (r.stores || []).indexOf(g) >= 0));
      return i;
    };
    storeGroups.forEach(g => {
      const cl = ZONES[g.store.zone].cluster;
      const di = placedDayOf(g);
      let hint;
      if (g.storeId === 'cvs') hint = '隨時順手買｜' + g.store.name;
      else if (g.closedDay) hint = `⚠️ 這趟排不到（該店在對應行程日公休）｜${g.store.name}`;
      else if (di >= 0) hint = `Day ${di + 1} ${g.pinnedStore ? '手動指定採買' : '順路採買'}｜${g.store.name}`;
      else if (cl === 'seomyeon' && (g.store.open || 0) >= 660) hint = 'Day 1 下午順路採買（該店中午後才開門）｜' + g.store.name;
      else if (cl === 'seomyeon') hint = 'Day 5 上午集中採買（可提前 Day 1 傍晚）｜' + g.store.name;
      else hint = `⚠️ 時間排不進行程，想買要自行安排｜${g.store.name}`;
      shopGroups[hint] = { store: g.store, storeId: g.storeId, pinned: !!g.pinnedStore, items: g.items };
    });

    /* 費用估算 */
    let cost = 0;
    [...spots, ...foods].forEach(it => { cost += it.est || 0; });
    let shopCost = 0;
    shops.forEach(it => { shopCost += it.est || 0; });

    return { days, shopGroups, cost, shopCost, transTotal, sel, spots, foods, shops };
  }

  /* ============================================================
     畫面渲染 — 勾選頁
     ============================================================ */
  function cardHtml(it) {
    const ci = catInfo(it);
    const cl = CLUSTERS[it.cluster];
    const on = state.sel.has(it.id);
    const priceLine = it.price ? `<div class="meta">💰 ${esc(it.price)}</div>` : '';
    const waitLine = it.wait ? `<div class="meta sub">⏱ ${esc(it.wait)}</div>` : '';
    const buyLine = it.buy ? `<div class="meta sub">🏬 ${esc(it.buy)}</div>` : '';
    const distTxt = it._km < 0.55 ? '飯店步行圈' : '距飯店約' + kmTxt(it._km);
    const extraLine = it.kind === 'shop'
      ? `<div class="meta sub">🧭 ${distTxt}｜🛒 行程門市：${esc(it._store ? it._store.name : it.buy || '')}</div>`
      : `<div class="meta sub">🧭 ${distTxt}${it.kind === 'spot' && it.stay ? `｜⏳ 建議停留約${durTxt(it.stay)}` : ''}</div>`;
    const sib = siblings(it);
    const branchLine = sib.length
      ? `<div class="meta sub branchline">🏪 同品牌另有：${sib.map(s => esc(s.area)).join('、')}——可改選離當天動線最近的一家</div>`
      : '';
    const safeBadge = it.safe === 'warn' ? '<span class="badge warn">⚠️ 攜帶回台注意</span>'
      : it.safe === 'ok-check' ? '<span class="badge note">✅ 可帶・須託運</span>'
      : it.safe === 'ok-fragile' ? '<span class="badge note">✅ 可帶・防撞</span>'
      : it.safe === 'ok' ? '<span class="badge ok">✅ 合規可帶</span>' : '';
    return `
    <div class="card ${on ? 'on' : ''}" data-id="${it.id}" role="checkbox" aria-checked="${on}" tabindex="0">
      <div class="card-head">
        <span class="badge cluster" style="--c:${cl.color}">${esc(cl.short)}</span>
        <span class="badge cat">${ci.icon} ${esc(ci.label)}</span>
        ${it.tag ? `<span class="badge tag">${esc(it.tag)}</span>` : ''}
        ${safeBadge}
        <span class="tick">${on ? '✓ 已選' : '＋ 選擇'}</span>
      </div>
      <h3>${esc(it.name)}${it.kr ? ` <small>${esc(it.kr)}</small>` : ''}</h3>
      <div class="meta sub">📌 ${esc(it.area || it.buy || '')}</div>
      ${priceLine}${waitLine}${it.area ? buyLine : ''}${extraLine}${branchLine}
      <p class="desc">${esc(it.desc)}</p>
      ${linkRow(it.links, imgQ(it))}
    </div>`;
  }

  /* 目前篩選條件下的清單（勾選頁與智慧推薦共用同一份結果） */
  function filteredList() {
    let list;
    if (state.tab === 'spot') list = SPOTS;
    else if (state.tab === 'food') list = state.foodCat === 'all' ? FOODS : FOODS.filter(f => f.cat === state.foodCat);
    else {
      list = state.shopCat === 'all' ? SHOPS : SHOPS.filter(s => s.cat === state.shopCat);
      if (state.store !== 'all') list = list.filter(s => s.store === state.store);
    }
    if (state.region !== 'all') list = list.filter(i => (i.flex || [i.cluster]).includes(state.region));
    if (state.q) list = list.filter(i => matchQ(i, state.q));
    list = list.slice();
    if (state.sort === 'price') list.sort((a, b) => (a.est || 0) - (b.est || 0) || a._idx - b._idx);
    else if (state.sort === 'dist') list.sort((a, b) => a._km - b._km || a._idx - b._idx);
    else list.sort((a, b) => (b.rec || 0) - (a.rec || 0) || a._idx - b._idx); // 推薦度：跨分類混排
    return list;
  }

  function renderGrid() {
    const emptyMsg = state.q
      ? `找不到符合「${esc(state.q)}」的項目——換個關鍵字，或看看上方其他分頁的符合筆數`
      : '此分類目前沒有符合篩選的項目';
    $('#grid').innerHTML = filteredList().map(cardHtml).join('') ||
      `<p class="empty">${emptyMsg}</p>`;
  }

  /* ---------- 智慧推薦：依目前篩選條件挑推薦度最高、且分類與區域夠分散的項目 ---------- */
  function smartPick() {
    const kind = state.tab;
    const pool = filteredList().filter(it => !state.sel.has(it.id));
    const c = counts();
    const have = kind === 'spot' ? c.sp : kind === 'food' ? c.fo : c.sh;
    const target = kind === 'spot' ? CONFIG.minSpots + 1
      : kind === 'food' ? CONFIG.minFoods + 2 : 6;
    const need = Math.max(2, target - have); // 已達標時仍補 2 個候選
    // 已勾選項目的分類／區域分布 → 避免推薦後過度集中
    const catCount = {}, clCount = {};
    const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
    ALL.forEach(it => {
      if (!state.sel.has(it.id) || it.kind !== kind) return;
      bump(catCount, it.cat || 'spot');
      (it.flex || [it.cluster]).forEach(cl => bump(clCount, cl));
    });
    const catCap = kind === 'food' ? 2 : kind === 'shop' ? 3 : 99;
    const clCap = state.region === 'all' ? (kind === 'food' ? 3 : 2) : 99;
    const brands = selectedBrands(); // 同品牌分店只推薦一家

    const picked = [];
    // 第一輪嚴格套用多樣性上限；若數量不足，第二輪放寬只看推薦度
    for (const relax of [false, true]) {
      for (const it of pool) {
        if (picked.length >= need) break;
        if (picked.indexOf(it) >= 0) continue;
        if (it.brand && brands.has(it.brand)) continue; // 已有同品牌分店就跳過
        const cat = it.cat || 'spot';
        const cls = it.flex || [it.cluster];
        if (!relax) {
          if ((catCount[cat] || 0) >= catCap) continue;
          if (cls.every(cl => (clCount[cl] || 0) >= clCap)) continue;
        }
        picked.push(it);
        if (it.brand) brands.add(it.brand);
        bump(catCount, cat);
        cls.forEach(cl => bump(clCount, cl));
      }
      if (picked.length >= need) break;
    }
    picked.forEach(it => state.sel.add(it.id));
    if (picked.length) { save(); renderGrid(); renderBar(); renderTools(); }
    return picked;
  }

  function clearAll() {
    if (!state.sel.size) { toast('目前沒有勾選任何項目'); return; }
    if (!confirm(`確定清除全部 ${state.sel.size} 個已勾選項目？\n（已存的行程草稿不會被刪除，隨時可以再套用回來）`)) return;
    state.sel.clear();
    state.pins = {};
    state.dayCl = null;
    save(); renderGrid(); renderBar(); renderTools();
    toast('已清除全部勾選');
  }

  let toastTimer = null;
  function toast(msg) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  /* ---------- 工具列（智慧推薦／全部清除／行程草稿） ---------- */
  function renderTools() {
    const vs = loadVers();
    const n = state.sel.size;
    $('#toolrow').innerHTML =
      `<button class="tool go" id="smartBtn">✨ 智慧推薦</button>` +
      `<button class="tool" id="clearBtn"${n ? '' : ' disabled'}>🧹 全部清除${n ? `（${n}）` : ''}</button>` +
      `<button class="tool ${state.draftOpen ? 'on' : ''}" id="draftBtn">📂 行程草稿（${vs.length}）</button>`;
    $('#smartBtn').addEventListener('click', () => {
      const picked = smartPick();
      if (!picked.length) { toast('此篩選條件下已經沒有可再推薦的項目了'); return; }
      const kindTxt = state.tab === 'spot' ? '景點' : state.tab === 'food' ? '美食' : '購物';
      const scope = state.region === 'all' ? '' : `「${CLUSTERS[state.region].label}」`;
      toast(`已依目前${scope}${kindTxt}篩選推薦勾選 ${picked.length} 項：${picked.map(p => p.name).slice(0, 3).join('、')}${picked.length > 3 ? '…' : ''}`);
    });
    $('#clearBtn').addEventListener('click', clearAll);
    $('#draftBtn').addEventListener('click', () => { state.draftOpen = !state.draftOpen; renderTools(); });
    renderDraftPanel();
  }

  function renderDraftPanel() {
    const el = $('#draftpanel');
    if (!state.draftOpen) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    const vs = loadVers();
    const cur = selKey();
    const rows = vs.slice().reverse().map(v => {
      const d = new Date(v.ts);
      const tm = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const ids = v.ids.split('.').filter(id => DB[id]);
      const n = { sp: 0, fo: 0, sh: 0 };
      ids.forEach(id => { const k = DB[id].kind; if (k === 'spot') n.sp++; else if (k === 'food') n.fo++; else n.sh++; });
      const names = ids.filter(id => DB[id].kind !== 'shop').slice(0, 4).map(id => DB[id].name).join('、');
      return `<div class="draft ${v.ids === cur ? 'on' : ''}">
        <div class="d-main">
          <b>${esc(v.name)}</b> <small>${tm}</small>
          ${v.ids === cur ? '<span class="badge ok">＝目前勾選</span>' : ''}
          <div class="d-sum">🗼 ${n.sp}・🍜 ${n.fo}・🛍️ ${n.sh}　${esc(names)}${ids.length > 4 ? ' …' : ''}</div>
        </div>
        <div class="d-act">
          <button class="mini go" data-apply="${v.id}">套用</button>
          <button class="mini" data-mix="${v.id}">加入目前</button>
          <button class="mini" data-ren="${v.id}">改名</button>
          <button class="mini del" data-del="${v.id}">刪除</button>
        </div>
      </div>`;
    }).join('');
    el.innerHTML = `<div class="draft-wrap">
      <div class="draft-head">
        <b>📂 行程草稿</b>
        <button class="mini" id="saveDraft">💾 將目前勾選存為草稿</button>
        <span class="d-hint">「套用」＝用草稿取代目前勾選；「加入目前」＝把草稿併進現有勾選。草稿存在這台裝置，保留最近 10 份。</span>
      </div>
      ${rows || '<div class="d-empty">還沒有草稿。按「✨ 產生專屬行程」會自動存一份，也可以直接按上面的「💾 將目前勾選存為草稿」。</div>'}
    </div>`;
  }

  function renderChips() {
    /* 搜尋中：各分頁顯示命中數，方便跨分頁查詢 */
    const hit = list => list.filter(i => matchQ(i, state.q)).length;
    const tabs = state.q
      ? [['spot', `🗼 景點（${hit(SPOTS)} 筆符合）`], ['food', `🍜 美食（${hit(FOODS)} 筆符合）`], ['shop', `🛍️ 購物（${hit(SHOPS)} 筆符合）`]]
      : [['spot', `🗼 景點（${SPOTS.length}）`], ['food', `🍜 美食（${FOODS.length}）`], ['shop', `🛍️ 購物（${SHOPS.length}）`]];
    $('#tabs').innerHTML = tabs.map(([k, t]) =>
      `<button class="tab ${state.tab === k ? 'on' : ''}" data-tab="${k}">${t}</button>`).join('');

    let sub = '';
    if (state.tab === 'food') {
      sub = `<button class="chip ${state.foodCat === 'all' ? 'on' : ''}" data-fc="all">全部</button>` +
        Object.entries(FOOD_CATS).map(([k, v]) =>
          `<button class="chip ${state.foodCat === k ? 'on' : ''}" data-fc="${k}">${v.icon} ${v.label}</button>`).join('');
    } else if (state.tab === 'shop') {
      sub = `<button class="chip ${state.shopCat === 'all' ? 'on' : ''}" data-sc="all">全部</button>` +
        Object.entries(SHOP_CATS).map(([k, v]) =>
          `<button class="chip ${state.shopCat === k ? 'on' : ''}" data-sc="${k}">${v.icon} ${v.label}</button>`).join('');
    }
    $('#subchips').innerHTML = sub;
    $('#subchips').style.display = sub ? '' : 'none';

    /* 門市篩選（僅購物分頁）：換行顯示，預設前 8 間＋「更多門市」展開全部 */
    let stc = '';
    if (state.tab === 'shop') {
      const cnt = {};
      SHOPS.forEach(i => { if (i.store && STORES[i.store]) cnt[i.store] = (cnt[i.store] || 0) + 1; });
      const keys = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
      const TOPN = 8;
      let shown = state.storeExpand ? keys : keys.slice(0, TOPN);
      if (!state.storeExpand && state.store !== 'all' && !shown.includes(state.store)) shown = [...shown, state.store];
      const shortName = k => STORES[k].name.replace(/（[^）]*）/g, '');
      const moreBtn = keys.length > TOPN
        ? `<button class="chip stc more" data-stmore="1">${state.storeExpand ? '▲ 收合門市' : `▼ 更多門市（${keys.length - shown.length}）`}</button>` : '';
      stc = `<span class="sortlab">門市</span><button class="chip stc ${state.store === 'all' ? 'on' : ''}" data-st="all">全部門市</button>` +
        shown.map(k => `<button class="chip stc ${state.store === k ? 'on' : ''}" data-st="${k}" title="${esc(STORES[k].name)}">🏬 ${esc(shortName(k))}（${cnt[k]}）</button>`).join('') + moreBtn;
    }
    $('#storechips').innerHTML = stc;
    $('#storechips').style.display = stc ? '' : 'none';

    $('#regionchips').innerHTML = `<button class="chip rg ${state.region === 'all' ? 'on' : ''}" data-rg="all">全部區域</button>` +
      Object.entries(CLUSTERS).map(([k, v]) =>
        `<button class="chip rg ${state.region === k ? 'on' : ''}" data-rg="${k}" style="--c:${v.color}">${v.label}</button>`).join('');

    const sorts = [['rec', '⭐ 推薦度'], ['price', '💰 價格低→高'], ['dist', '🏨 離飯店近→遠']];
    $('#sortrow').innerHTML = `<span class="sortlab">排序</span>` + sorts.map(([k, t]) =>
      `<button class="chip sort ${state.sort === k ? 'on' : ''}" data-sort="${k}">${t}</button>`).join('');

    updateFilterToggle();
  }

  /* 手機篩選抽屜鈕：顯示目前生效的篩選數（桌面由 CSS 隱藏此鈕） */
  function updateFilterToggle() {
    const btn = $('#filterToggle'); if (!btn) return;
    const open = $('.controls').classList.contains('fopen');
    let n = 0;
    if (state.tab === 'food' && state.foodCat !== 'all') n++;
    if (state.tab === 'shop' && state.shopCat !== 'all') n++;
    if (state.tab === 'shop' && state.store !== 'all') n++;
    if (state.region !== 'all') n++;
    if (state.sort !== 'rec') n++;
    btn.textContent = `🎛 篩選與排序${n ? `・${n} 項生效` : ''} ${open ? '▲ 收合' : '▼'}`;
    btn.setAttribute('aria-expanded', String(open));
  }

  function renderBar() {
    const c = counts();
    const okS = c.sp >= CONFIG.minSpots, okF = c.fo >= CONFIG.minFoods;
    $('#bar').innerHTML = `
      <div class="bar-counts">
        <span class="cnt ${okS ? 'ok' : ''}">🗼 景點 <b>${c.sp}</b>/${CONFIG.minSpots}</span>
        <span class="cnt ${okF ? 'ok' : ''}">🍜 餐飲 <b>${c.fo}</b>/${CONFIG.minFoods}</span>
        <span class="cnt opt">🛍️ 購物 <b>${c.sh}</b><i>（選填）</i></span>
      </div>
      <div class="bar-actions">
        <label class="af"><input type="checkbox" id="afToggle" ${state.autoFill ? 'checked' : ''}> 空檔自動推薦</label>
        <button id="genBtn" class="gen" ${ready() ? '' : 'disabled'}>${ready() ? '✨ 產生專屬行程' : '再選一些吧！'}</button>
      </div>`;
    $('#genBtn').addEventListener('click', () => { if (ready()) showResult(); });
    $('#afToggle').addEventListener('change', e => { state.autoFill = e.target.checked; save(); });
  }

  /* ============================================================
     畫面渲染 — 結果頁（時間軸）
     ============================================================ */
  function entryHtml(time, label, inner, cls) {
    return `<div class="entry ${cls || ''}"><div class="t"><span class="clock">${time}</span><span class="slotlab">${label}</span></div><div class="e-body">${inner}</div></div>`;
  }

  function rowHtml(r, day) {
    // day._idx 由 renderResult 指派
    if (r.k === 'fixed') {
      const lk = r.links ? ` <a href="${gmap(r.links.g)}" target="_blank" rel="noopener">📍地圖</a>` +
        (r.links.o ? ` <a href="${esc(r.links.o)}" target="_blank" rel="noopener">🌐官網</a>` : '') : '';
      return entryHtml(r.t, '固定', `<div class="e-name">${r.text}</div>${r.sub ? `<div class="e-meta sub">${esc(r.sub)}${lk}</div>` : ''}`, 'fixed');
    }
    if (r.k === 'trans') {
      return `<div class="entry trans"><div class="t"><span class="clock sm">${fmtT(r.dep)}</span><span class="slotlab">出發</span></div>
        <div class="e-body"><div class="trans-body">${esc(r.tr.desc)}<b>　→ ${fmtT(r.arr)} 抵達</b></div></div></div>`;
    }
    if (r.k === 'free') {
      const fill = r.mins >= 80 ? gapSuggest(day, r) : [];
      const btns = fill.length
        ? `<div class="gap-fill no-print"><span class="gf-lab">要不要順便安排：</span>${fill.map(f =>
            `<button class="ed go" data-add="${f.it.id}|${day._idx}" title="${esc(f.it.area || '')}｜停留約${durTxt(f.it.stay || 60)}">✚ ${esc(f.it.name.slice(0, 12))}<em>${f.km < 1 ? '走路可到' : f.km.toFixed(1) + 'km'}</em></button>`).join('')}</div>`
        : '';
      return `<div class="entry free"><div class="t"><span class="clock sm">${fmtT(r.t)}</span><span class="slotlab">空檔</span></div>
        <div class="e-body"><div class="free-body">🌿 自由時間約${durTxt(r.mins)}——可回飯店休息、周邊隨逛，或提早出發慢慢走</div>${btns}</div></div>`;
    }
    if (r.k === 'hotel') {
      const cf = r.curfew;
      const cfNote = (!r.pickup && cf) ? `<div class="e-meta sub">${r.t <= cf ? `✅ ${fmtT(cf)} 前到家（${cf === (CONFIG.curfew || {}).far ? '遠程日放寬標準' : '一般日標準'}）` : `⚠️ 比預定的 ${fmtT(cf)} 晚了 ${durTxt(r.t - cf)}${r.soft ? '——為了保留重點行程與晚餐，沒有再刪東西' : ''}`}</div>` : '';
      return entryHtml(fmtT(r.t), '返回', `<div class="e-name">${r.pickup ? '🏨 回飯店領行李，整理後前往機場' : '🏨 回到樂天飯店，今日行程結束'}</div>${cfNote}`, 'fixed hotelend');
    }
    if (r.k === 'store') {
      const g = r.g;
      const lateWarn = r.end > (g.store.close || 1440)
        ? '<div class="store-note">⚠️ 此時段可能接近打烊，請以現場營業時間為準；來不及可改列自由採買。</div>' : '';
      const earlyWarn = g.store.open != null && r.t < g.store.open
        ? `<div class="store-note">⚠️ 該店 ${fmtT(g.store.open)} 才開門，請留意抵達時間或往後挪。</div>` : '';
      return entryHtml(fmtT(r.t), '順路採購', `
        <div class="e-name">🛍️ ${esc(g.store.name)} ${g.pinnedStore ? '<span class="badge pin">📌 手動指定</span>' : ''}<span class="stay">⏳ 停留約${durTxt(r.stay)}</span></div>${earlyWarn}
        <div class="store-items">${g.items.map(it => `<span>☐ ${esc(it.name)}</span>`).join('')}</div>
        ${g.store.note ? `<div class="store-note">💡 ${esc(g.store.note)}</div>` : ''}${lateWarn}
        ${linkRow(g.store.links, g.store.links && g.store.links.g)}
        ${storeBar(g, day, r.si)}`, 'storestop');
    }
    if (r.k === 'd5shop') {
      if (!r.stores) {
        return entryHtml(fmtT(r.t), SLOT_LABELS.d5shop, `
          <div class="e-name">🛍️ 西面最後採購：Olive Young 旗艦店＋樂天百貨／樂天超市 <span class="stay">⏳ 約${durTxt(r.stay)}</span></div>
          <div class="e-desc">美妝、伴手禮最後掃貨並辦理退稅（同店單筆滿 15,000₩ 即可退，多數專櫃可直接現場免稅價結帳；樂天百貨 1 樓有自動退稅機），採買完回飯店打包行李</div>
          ${linkRow({ g: '올리브영 부산 서면점', n: '롯데백화점 부산본점' }, '올리브영 부산 서면점')}`, 'storestop');
      }
      const inner = r.stores.map(g => `
        <div class="store-b"><b>🛍️ ${esc(g.store.name)}</b>
          <div class="store-items">${g.items.map(it => `<span>☐ ${esc(it.name)}</span>`).join('')}</div>
          ${g.store.note ? `<div class="store-note">💡 ${esc(g.store.note)}</div>` : ''}
          ${linkRow(g.store.links, g.store.links && g.store.links.g)}
          <div class="e-edit no-print"><span class="ed-lab">這間店</span><select class="ed-sel" data-stday="${g.storeId}">
            <option value="4" selected>留在 Day 5 最終採購</option>
            ${[0, 1, 2, 3].map(i => `<option value="${i}">提前到 Day ${i + 1} 買</option>`).join('')}
          </select></div></div>`).join('');
      return entryHtml(fmtT(r.t), SLOT_LABELS.d5shop, `
        <div class="e-name">🛒 西面最終採購（${r.stores.reduce((s, g) => s + g.items.length, 0)} 項）<span class="stay">⏳ 合計約${durTxt(r.stay)}</span></div>
        ${inner}
        <div class="store-note">💳 記得帶護照辦退稅；買完回飯店領行李。${r.warn ? '<b>⚠️ 品項較多、離場前時間較緊，建議部分改到 Day 1 傍晚先買（用各店的下拉選單即可）。</b>' : ''}</div>
        <div class="e-edit no-print"><span class="ed-lab">調整</span>${moveBtns(day, r.si)}</div>`, 'storestop');
    }
    /* item */
    const cell = r.cell;
    const label = SLOT_LABELS[r.slotKey] || '';
    if (cell.anchor) {
      const a = cell.anchor;
      return entryHtml(fmtT(r.t), label, `
        <div class="e-name">${a.shopping ? '🛍️' : '🚶'} ${esc(a.name)} <span class="badge free">${a.shopping ? '採購時間' : '免費散步'}</span> <span class="stay">⏳ 約${durTxt(r.stay)}</span></div>
        <div class="e-desc">${esc(a.desc)}</div>${linkRow(a.links, a.links && a.links.g)}
        <div class="e-edit no-print"><span class="ed-lab">調整</span>${moveBtns(day, r.si)}</div>`);
    }
    const it = cell.item;
    const ci = catInfo(it);
    return entryHtml(fmtT(r.t), label, `
      <div class="e-name">${ci.icon} ${esc(it.name)}
        ${cell.pinned ? '<span class="badge pin">📌 手動指定</span>' : ''}
        ${cell.suggest ? '<span class="badge sug">推薦補位・未勾選</span>' : ''}
        ${it.tag ? `<span class="badge tag">${esc(it.tag)}</span>` : ''}
        <span class="stay">⏳ 停留約${durTxt(r.stay)}</span></div>
      <div class="e-meta">📌 ${esc(it.area || '')} ｜ 💰 ${esc(it.price || '')}</div>
      ${it.wait ? `<div class="e-meta sub">⏱ ${esc(it.wait)}</div>` : ''}
      ${siblings(it).length ? `<div class="e-meta sub">🏪 走不到也沒關係：${siblings(it).map(s => esc(s.area)).join('、')}也有分店</div>` : ''}
      ${it.close != null && r.end > it.close ? `<div class="e-meta warnline">⚠️ 這家約 ${fmtT(it.close)} 打烊，此時段可能來不及——建議提前或改選同品牌其他分店</div>` : ''}
      <div class="e-desc">${esc(it.desc)}</div>${linkRow(it.links, imgQ(it))}
      ${editBar(it, day, r.slotKey, cell, r.si)}`);
  }

  /* 本日內前後移（▲▼）：換完只重算時間，順序完全照使用者的 */
  function moveBtns(day, si) {
    if (!day || si == null) return '';
    const di = day._idx, n = (day.seq || []).length;
    return `<button class="ed" data-ro="${di}|${si}|-1"${si <= 0 ? ' disabled' : ''} title="和本日上一站對調">▲ 提早</button>
      <button class="ed" data-ro="${di}|${si}|1"${si >= n - 1 ? ' disabled' : ''} title="和本日下一站對調">▼ 延後</button>`;
  }

  /* 手動調整列：本日排序／搬到別天／改時段／移除，改完會自動重排整份行程 */
  function editBar(it, day, slotKey, cell, si) {
    if (!day || cell.suggest) return '';
    const di = day._idx;
    const opts = (day.slotKeys || []).filter(k => k !== 'd5shop').map(k =>
      `<option value="${k}"${k === slotKey ? ' selected' : ''}>${SLOT_LABELS[k] || k}</option>`).join('');
    return `<div class="e-edit no-print">
      <span class="ed-lab">調整</span>
      ${moveBtns(day, si)}
      <button class="ed" data-mv="${it.id}|${di - 1}"${di <= 0 ? ' disabled' : ''} title="移到前一天">◀ ${di > 0 ? 'Day' + di : '前一天'}</button>
      <button class="ed" data-mv="${it.id}|${di + 1}"${di >= 4 ? ' disabled' : ''} title="移到後一天">${di < 4 ? 'Day' + (di + 2) : '後一天'} ▶</button>
      <select class="ed-sel" data-slot="${it.id}|${di}">${opts}</select>
      <button class="ed del" data-drop="${it.id}" title="從行程移除">✕ 移除</button>
    </div>`;
  }

  /* 採購站的調整列：本日排序＋搬到別天＋改回自動（比照景點美食的操作習慣） */
  function storeBar(g, day, si) {
    if (!day || g.storeId === 'cvs') return '';
    const di = day._idx;
    const pinned = state.stPins[g.storeId];
    return `<div class="e-edit no-print">
      <span class="ed-lab">調整</span>
      ${moveBtns(day, si)}
      <button class="ed" data-stmv="${g.storeId}|${di - 1}"${di <= 0 ? ' disabled' : ''} title="這站採購移到前一天">◀ ${di > 0 ? 'Day' + di : '前一天'}</button>
      <button class="ed" data-stmv="${g.storeId}|${di + 1}"${di >= 4 ? ' disabled' : ''} title="這站採購移到後一天">${di < 4 ? 'Day' + (di + 2) : '後一天'} ▶</button>
      ${pinned ? `<button class="ed" data-stauto="${g.storeId}" title="取消手動指定，交回系統自動安排">↩ 自動</button>` : ''}
    </div>`;
  }

  /* ---- 空檔建議 ----
     空檔夠長時，從沒勾選的項目裡挑「離當天路線最近、時段合適、塞得進去」的幾個。 */
  function gapSuggest(day, freeRow) {
    if (!day || day.key === 'd5') return [];
    const pts = dayPoints(day);
    if (!pts.length) return [];
    const used = new Set();
    ALL.forEach(it => { if (state.sel.has(it.id)) used.add(it.brand || it.id); });
    const budget = freeRow.mins - 20;               // 留 20 分鐘給來回交通
    const at = freeRow.t;
    const cand = [...SPOTS, ...FOODS].filter(it => {
      if (state.sel.has(it.id) || used.has(it.brand || '###')) return false;
      if (!openOnDay(it, day)) return false;
      if (it.open != null && at < it.open) return false;
      if (it.close != null && at + (it.stay || 60) > it.close - 15) return false;
      if (isRealMeal(it)) return false;             // 空檔用來塞正餐容易撞用餐間隔
      if ((it.stay || 60) > budget) return false;
      return nearestKm(pts, it) <= 3.5;             // 太遠就不算「順便」
    }).map(it => ({ it, km: nearestKm(pts, it) }))
      .sort((a, b) => ((b.it.rec || 0) - 5 * b.km) - ((a.it.rec || 0) - 5 * a.km));
    return cand.slice(0, 3);
  }

  /* ---- 當日路線圖 ----
     用真實經緯度等距投影，一眼看出當天在地圖上怎麼跑、每段多遠。
     線條顏色＝交通方式，動畫讓路線依序畫出來（也標出回飯店的路徑）。 */
  function routeMapHtml(day) {
    if (!day.tl || !day.seq || !day.seq.length) return '';
    const stops = [], legs = [];
    day.tl.forEach(r => {
      if (r.k === 'trans') legs.push(r);
      else if (r.k === 'item' || r.k === 'store' || r.k === 'd5shop') {
        let p, nm;
        if (r.k === 'store') { p = r.g.store; nm = r.g.store.name; }
        else if (r.k === 'd5shop') { p = STORES.oy_seomyeon; nm = '西面最終採購'; }
        else if (r.cell.anchor) {
          const am = ANCHOR_META[day.cluster] || ANCHOR_META.seomyeon;
          p = am; nm = r.cell.anchor.name;
        } else { p = r.cell.item; nm = r.cell.item.name; }
        if (p && p.lat != null) stops.push({ lat: p.lat, lng: p.lng, name: nm, t: r.t });
      }
    });
    if (stops.length < 1) return '';

    const pts = [HOTEL].concat(stops);
    if (day.tl.some(r => r.k === 'hotel')) pts.push(HOTEL);
    const lat0 = 35.16, kx = Math.cos(lat0 * Math.PI / 180);
    const xs = pts.map(p => p.lng * kx), ys = pts.map(p => p.lat);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1e-5), spanY = Math.max(maxY - minY, 1e-5);
    // 畫布長寬比跟著實際路線走（釜山東西向常比南北向長很多），但不要太扁
    const W = 100, PAD = 12;
    const H = Math.min(120, Math.max(46, Math.round(W * spanY / spanX)));
    const scale = Math.min((W - PAD * 2) / spanX, (H - PAD * 2) / spanY);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const px = p => W / 2 + (p.lng * kx - cx) * scale;
    const py = p => H / 2 + (cy - p.lat) * scale;

    const MODE = { walk: '#1f9d63', metro: '#1f5fbf', taxi: '#e8833a' };
    let path = '', dots = '', labels = '', total = 0;
    const legLabels = [];
    pts.forEach((p, i) => {
      if (i === 0) return;
      const a = pts[i - 1], leg = legs[i - 1];
      const col = leg ? (MODE[leg.tr.mode] || '#8794a8') : '#c9d2e0';
      const dash = leg && leg.tr.mode === 'walk' ? '2 2' : '';
      const x1 = px(a).toFixed(1), y1 = py(a).toFixed(1), x2 = px(p).toFixed(1), y2 = py(p).toFixed(1);
      total += leg ? (leg.tr.km || 0) : 0;
      path += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="1.6"
        stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''} class="rt-line" style="animation-delay:${i * .18}s"/>`;
      if (leg) legLabels.push({ km: leg.tr.km || 0, x: (+x1 + +x2) / 2, y: (+y1 + +y2) / 2 });
    });
    // 只標最長的幾段，且互相太近就跳過——小圖上文字疊在一起完全看不懂
    const lblPos = [];
    legLabels.sort((a, b) => b.km - a.km).forEach(L => {
      if (L.km < 1 || lblPos.length >= 3) return;
      if (lblPos.some(q => Math.hypot(q.x - L.x, q.y - L.y) < 13)) return;
      lblPos.push(L);
      labels += `<text x="${L.x.toFixed(1)}" y="${(L.y - 1.8).toFixed(1)}" class="rt-km">${L.km < 10 ? L.km.toFixed(1) : Math.round(L.km)}km</text>`;
    });

    const placed = [];
    stops.forEach((p, i) => {
      let x = px(p), y = py(p);
      // 兩點實際位置太近時稍微錯開，否則編號會疊在一起看不出來
      for (let g = 0; g < 12; g++) {
        const hit = placed.find(q => Math.hypot(q.x - x, q.y - y) < 7);
        if (!hit) break;
        const ang = g * 1.05;
        x = px(p) + Math.cos(ang) * 7; y = py(p) + Math.sin(ang) * 7;
      }
      placed.push({ x, y });
      dots += `<g class="rt-dot" style="animation-delay:${(i + 1) * .18}s">
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" fill="#fff" stroke="var(--c, #1f5fbf)" stroke-width="1.6"/>
        <text x="${x.toFixed(1)}" y="${(y + 1.5).toFixed(1)}" class="rt-no">${i + 1}</text></g>`;
    });
    const hx = px(HOTEL).toFixed(1), hy = py(HOTEL).toFixed(1);
    dots += `<g class="rt-dot"><circle cx="${hx}" cy="${hy}" r="4.4" fill="#1d2733"/>
      <text x="${hx}" y="${(+hy + 1.7).toFixed(1)}" class="rt-no" fill="#fff">🏨</text></g>`;

    // 比例路線條：段落長度＝實際距離，顏色＝交通方式
    const MODE_TXT = { walk: '步行', metro: '地鐵', taxi: '計程車' };
    let strip = '<span class="rt-node hotel" title="樂天飯店">🏨</span>';
    stops.forEach((p, i) => {
      const leg = legs[i];
      strip += leg
        ? `<span class="rt-seg" style="--w:${(leg.tr.km || 0).toFixed(1)};--col:${MODE[leg.tr.mode] || '#8794a8'}"
             title="${MODE_TXT[leg.tr.mode] || ''} ${leg.tr.mins}分"><i>${(leg.tr.km || 0) < 10 ? (leg.tr.km || 0).toFixed(1) : Math.round(leg.tr.km)}km</i></span>`
        : '<span class="rt-seg" style="--w:0.5;--col:#c9d2e0"></span>';
      strip += `<span class="rt-node" style="animation-delay:${i * .12}s"><b>${i + 1}</b>${esc(p.name.slice(0, 11))}<em>${fmtT(p.t)}</em></span>`;
    });
    const back = legs[stops.length];
    if (back) strip += `<span class="rt-seg" style="--w:${(back.tr.km || 0).toFixed(1)};--col:${MODE[back.tr.mode] || '#8794a8'}"
      title="回飯店"><i>${(back.tr.km || 0) < 10 ? (back.tr.km || 0).toFixed(1) : Math.round(back.tr.km)}km</i></span><span class="rt-node hotel">🏨</span>`;

    return `<div class="routemap">
      <div class="rt-head">
        <span class="rt-title">🗺️ 今日路線 · 共 ${total.toFixed(1)} 公里 · ${durTxt(day.transMins || 0)}</span>
        <span class="rt-legend"><b style="color:${MODE.walk}">━步行</b><b style="color:${MODE.metro}">━地鐵</b><b style="color:${MODE.taxi}">━計程車</b></span>
      </div>
      <div class="rt-body">
        <svg viewBox="0 0 ${W} ${H}" class="rt-svg" style="aspect-ratio:${W}/${H}" role="img" aria-label="當日路線地理示意圖">${path}${labels}${dots}</svg>
        <div class="rt-strip">${strip}</div>
      </div>
    </div>`;
  }

  function versionBarHtml() {
    const vs = loadVers();
    if (!vs.length) return '';
    const cur = selKey();
    const pills = vs.slice().reverse().map(v => {
      const d = new Date(v.ts);
      const tm = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const n = v.ids.split('.').length;
      return `<span class="ver ${v.ids === cur ? 'on' : ''}" data-v="${v.id}">${esc(v.name)}<small>${tm}・${n}項</small><i class="vr" data-vr="${v.id}" title="重新命名">✎</i><i class="vx" data-vx="${v.id}" title="刪除">✕</i></span>`;
    }).join('');
    return `<div class="ver-wrap no-print"><b>🗂 行程版本：</b>${pills}
      <span class="ver-hint">每次產生行程自動存一版（此裝置保留最近 10 版）；點版本即切換採用，行程與試算表同步都會用該版本。</span></div>`;
  }

  let lastPlan = null;         // 最近一次產生的行程（▲▼ 排序要讀當天的實際停靠序列）
  let fullDayInfo = [];        // 整天對調用：[{ idx:第幾天, cluster:生活圈 }]
  function renderResult(plan) {
    const t = CONFIG.trip;
    const c = counts();
    fullDayInfo = plan.days.map((d, i) => ({ idx: i, cluster: d.cluster })).filter((_, i) => plan.days[i].full);
    const dayHtml = plan.days.map((d, i) => {
      const cl = CLUSTERS[d.cluster];
      d._idx = i;
      const rows = d.tl.map(r => rowHtml(r, d)).join('');
      const backup = d.backup.length ? `
        <div class="backup"><b>⏸ 同區備選${d.overflow ? `（為了在 ${fmtT(d.curfew || 1290)} 前回到飯店，以下排不進去——想去的話建議換掉上面某一站，或移到別天）` : '（時間排不下，可自行替換）'}</b>${d.backup.map(it => {
          const ci = catInfo(it);
          const fit = (it._fit || []).slice(0, 3);
          const btns = fit.length
            ? fit.map((f, k) => `<button class="ed ${k === 0 ? 'go' : ''}" data-mv="${it.id}|${f.i}"
                title="${f.fits ? '這天還有空檔，排得下' : '這天已經排滿，加進去會把當天某一項換到備選'}">✚ Day${f.i + 1}${
                  k === 0 ? (f.fits ? '（順路建議）' : '（建議・會換掉一項）') : (f.fits ? '' : '⚠️')}</button>`).join('')
            : '<span class="bk-none">這幾天店家都公休，排不進去</span>';
          return `<div class="bk-item"><div class="bk-main">${ci.icon} ${esc(it.name)}｜💰 ${esc(it.price || '')} ${linkRow(it.links, imgQ(it))}</div>
            <div class="bk-act no-print">${btns}</div></div>`;
        }).join('')}</div>` : '';
      const dayTips = {
        d1: '🌕 ' + CONFIG.holidayNote,
        d2: '🌕 9/27（日）為中秋連假隔天的週日，' + (CLUSTERS[d.cluster] || {}).short + '一帶人潮較多，熱門景點與餐廳請務必提前預約／提早抽號。'
      };
      const mc = d.modeCnt || { taxi: 0, metro: 0, walk: 0 };
      const modeBits = [];
      if (mc.taxi) modeBits.push(`計程車${mc.taxi}段`);
      if (mc.metro) modeBits.push(`地鐵${mc.metro}段`);
      if (mc.walk) modeBits.push(`步行${mc.walk}段`);
      const heavy = (d.transMins || 0) >= 150;
      const transTip = d.seq && d.seq.length ? `<div class="tip${heavy ? ' holiday' : ''}">🧭 本日交通：${modeBits.join('＋') || '皆在步行圈'}｜<b>總移動約${durTxt(d.transMins || 0)}、${(d.transKm || 0).toFixed(1)}公里</b>｜交通費預估 ${money(d.transCost || 0)}（2人合計）${heavy && d.hog ? `——<b>其中「${esc(d.hog.name)}」最花時間</b>：把它移到別天（用下方項目的「調整」列）可省下約 ${durTxt(d.hog.save)} 車程、少繞 ${d.hog.km.toFixed(1)} 公里` : heavy ? '——移動偏多，可考慮把最遠的一站換成同區其他選擇' : ''}。${d.curfew ? `本日目標 ${fmtT(d.curfew)} 前回到飯店${d.farDay ? '（有遠程景點，已放寬）' : ''}。` : ''}時間為保守估算（含候車與緩衝）。</div>` : '';
      const squeezeTip = d.squeeze ? `<div class="tip holiday">⚠️ 離場前時間較緊：建議把部分採買或用餐提前，或改到機場解決。</div>` : '';
      const pinClosedTip = (d.pinnedClosed && d.pinnedClosed.length) ? `<div class="tip holiday">📌 你手動把 ${d.pinnedClosed.map(x => esc(x.name)).join('、')} 排在這天，但它<b>週${DOW_TXT[d.dow]}公休</b>——行程照你的安排保留，出發前請再確認。</div>` : '';
      const closedTip = (d.closedShops && d.closedShops.length) ? `<div class="tip holiday">🚫 ${d.closedShops.map(g => esc(g.store.name)).join('、')}<b>本日（週${DOW_TXT[d.dow]}）公休</b>——${d.closedShops.map(g => g.items.map(i => esc(i.name)).join('、')).join('；')} 買不到。${d.full ? '可用右上角「🔄 換天」把這天和別天整個對調，避開公休日；' : ''}或另外找地方買，出發前先確認營業狀況。</div>` : '';
      const mealTip = (d.noLunch || d.noDinner) ? `<div class="tip holiday">🍽️ 這天${d.noLunch && d.noDinner ? '中午與晚上都' : d.noLunch ? '中午' : '晚上'}沒有安排用餐——${d.noLunch && !d.noDinner ? '上午的行程較滿，記得在景點附近先墊個東西' : '建議從下面的同區備選挑一家，或在附近隨機找一家'}。</div>` : '';
      const lunchTip = d.lunchDropped ? `<div class="tip">🍜 登機前時間有限，午餐建議外帶輕食或在機場用餐（金海機場餐飲選擇不少）。</div>` : '';
      return `
      <section class="day" style="--c:${cl.color}">
        <header class="day-head">
          <div class="day-no">Day ${i + 1}</div>
          <div><h2>${d.date}｜${esc(d.theme)}</h2><div class="day-cl">${esc(cl.label)}</div></div>
          ${d.full ? `<div class="day-swap"><span>🔄 換天</span>${fullDayInfo.filter(f => f.idx !== i)
            .map(f => `<button data-swap="${i}|${f.idx}" title="把這天的行程和 Day ${f.idx + 1} 整個對調">↔ Day ${f.idx + 1}<small>${esc(CLUSTERS[f.cluster].short)}</small></button>`).join('')}</div>` : ''}
        </header>
        ${dayTips[d.key] ? `<div class="tip holiday">${esc(dayTips[d.key])}</div>` : ''}
        <div class="tip">🚇 ${esc(TRANSIT[d.cluster])}</div>
        ${transTip}${squeezeTip}${pinClosedTip}${closedTip}${mealTip}${lunchTip}
        ${routeMapHtml(d)}
        <div class="timeline">${rows}</div>
        ${backup}
      </section>`;
    }).join('');

    /* 勾選總覽（給旅伴一起確認用） */
    const placedIds = new Set();
    plan.days.forEach(d => d.slotKeys.forEach(k => {
      const cell = d.slots[k];
      if (cell && cell.item && !cell.suggest) placedIds.add(cell.item.id);
    }));
    const overview = plan.sel.filter(i => i.kind !== 'shop').map(it => {
      const inPlan = placedIds.has(it.id);
      return `<span class="ov ${inPlan ? 'in' : 'out'}">${inPlan ? '✅' : '⏸'} ${esc(it.name)}</span>`;
    }).join('');

    /* 採購清單（依門市分組） */
    let shopHtml = '';
    const groups = Object.keys(plan.shopGroups);
    if (groups.length) {
      shopHtml = `<section class="shoplist"><h2>🛍️ 採購清單（${plan.shops.length} 項）</h2>
        <p class="hint">💡 已依「實際門市」分組並排進每日行程。<b>退稅：</b>門檻已降到同店單筆滿 15,000₩，樂天／新世界百貨多數專櫃出示護照可直接用「現場免稅價」結帳（大同、READY YOUNG 等事後免稅藥局也支援）；拿到退稅單也不必等機場排隊——樂天百貨 1 樓有自動退稅機，刷護照與退稅單當場吐韓元現金。注意：現場即時退稅單筆限 100 萬₩、全程累計 500 萬₩；單筆退稅額超過 7.5 萬₩（約單筆消費 100 萬₩，例如精品包）須帶未拆封商品先到機場海關查驗蓋章、之後才能託運。</p>
        ${groups.map(g => {
          const grp = plan.shopGroups[g];
          const pin = grp.storeId ? state.stPins[grp.storeId] : null;
          const dayPick = (grp.storeId && grp.storeId !== 'cvs')
            ? `<div class="e-edit no-print"><span class="ed-lab">這間店安排到</span><select class="ed-sel" data-stday="${grp.storeId}">
                 <option value=""${!pin ? ' selected' : ''}>系統自動安排</option>
                 ${[0, 1, 2, 3, 4].map(i => `<option value="${i}"${pin && pin.d === i ? ' selected' : ''}>📌 Day ${i + 1}${i === 4 ? '（返程上午）' : ''}</option>`).join('')}
               </select></div>`
            : '';
          return `<div class="shop-group"><h3>📍 ${esc(g)}</h3>${dayPick}${grp.items.map(it => {
            const ci = catInfo(it);
            const safeTxt = it.safe === 'warn' ? '<span class="badge warn">⚠️ 成分含肉禁帶</span>' :
              it.safe === 'ok-check' ? '<span class="badge note">須託運</span>' : '';
            return `<div class="shop-item"><div><b>${ci.icon} ${esc(it.name)}</b> ${safeTxt}<div class="e-meta sub">🏬 ${esc(it.buy)}｜💰 ${esc(it.price)}</div></div>${linkRow(it.links, imgQ(it))}</div>`;
          }).join('')}</div>`;
        }).join('')}
        <div class="tip customs">🛃 <b>台灣海關提醒：</b>所有肉類製品（肉乾、火腿腸、含肉塊泡麵）嚴禁入境，首次查獲罰 NT$20 萬；泡菜、芝麻油、果醬等液體/發酵品必須託運；純海鮮加工品（魚糕、海苔）可安心帶。<b>藥局藥妝：</b>痘痘藥、去疤膏、貼布等西藥「每種最多 12 件、合計 36 件」（錠狀保健品同 12/36），僅限自用——任何形式轉售或代購都違反藥事法（最高罰 NT$200 萬）。不確定就走紅線主動申報，申報不罰。</div>
      </section>`;
    }

    const est = plan.cost;
    $('#result-inner').innerHTML = `
      <header class="r-head">
        <button class="back no-print" id="backBtn">← 回到勾選頁調整</button>
        ${state.fromShare ? '<div class="share-note no-print">🔗 這是分享連結的行程檢視，點左邊按鈕可調整重排</div>' : ''}
        <h1>🌊 我們的釜山行程出爐啦！</h1>
        <p class="r-sub">${t.dates}｜🏨 ${t.hotel.name}｜🗼 景點 ${c.sp} ・ 🍜 餐飲 ${c.fo} ・ 🛍️ 購物 ${c.sh}</p>
        <div class="summary-cards">
          <div class="sc"><div class="sc-t">✈️ 去程</div><div>${t.outbound.date}</div><div>${t.outbound.dep}</div><div>${t.outbound.arr}</div></div>
          <div class="sc"><div class="sc-t">🏨 住宿</div><div>${t.hotel.name}</div><div>${esc(t.hotel.area)}</div>
            <div><a href="${gmap(t.hotel.links.g)}" target="_blank" rel="noopener">📍 Google地圖</a>　<a href="${esc(t.hotel.links.o)}" target="_blank" rel="noopener">🌐 官網</a></div></div>
          <div class="sc"><div class="sc-t">✈️ 回程</div><div>${t.inbound.date}</div><div>${t.inbound.dep}</div><div>${t.inbound.arr}</div></div>
          <div class="sc cost"><div class="sc-t">💰 預估花費（每人）</div><div class="big">${money(est)}</div><div>餐飲＋門票，不含機酒/交通/購物</div>
            <div class="sub">🚕 市區交通預估 ${money(plan.transTotal)}（2人合計）</div>
            ${plan.shopCost ? `<div class="sub">🛍️ 購物清單全買約 ${money(plan.shopCost)}</div>` : ''}</div>
        </div>
        <div class="ov-wrap"><b>勾選總覽：</b>${overview}</div>
        <div class="ov-wrap edit-hint no-print">✏️ <b>可以手動微調：</b>整天想換日子的話，用 Day 2～4 標題右邊的 <b>🔄 換天</b>——例如按 Day 2 的「↔ Day 3」，兩天的行程就整個對調（同一天的項目一起搬，公休日與交通會重算）。每個停靠點（景點、美食、<b>採購站也一樣</b>）下方都有「調整」列——<b>▲ ▼</b> 直接改當天的先後順序（改完出發抵達時間全部重新試算）、<b>◀ ▶</b> 搬到別天、<b>時段選單</b>改成當天其他時段、<b>✕ 移除</b>拿掉不想去的；Day 5 最終採購裡的每間店還能用下拉選單提前到別天買。改完系統會立刻重排整份行程（交通、用餐時間、回飯店時間都會重新計算），手動指定的會標上 📌 並優先保留、手動排的順序不會被系統推翻。</div>
        ${versionBarHtml()}
        <div class="r-actions no-print">
          <button id="copyText">📋 複製文字版行程</button>
          <button id="copyLink">🔗 複製行程連結分享</button>
          <button id="sheetBtn" class="gsbtn">📊 Google 試算表</button>
          <button id="printBtn">🖨️ 列印／存 PDF</button>
          ${(Object.keys(state.pins).length || Object.keys(state.stPins).length || Object.keys(state.ord).length || state.dayCl) ? `<button id="resetPins" class="rst">↩️ 還原自動安排（${[
            (Object.keys(state.pins).length + Object.keys(state.stPins).length) ? '已調整 ' + (Object.keys(state.pins).length + Object.keys(state.stPins).length) + ' 項' : '',
            Object.keys(state.ord).length ? '已改 ' + Object.keys(state.ord).length + ' 天順序' : '',
            state.dayCl ? '已換過天' : ''].filter(Boolean).join('、')}）</button>` : ''}
        </div>
      </header>
      ${dayHtml}
      ${shopHtml}
      <footer class="r-foot">
        <div class="tip">📞 <b>用電話找店最準：</b>餐飲項目的綠色電話鈕點一下就複製，貼進 <b>NAVER 地圖</b>搜尋框——韓國店名常有多家分店同名，用電話一貼就只跳出正確的那一家（實測 82 家逐支反查過）。少數店家沒在 NAVER 登記電話（Hash Table、HELMET、THE BARN BERLIN、豚笑廣安店、BIFF 昇基堅果黑糖餅、樂天光復店的尚國家、Blue Bottle）就只放地圖連結，不放查不到的號碼。</div>
        <div class="tip">📱 <b>排隊神器：</b>標「App直達」的 CatchTable 鈕會直接開到<b>那間店的頁面</b>——手機裝了 <b>CatchTable Global</b>（外國人版，Google/Apple 帳號即可註冊、免韓國門號）點連結就自動跳進 App，線上訂位或遠端抽號一氣呵成；沒裝 App 則開繁中網頁版，一樣能操作。現場機台可輸入 Email 登記並拍下 QR Code 留存。</div>
        <div class="tip">💡 ${esc(CONFIG.rateNote)}</div>
        <div class="tip buildtip">🔄 版本 ${esc(CONFIG.build || '-')}｜手機若看不到新功能（例如每個項目下方的「調整」列），代表載到快取的舊版：下拉重新整理，或關掉分頁重開即可。</div>
        <div class="tip">🎫 天空膠囊列車、遊艇、X the SKY 建議出發前 2 週完成線上預約；Spa Land 可先在 Klook/NOL 買優惠票。</div>
      </footer>
      ${sheetModalHtml()}`;

    $('#backBtn').addEventListener('click', () => { state.fromShare = false; showPick(); });

    $('#copyText').addEventListener('click', () => copyToClipboard(planText(plan), '#copyText', '📋 已複製！貼到 LINE 給旅伴看吧'));
    $('#copyLink').addEventListener('click', () => copyToClipboard(shareUrl(), '#copyLink', '🔗 連結已複製！'));
    $('#printBtn').addEventListener('click', () => window.print());
    $('#sheetBtn').addEventListener('click', () => { $('#gsMask').style.display = ''; });
    bindSheetModal(plan);
    bindVersionBar();
  }

  function bindVersionBar() {
    const wrap = $('.ver-wrap');
    if (!wrap) return;
    wrap.addEventListener('click', e => {
      const vx = e.target.closest('[data-vx]');
      const vr = e.target.closest('[data-vr]');
      const pill = e.target.closest('[data-v]');
      let vs = loadVers();
      if (vx) {
        const v = vs.find(x => x.id === vx.dataset.vx);
        if (v && confirm(`刪除「${v.name}」？`)) { saveVers(vs.filter(x => x.id !== v.id)); showResult(); }
        return;
      }
      if (vr) {
        const v = vs.find(x => x.id === vr.dataset.vr);
        if (v) {
          const name = prompt('版本名稱：', v.name);
          if (name && name.trim()) { v.name = name.trim().slice(0, 20); saveVers(vs); showResult(); }
        }
        return;
      }
      if (pill) {
        const v = vs.find(x => x.id === pill.dataset.v);
        if (!v) return;
        const ids = v.ids.split('.').filter(id => DB[id]);
        state.sel = new Set(ids);
        state.autoFill = v.af !== false;
        save();
        showResult();
      }
    });
  }

  /* ---------- Google 試算表匯出／同步 ---------- */
  // 不含分頁名稱：直接貼在回應分頁的 D1，不受「表單回應/回覆 1」翻譯差異影響
  const GF_FORMULA = "=ARRAYFORMULA(SPLIT(TRANSPOSE(SPLIT(INDEX(B:B, COUNTA(B:B)), CHAR(10), TRUE, FALSE)), CHAR(9), TRUE, FALSE))";

  function parseFormLink(link) {
    const m = String(link || '').match(/forms\/d\/e\/([\w-]+)\//);
    const e = String(link || '').match(/[?&]entry\.(\d+)=/);
    if (!m || !e) return null;
    return { action: `https://docs.google.com/forms/d/e/${m[1]}/formResponse`, entry: 'entry.' + e[1] };
  }

  function sheetModalHtml() {
    let gsUrl = '', gfUrl = '';
    try {
      gsUrl = localStorage.getItem('busan_gs_url') || '';
      gfUrl = localStorage.getItem('busan_gf_url') || '';
    } catch (e) {}
    return `
    <div class="modal-mask no-print" id="gsMask" style="display:none">
      <div class="modal">
        <button class="m-close" id="gsClose">✕</button>
        <h3>📊 同步到 Google 試算表</h3>
        <p class="m-hint"><b>方法一（最快・零設定）：</b>複製 TSV 後，到 Google 試算表選 A1 按 Ctrl/Cmd+V 貼上，會自動分欄。</p>
        <button id="tsvBtn" class="m-btn">📋 複製 TSV 行程表（${esc(curVersionName())}）</button>
        <hr>
        <p class="m-hint"><b>方法二（推薦・免授權雲端同步）：</b>用 Google 表單當橋樑，<b>完全不經過應用程式授權</b>，不會出現「This app is blocked」。每按一次同步，就在試算表新增一列版本紀錄。</p>
        <input id="gfUrl" placeholder="貼上表單「預先填入的連結」 https://docs.google.com/forms/d/e/…/viewform?…entry.123=…" value="${esc(gfUrl)}">
        <div class="m-row">
          <button id="gfSave" class="m-btn">儲存連結</button>
          <button id="gfSync" class="m-btn go">☁️ 立即同步目前版本</button>
        </div>
        <div id="gfStatus" class="gs-status"></div>
        <details>
          <summary>📖 表單同步 一次性設定教學（約 2 分鐘・不會被封鎖）</summary>
          <ol>
            <li>到 <a href="https://forms.google.com" target="_blank" rel="noopener">forms.google.com</a> 建立空白表單，新增 1 題「<b>詳答</b>」題型（多行文字；題目名稱隨意，例如「行程資料」）</li>
            <li>切到「回應」分頁 → 點試算表圖示「連結至試算表」→ 建立試算表</li>
            <li>表單右上「⋮」→「<b>取得預先填入的連結</b>」→ 在題目裡隨便打幾個字 → 底部「取得連結」→「複製連結」</li>
            <li>把連結貼到上方欄位 → 按「儲存連結」即完成設定</li>
            <li>之後每次按「立即同步」，該版本就會寫入試算表回應分頁（如「表單回覆 1」）的新一列（B 欄，含版本名稱）</li>
            <li>想攤開成表格：到<b>回應分頁</b>點 <b>D1</b> 貼上下方公式，表格會攤在右側並自動顯示<b>最新同步</b>的版本（公式不含分頁名稱，不受「回應／回覆」翻譯差異影響；想看舊版把 COUNTA(B:B) 改成該列號即可）</li>
          </ol>
<pre id="gfFormula">${esc(GF_FORMULA)}</pre>
          <button id="gfFormulaCopy" class="m-btn">複製公式</button>
        </details>
        <hr>
        <p class="m-hint"><b>方法三（進階）Apps Script：</b>每個版本同步成試算表裡「一個工作表」，格式最漂亮，但部署時需要授權自建應用程式。</p>
        <input id="gsUrl" placeholder="貼上 Apps Script 網址 https://script.google.com/macros/s/…/exec" value="${esc(gsUrl)}">
        <div class="m-row">
          <button id="gsSave" class="m-btn">儲存網址</button>
          <button id="gsSync" class="m-btn go">☁️ 立即同步目前版本</button>
        </div>
        <div id="gsStatus" class="gs-status"></div>
        <details>
          <summary>⚠️ 授權時出現「This app is blocked」？</summary>
          <ol>
            <li><b>原因：</b>你的 Google 帳戶開啟了「強化的安全瀏覽」（或進階保護），Google 會直接封鎖「未驗證的自建應用程式」授權，連「進階→仍要前往」的選項都不給。</li>
            <li>開 <a href="https://myaccount.google.com/security" target="_blank" rel="noopener">myaccount.google.com/security</a> → 找到「強化的安全瀏覽」→ <b>暫時關閉</b>，等約 5 分鐘</li>
            <li>回 Apps Script 重新「部署」→ 授權畫面改出現「Google 尚未驗證這個應用程式」→ 點「<b>進階</b>」→「<b>前往 ○○（不安全）</b>」→ 允許（這是你自己寫的程式，安全無虞）</li>
            <li>完成後可把「強化的安全瀏覽」重新開啟，之後同步不需再授權</li>
            <li>若是公司／學校帳號被管理員政策封鎖，或不想動安全設定 → 請直接改用<b>方法二</b>（免授權）</li>
          </ol>
        </details>
        <details>
          <summary>📖 Apps Script 一次性設定教學（約 3 分鐘）</summary>
          <ol>
            <li>開一個 Google 試算表 → 上方選單「擴充功能」→「Apps Script」</li>
            <li>刪掉預設內容，貼上下方程式碼並儲存</li>
            <li>右上「部署」→「新增部署」→ 類型選「網路應用程式」→ 執行身分「我」、存取權「任何人」→ 部署（授權時見上方排解）</li>
            <li>複製產生的網址（…/exec）貼到上面欄位 → 按「儲存網址」</li>
            <li>之後每次按「立即同步」，目前版本就會寫入同名工作表</li>
          </ol>
<pre id="gsCode">function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(d.version) || ss.insertSheet(d.version);
  sh.clearContents();
  sh.getRange(1, 1, d.rows.length, d.rows[0].length).setValues(d.rows);
  return ContentService.createTextOutput('ok');
}</pre>
          <button id="gsCodeCopy" class="m-btn">複製程式碼</button>
        </details>
      </div>
    </div>`;
  }

  function bindSheetModal(plan) {
    $('#gsClose').addEventListener('click', () => { $('#gsMask').style.display = 'none'; });
    $('#gsMask').addEventListener('click', e => { if (e.target.id === 'gsMask') $('#gsMask').style.display = 'none'; });
    $('#tsvBtn').addEventListener('click', () => {
      const tsv = buildRows(plan).map(r => r.join('\t')).join('\n');
      copyToClipboard(tsv, '#tsvBtn', '✅ 已複製！到試算表按 Ctrl/Cmd+V 貼上');
    });

    /* 方法二：Google 表單免授權同步 */
    $('#gfSave').addEventListener('click', () => {
      const url = $('#gfUrl').value.trim();
      const st = $('#gfStatus');
      if (url && !parseFormLink(url)) {
        st.textContent = '⚠️ 這不像「預先填入的連結」：請照教學第 3 步取得（網址需含 /forms/d/e/…/viewform 與 entry.數字=）';
        return;
      }
      try { localStorage.setItem('busan_gf_url', url); } catch (e) {}
      st.textContent = url ? '✅ 已儲存，之後按「立即同步」即可' : '已清除連結';
    });
    $('#gfSync').addEventListener('click', () => {
      let url = '';
      try { url = (localStorage.getItem('busan_gf_url') || '').trim(); } catch (e) {}
      if (!url) url = $('#gfUrl').value.trim();
      const st = $('#gfStatus');
      const f = parseFormLink(url);
      if (!f) {
        st.textContent = '⚠️ 請先照教學取得表單「預先填入的連結」並儲存';
        return;
      }
      st.textContent = '☁️ 同步中…';
      const vName = curVersionName();
      const payload = `版本\t${vName}\n` + buildRows(plan).map(r => r.join('\t')).join('\n');
      fetch(f.action, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `${f.entry}=${encodeURIComponent(payload)}&fvv=1&pageHistory=0`
      }).then(() => {
        st.textContent = `✅ 已送出「${vName}」！開啟表單連結的試算表，回應分頁會多一列（在該分頁 D1 貼上教學裡的公式即可攤開成表格）`;
      }).catch(() => {
        st.textContent = '❌ 送出失敗，請檢查連結與網路後再試';
      });
    });
    $('#gfFormulaCopy').addEventListener('click', () => copyToClipboard(GF_FORMULA, '#gfFormulaCopy', '✅ 已複製公式'));

    /* 方法三：Apps Script */
    $('#gsSave').addEventListener('click', () => {
      const url = $('#gsUrl').value.trim();
      try { localStorage.setItem('busan_gs_url', url); } catch (e) {}
      $('#gsStatus').textContent = url ? '✅ 已儲存網址' : '已清除網址';
    });
    $('#gsSync').addEventListener('click', () => {
      let url = '';
      try { url = (localStorage.getItem('busan_gs_url') || '').trim(); } catch (e) {}
      if (!url) url = $('#gsUrl').value.trim();
      const st = $('#gsStatus');
      if (!/^https:\/\/script\.google\.com\//.test(url)) {
        st.textContent = '⚠️ 請先貼上有效的 Apps Script 網址（https://script.google.com/…/exec）並儲存';
        return;
      }
      st.textContent = '☁️ 同步中…';
      const vName = curVersionName();
      fetch(url, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ version: vName, rows: buildRows(plan) })
      }).then(() => {
        st.textContent = `✅ 已送出！開啟你的試算表確認：會建立／更新「${vName}」工作表`;
      }).catch(() => {
        st.textContent = '❌ 送出失敗，請檢查網址與網路後再試';
      });
    });
    $('#gsCodeCopy').addEventListener('click', () => copyToClipboard($('#gsCode').textContent, '#gsCodeCopy', '✅ 已複製程式碼'));
  }

  const cellTxt = s => String(s == null ? '' : s).replace(/[\t\n]/g, ' ');
  function buildRows(plan) {
    const rows = [['Day', '日期', '時間', '類別', '名稱', '地點／店家', '停留／交通', '預估費用', '備註']];
    plan.days.forEach((d, i) => {
      const D = `Day ${i + 1}`;
      rows.push([D, d.date, '', '主題', d.theme, CLUSTERS[d.cluster].label, '', '', '']);
      d.tl.forEach(r => {
        if (r.k === 'fixed') rows.push([D, d.date, r.t, '固定', cellTxt(r.text), '', '', '', cellTxt(r.sub || '')]);
        else if (r.k === 'trans') rows.push([D, d.date, `${fmtT(r.dep)}→${fmtT(r.arr)}`, '交通',
          cellTxt(r.tr.desc), '', `${r.tr.mins}分`, r.tr.fare2 ? `NT$${r.tr.fare2}（2人）` : '', '']);
        else if (r.k === 'free') rows.push([D, d.date, fmtT(r.t), '自由時間', `自由時間約${durTxt(r.mins)}`, '', `${r.mins}分`, '', '']);
        else if (r.k === 'hotel') rows.push([D, d.date, fmtT(r.t), '返回', '回到樂天飯店', '', '', '', '']);
        else if (r.k === 'store') rows.push([D, d.date, fmtT(r.t), '採購', cellTxt(r.g.store.name), '',
          `${r.stay}分`, '', cellTxt(r.g.items.map(x => x.name).join('、'))]);
        else if (r.k === 'd5shop') {
          if (r.stores) r.stores.forEach(g => rows.push([D, d.date, fmtT(r.t), '採購', cellTxt(g.store.name), '',
            `共${r.stay}分`, '', cellTxt(g.items.map(x => x.name).join('、'))]));
          else rows.push([D, d.date, fmtT(r.t), '採購', '西面最後採購（Olive Young＋樂天百貨/超市）', '', `${r.stay}分`, '', '']);
        } else if (r.k === 'item') {
          const cell = r.cell;
          if (cell.anchor) rows.push([D, d.date, fmtT(r.t), '散步', cellTxt(cell.anchor.name), '', `${r.stay}分`, '免費', '']);
          else {
            const it = cell.item;
            rows.push([D, d.date, fmtT(r.t), it.kind === 'spot' ? '景點' : '美食' + (cell.suggest ? '（推薦補位）' : ''),
              cellTxt(it.name), cellTxt(it.area || ''), `${r.stay}分`, cellTxt(it.price || ''), cellTxt(it.tag || '')]);
          }
        }
      });
    });
    rows.push(['', '', '', '', '', '', '', '', '']);
    if (plan.shops.length) {
      rows.push(['採購清單', '', '', '', '', '', '', '', '']);
      Object.keys(plan.shopGroups).forEach(g => {
        const grp = plan.shopGroups[g];
        grp.items.forEach(it => rows.push(['', '', '', '購物', cellTxt(it.name), cellTxt(g), '', cellTxt(it.price || ''),
          it.safe === 'warn' ? '⚠️成分含肉禁帶回台' : it.safe === 'ok-check' ? '須託運' : '']));
      });
      rows.push(['', '', '', '', '', '', '', '', '']);
    }
    rows.push(['預估花費', '', '', '', `每人餐飲＋門票約 ${money(plan.cost)}`, '', '', `市區交通約 ${money(plan.transTotal)}（2人）`,
      plan.shopCost ? `購物全買約 ${money(plan.shopCost)}` : '']);
    rows.push(['互動版連結', '', '', '', shareUrl(), '', '', '', '']);
    return rows;
  }

  /* 文字版行程（LINE 友善） */
  function planText(plan) {
    const t = CONFIG.trip;
    const L = [];
    L.push(`🌊 2026 釜山五天四夜｜客製行程（${curVersionName()}）`);
    L.push(`✈️ 去程 ${t.outbound.date} ${t.outbound.dep} → ${t.outbound.arr}`);
    L.push(`✈️ 回程 ${t.inbound.date} ${t.inbound.dep} → ${t.inbound.arr}`);
    L.push(`🏨 ${t.hotel.name}（西面站）`);
    plan.days.forEach((d, i) => {
      L.push('────────────');
      L.push(`📅 Day ${i + 1} ${d.date}｜${d.theme}`);
      d.tl.forEach(r => {
        if (r.k === 'fixed') L.push(`　${r.t} ${r.text.replace(/<[^>]*>/g, '')}`);
        else if (r.k === 'trans') L.push(`　└ ${r.tr.short}｜${fmtT(r.dep)}→${fmtT(r.arr)}`);
        else if (r.k === 'free') L.push(`　${fmtT(r.t)} 🌿 自由時間約${durTxtPlain(r.mins)}`);
        else if (r.k === 'hotel') L.push(`　${fmtT(r.t)} 🏨 ${r.pickup ? '回飯店領行李' : '回飯店'}`);
        else if (r.k === 'store') L.push(`　${fmtT(r.t)} 🛍️ ${r.g.store.name}（${r.g.items.length}項・約${r.stay}分）`);
        else if (r.k === 'd5shop') {
          if (r.stores) L.push(`　${fmtT(r.t)} 🛒 西面最終採購：${r.stores.map(g => `${g.store.name}（${g.items.length}項）`).join('、')}`);
          else L.push(`　${fmtT(r.t)} 🛒 西面最後採購（Olive Young＋樂天百貨/超市）`);
        } else if (r.k === 'item') {
          const cell = r.cell;
          if (cell.anchor) L.push(`　${fmtT(r.t)} ${cell.anchor.name}${cell.anchor.shopping ? '' : '（免費）'}`);
          else L.push(`　${fmtT(r.t)} ${cell.item.name}${cell.suggest ? '（推薦補位）' : ''}｜停留約${r.stay}分`);
        }
      });
      d.backup.forEach(it => L.push(`　⏸ 備選：${it.name}`));
    });
    if (plan.shops.length) {
      L.push('────────────');
      L.push(`🛍️ 採購清單（${plan.shops.length}項）`);
      Object.keys(plan.shopGroups).forEach(g => {
        L.push(`📍 ${g}`);
        plan.shopGroups[g].items.forEach(it => L.push(`　□ ${it.name}｜${it.price}`));
      });
    }
    L.push('────────────');
    L.push(`💰 每人餐飲＋門票約 ${money(plan.cost)}｜🚕 市區交通約 ${money(plan.transTotal)}（2人合計）`);
    L.push(`🔗 互動版連結：${shareUrl()}`);
    return L.join('\n');
    function durTxtPlain(m) { return durTxt(m); }
  }

  function copyToClipboard(text, btnSel, okMsg) {
    const done = () => {
      const b = $(btnSel); if (!b) return;
      const old = b.textContent; b.textContent = okMsg; b.classList.add('done');
      setTimeout(() => { b.textContent = old; b.classList.remove('done'); }, 2600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { alert('複製失敗，請手動長按選取'); }
    document.body.removeChild(ta);
  }

  /* ---------- 視圖切換 ---------- */
  function showResult(keepScroll) {
    save();
    if (!keepScroll) snapshotVersion();   // 手動微調不另存版本，避免版本清單被灌爆
    const plan = generate();
    lastPlan = plan;
    renderResult(plan);
    $('#pick').style.display = 'none';
    $('#result').style.display = '';
    if (!keepScroll) window.scrollTo({ top: 0 });
    try {
      history.replaceState(null, '', location.pathname + '?s=' + [...state.sel].sort().join('.') +
        (state.autoFill ? '' : '&af=0') + extraParams());
    } catch (e) {}
  }
  function showPick() {
    $('#result').style.display = 'none';
    $('#pick').style.display = '';
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    renderChips(); renderGrid(); renderBar(); renderTools();
    window.scrollTo({ top: 0 });
  }

  /* ---------- 事件 ---------- */
  /* 手動調整：改完就地重排並回到原捲動位置 */
  function reflow(msg) {
    const y = window.scrollY;
    save();
    showResult(true);
    window.scrollTo({ top: y });
    if (msg) toast(msg);
  }
  /* 結果頁的委派事件只綁一次——#result-inner 不會被重建，
     每次渲染都重綁會讓同一次點擊觸發 N 個處理器（呼叫次數指數成長） */
  function bindResultEvents() {
    $('#result-inner').addEventListener('click', e => {
      if (e.target.closest('#resetPins')) { state.pins = {}; state.stPins = {}; state.ord = {}; state.dayCl = null; reflow('已還原成系統自動安排'); return; }
      /* ▲▼ 本日排序：以當天實際停靠序列為底，交換相鄰兩站後存成該天的手動順序 */
      const ro = e.target.closest('[data-ro]');
      if (ro) {
        const [di, si, dir] = ro.dataset.ro.split('|').map(Number);
        const day = lastPlan && lastPlan.days[di];
        if (!day || !day.seq) return;
        const j = si + dir;
        if (j < 0 || j >= day.seq.length) return;
        const keys = day.seq.map(stopKey).filter(Boolean);
        if (si >= keys.length || j >= keys.length) return;
        const t0 = keys[si]; keys[si] = keys[j]; keys[j] = t0;
        state.ord[di] = keys;
        reflow('已調整本日順序，時間與交通重新試算好了');
        return;
      }
      const smv = e.target.closest('[data-stmv]');
      if (smv) {
        const a = smv.dataset.stmv.split('|');
        const sid = a[0], di = +a[1];
        if (di < 0 || di > 4 || !STORES[sid]) return;
        state.stPins[sid] = { d: di };
        reflow(`已把「${STORES[sid].name}」的採購移到 Day ${di + 1}，行程重新排好了`);
        return;
      }
      const sa = e.target.closest('[data-stauto]');
      if (sa) {
        delete state.stPins[sa.dataset.stauto];
        reflow('這站採購已改回系統自動安排');
        return;
      }
      const ad = e.target.closest('[data-add]');
      if (ad) {
        const [id, d] = ad.dataset.add.split('|');
        state.sel.add(id);
        state.pins[id] = { d: +d, s: null, t: Date.now() };
        reflow(`已把「${DB[id].name}」加進 Day ${+d + 1} 的空檔，行程重新排好了`);
        return;
      }
      const sw = e.target.closest('[data-swap]');
      if (sw) { swapDays(...sw.dataset.swap.split('|').map(Number)); return; }
      const mv = e.target.closest('[data-mv]');
      const dp = e.target.closest('[data-drop]');
      if (mv) {
        const [id, d] = mv.dataset.mv.split('|');
        const di = +d;
        if (di < 0 || di > 4) return;
        state.pins[id] = { d: di, s: null, t: Date.now() };   // 換天時不鎖時段，讓系統找最順的
        reflow(`已把「${DB[id].name}」移到 Day ${di + 1}，其他行程已重新調整`);
      } else if (dp) {
        const id = dp.dataset.drop;
        const nm = DB[id] ? DB[id].name : '';
        state.sel.delete(id);
        delete state.pins[id];
        if (!ready()) { state.sel.add(id); toast('至少要保留 3 個景點與 6 家餐飲，這項沒有移除'); return; }
        reflow(`已移除「${nm}」，行程重新排好了`);
      }
    });
    $('#result-inner').addEventListener('change', e => {
      const sd = e.target.closest('[data-stday]');
      if (sd) {
        const sid = sd.dataset.stday;
        if (!STORES[sid]) return;
        if (sd.value === '') {
          delete state.stPins[sid];
          reflow(`「${STORES[sid].name}」已改回系統自動安排`);
          return;
        }
        const di = +sd.value;
        if (!(di >= 0 && di <= 4)) return;
        state.stPins[sid] = { d: di };
        reflow(`已把「${STORES[sid].name}」的採購指定到 Day ${di + 1}，行程重新排好了`);
        return;
      }
      const sel = e.target.closest('[data-slot]');
      if (!sel) return;
      const [id, d] = sel.dataset.slot.split('|');
      state.pins[id] = { d: +d, s: sel.value, t: Date.now() };
      reflow(`已把「${DB[id].name}」改到「${SLOT_LABELS[sel.value] || sel.value}」時段`);
    });
  }

  /* 整天對調：交換兩天負責的生活圈，手動釘選的項目跟著整天一起搬 */
  function swapDays(a, b) {
    const pa = fullDayInfo.findIndex(f => f.idx === a);
    const pb = fullDayInfo.findIndex(f => f.idx === b);
    if (pa < 0 || pb < 0) return;
    const arr = fullDayInfo.map(f => f.cluster);
    const tmp = arr[pa]; arr[pa] = arr[pb]; arr[pb] = tmp;
    state.dayCl = arr;
    Object.keys(state.pins).forEach(id => {
      const pin = state.pins[id];
      if (pin.d === a) pin.d = b; else if (pin.d === b) pin.d = a;
    });
    Object.keys(state.stPins).forEach(k => {
      const p = state.stPins[k];
      if (p.d === a) p.d = b; else if (p.d === b) p.d = a;
    });
    const oa = state.ord[a], ob = state.ord[b];
    delete state.ord[a]; delete state.ord[b];
    if (ob) state.ord[a] = ob;
    if (oa) state.ord[b] = oa;
    reflow(`Day ${a + 1} 與 Day ${b + 1} 已整天對調（${CLUSTERS[arr[pa]].short} ↔ ${CLUSTERS[arr[pb]].short}），時間與交通都重新算過了`);
  }

  function bindEvents() {
    bindResultEvents();
    /* 電話一鍵複製（勾選頁與結果頁的卡片都會出現，委派一次搞定）。
       用捕獲階段：.links 容器有 stopPropagation，冒泡到不了 document */
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-tel]');
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const tel = b.dataset.tel;
      const done = () => {
        const old = b.innerHTML;
        b.innerHTML = '✅ 已複製';
        b.classList.add('done');
        setTimeout(() => { b.innerHTML = old; b.classList.remove('done'); }, 2200);
        toast(`已複製 ${tel}——開 NAVER 地圖貼上搜尋，一秒直達店家`);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tel).then(done).catch(() => fallbackCopy(tel, done));
      } else fallbackCopy(tel, done);
    }, true);
    $('#tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      state.tab = b.dataset.tab; renderChips(); renderGrid();
    });
    $('#subchips').addEventListener('click', e => {
      const fc = e.target.closest('[data-fc]'), sc = e.target.closest('[data-sc]');
      if (fc) state.foodCat = fc.dataset.fc;
      if (sc) state.shopCat = sc.dataset.sc;
      if (fc || sc) { renderChips(); renderGrid(); }
    });
    $('#regionchips').addEventListener('click', e => {
      const b = e.target.closest('[data-rg]'); if (!b) return;
      state.region = b.dataset.rg; renderChips(); renderGrid();
    });
    $('#storechips').addEventListener('click', e => {
      const more = e.target.closest('[data-stmore]');
      if (more) { state.storeExpand = !state.storeExpand; renderChips(); return; }
      const b = e.target.closest('[data-st]'); if (!b) return;
      state.store = b.dataset.st;
      if (state.store !== 'all') { state.shopCat = 'all'; state.region = 'all'; } // 看整間店的所有推薦
      renderChips(); renderGrid();
    });
    $('#filterToggle').addEventListener('click', () => {
      $('.controls').classList.toggle('fopen');
      updateFilterToggle();
    });
    /* 關鍵字搜尋：即時過濾＋顯示各分頁命中數 */
    $('#searchBox').addEventListener('input', e => {
      state.q = e.target.value.trim();
      $('#searchClear').style.display = state.q ? '' : 'none';
      renderChips(); renderGrid();
    });
    $('#searchClear').addEventListener('click', () => {
      state.q = '';
      $('#searchBox').value = '';
      $('#searchClear').style.display = 'none';
      renderChips(); renderGrid();
      $('#searchBox').focus();
    });
    $('#sortrow').addEventListener('click', e => {
      const b = e.target.closest('[data-sort]'); if (!b) return;
      state.sort = b.dataset.sort; renderChips(); renderGrid();
    });
    $('#draftpanel').addEventListener('click', e => {
      if (e.target.id === 'saveDraft') {
        if (!state.sel.size) { toast('請先勾選一些項目再存草稿'); return; }
        const before = loadVers().length;
        const vs = snapshotVersion();
        toast(vs.length > before ? `已存為「${curVersionName()}」` : `目前勾選與「${curVersionName()}」相同，未重複建立`);
        renderTools();
        return;
      }
      const btn = e.target.closest('[data-apply],[data-mix],[data-ren],[data-del]'); if (!btn) return;
      const d = btn.dataset;
      const id = d.apply || d.mix || d.ren || d.del;
      let vs = loadVers();
      const v = vs.find(x => x.id === id); if (!v) return;
      const ids = v.ids.split('.').filter(x => DB[x]);
      if (d.apply) {
        state.sel = new Set(ids);
        state.autoFill = v.af !== false;
        save(); renderGrid(); renderBar(); renderTools();
        toast(`已套用草稿「${v.name}」（${ids.length} 項），可以直接調整或按下方產生行程`);
      } else if (d.mix) {
        const before = state.sel.size;
        ids.forEach(x => state.sel.add(x));
        save(); renderGrid(); renderBar(); renderTools();
        toast(`已把「${v.name}」併入目前勾選，新增 ${state.sel.size - before} 項（合計 ${state.sel.size} 項）`);
      } else if (d.ren) {
        const name = prompt('草稿名稱：', v.name);
        if (name && name.trim()) { v.name = name.trim().slice(0, 20); saveVers(vs); renderTools(); }
      } else if (d.del) {
        if (confirm(`刪除草稿「${v.name}」？`)) { saveVers(vs.filter(x => x.id !== v.id)); renderTools(); toast('已刪除草稿'); }
      }
    });
    $('#grid').addEventListener('click', e => {
      if (e.target.closest('a')) return;
      const card = e.target.closest('.card'); if (!card) return;
      toggle(card.dataset.id, card);
    });
    $('#grid').addEventListener('keydown', e => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      const card = e.target.closest('.card'); if (!card) return;
      e.preventDefault(); toggle(card.dataset.id, card);
    });
  }
  function toggle(id, card) {
    if (state.sel.has(id)) { state.sel.delete(id); delete state.pins[id]; } else state.sel.add(id);
    const on = state.sel.has(id);
    card.classList.toggle('on', on);
    card.setAttribute('aria-checked', on);
    card.querySelector('.tick').textContent = on ? '✓ 已選' : '＋ 選擇';
    save(); renderBar(); renderTools();
  }

  /* ---------- 版本檢查 ----------
     靜態站最惱人的問題：手機快取住舊的 index.html，就會一直載到舊版資源、
     看不到新功能。這裡主動比對伺服器上的版本，不同就跳出更新提示。 */
  function checkStale() {
    const el = $('script[src*="app.js"]');
    const cur = (String(el && el.getAttribute('src')).match(/v=([\w.]+)/) || [])[1];
    if (!cur) return;
    fetch(location.pathname + '?nc=' + Date.now(), { cache: 'no-store' })
      .then(r => r.ok ? r.text() : Promise.reject())
      .then(t => {
        const latest = (t.match(/app\.js\?v=([\w.]+)/) || [])[1];
        if (!latest || latest === cur) return;
        const bar = document.createElement('div');
        bar.id = 'updbar';
        bar.innerHTML = '<span>🔄 有新版本（' + esc(latest) + '），你現在看到的是舊版 ' + esc(cur) +
          '</span><button id="updBtn">立即更新</button>';
        document.body.appendChild(bar);
        $('#updBtn').addEventListener('click', () => {
          const u = new URL(location.href);
          u.searchParams.set('_v', latest);
          location.replace(u.toString());
        });
      })
      .catch(() => {});
  }

  /* ---------- 啟動 ---------- */
  function init() {
    checkStale();
    const shared = parseUrl();
    if (!shared) load();
    renderChips(); renderGrid(); renderBar(); renderTools(); bindEvents();
    if (shared && ready()) showResult();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
