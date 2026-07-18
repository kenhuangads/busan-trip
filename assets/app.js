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
    DB[it.id] = it;
  });

  const state = {
    sel: new Set(),
    tab: 'spot',            // spot | food | shop
    foodCat: 'all',
    shopCat: 'all',
    region: 'all',
    sort: 'rec',            // rec | price | dist
    autoFill: true,
    fromShare: false
  };

  const gimg = q => 'https://www.google.com/search?udm=2&q=' + encodeURIComponent(q); // Google 圖片搜尋
  function linkRow(links, imgQuery) {
    if (!links && !imgQuery) return '';
    links = links || {};
    const a = [];
    if (links.g) a.push(`<a href="${gmap(links.g)}" target="_blank" rel="noopener">📍 Google地圖</a>`);
    if (links.zh) a.push(`<a href="${esc(links.zh)}" target="_blank" rel="noopener">🇹🇼 繁中介紹</a>`);
    if (links.o) a.push(`<a href="${esc(links.o)}" target="_blank" rel="noopener">🌐 官網／介紹</a>`);
    if (links.s) a.push(`<a href="${gsearch(links.s)}" target="_blank" rel="noopener">🔎 商品介紹</a>`);
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
    } catch (e) {}
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem('busan_sel_v2') || '[]');
      s.forEach(id => { if (DB[id]) state.sel.add(id); });
      state.autoFill = localStorage.getItem('busan_af_v2') !== '0';
    } catch (e) {}
  }
  function shareUrl() {
    const ids = [...state.sel].sort();
    return CONFIG.baseUrl + '?s=' + ids.join('.') + (state.autoFill ? '' : '&af=0');
  }
  function parseUrl() {
    const p = new URLSearchParams(location.search);
    const s = p.get('s');
    if (!s) return false;
    const ids = s.split('.').filter(id => DB[id]);
    if (!ids.length) return false;
    state.sel = new Set(ids);
    state.autoFill = p.get('af') !== '0';
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
    if (wKm <= 0.95) {
      const mins = Math.max(2, Math.ceil(wKm / 4.2 * 60) + 2);
      return { mode: 'walk', mins, fare2: 0,
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
      return { mode: 'metro', mins: mi.mins, fare2: mi.fareNT * 2,
        desc: `🚇 地鐵${mi.label} 約${mi.mins}分・約NT$${mi.fareNT}／人（此段搭地鐵更順）`,
        short: `🚇${mi.mins}分 NT$${mi.fareNT}/人` };
    }
    return { mode: 'taxi', mins: taxiMins, fare2: taxiNT,
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
    cafe: ['cafe'], sweet: ['dessert', 'snack'], evening: ['SPOT'], dinner: ['dinner', 'meal'],
    night: ['SPOT', 'supper', 'snack', 'dessert'],
    latelunch: ['lunch', 'meal', 'brunch', 'snack'], pmstroll: ['SPOT'], pmcafe: ['cafe', 'dessert'],
    d1dinner: ['dinner', 'meal'], d1night: ['SPOT', 'supper', 'snack', 'dessert'],
    d5brunch: ['brunch'], d5lunch: ['lunch', 'meal']
  };
  // 各時段「不早於」的開始時間（分鐘制；交通試算若更晚則以抵達為準）
  const SLOT_TARGET = {
    brunch: 540, lunch: 690, evening: 1050, dinner: 1065, night: 1200,
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
      { key: 'd1', date: '9/26（六）', full: false, cluster: 'seomyeon', theme: '抵達釜山・西面暖身',
        slotKeys: ['latelunch', 'pmstroll', 'pmcafe', 'd1dinner', 'd1night'] },
      { key: 'd2', date: '9/27（日）', full: true, cluster: 'east', theme: '海岸線一日',
        slotKeys: ['brunch', 'morning', 'lunch', 'afternoon', 'cafe', 'sweet', 'evening', 'dinner', 'night'] },
      { key: 'd3', date: '9/28（一）', full: true, cluster: 'gwangalli', theme: '海景與夜色',
        slotKeys: ['brunch', 'morning', 'lunch', 'afternoon', 'cafe', 'sweet', 'evening', 'dinner', 'night'] },
      { key: 'd4', date: '9/29（二）', full: true, cluster: 'nampo', theme: '舊城文化散策',
        slotKeys: ['brunch', 'morning', 'lunch', 'afternoon', 'cafe', 'sweet', 'evening', 'dinner', 'night'] },
      { key: 'd5', date: '9/30（三）', full: false, cluster: 'seomyeon', theme: '西面最終採購・返程',
        slotKeys: ['d5brunch', 'd5shop', 'd5lunch'] }
    ];
  }

  /* ---- 停靠點（seq）輔助 ---- */
  const storeStay = g => Math.min(100, g.store.stay + Math.max(0, g.items.length - 3) * 4);

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
    let transCost = 0;
    const modeCnt = { walk: 0, taxi: 0, metro: 0 };

    day.seq.forEach(stop => {
      const pos = posOfStop(stop, day);
      const tr = transCalc(cur, pos);
      const tKey = stop.slotKey || (stop.type === 'd5shop' ? 'd5shop' : null);
      const target = tKey ? SLOT_TARGET[tKey] : null;
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
        transCost += tr.fare2;
        modeCnt[tr.mode]++;
      }
      const stay = stayOfStop(stop, day);
      const end = start + stay;
      if (stop.type === 'store') rows.push({ k: 'store', t: start, end, stay, g: stop });
      else if (stop.type === 'd5shop') rows.push({ k: 'd5shop', t: start, end, stay, stores: stop.stores, warn: stop.warn });
      else rows.push({ k: 'item', t: start, end, stay, slotKey: stop.slotKey, cell: stop.cell });
      time = end;
      cur = pos;
    });

    if (day.seq.length) {
      const tr = transCalc(cur, { lat: HOTEL.lat, lng: HOTEL.lng, zone: HOTEL.zone });
      rows.push({ k: 'trans', dep: time, arr: time + tr.mins, tr });
      transCost += tr.fare2;
      modeCnt[tr.mode]++;
      time += tr.mins;
      rows.push({ k: 'hotel', t: time, pickup: day.key === 'd5' });
    }
    if (day.key === 'd5') {
      day.squeeze = time > 740; // 12:20 前需回到飯店領行李
      rows.push({ k: 'fixed', t: '12:30', text: '🚕 前往金海國際機場', sub: '計程車約 25 分（約NT$430-540）；13:00 前抵達辦理退稅、報到與托運' });
      rows.push({ k: 'fixed', t: '15:00', text: `✈️ ${t.inbound.dep}（${t.inbound.airline}）`, sub: '※回程起飛時間請以票面／訂位紀錄再確認' });
      rows.push({ k: 'fixed', t: '16:30', text: '🛬 抵達台中國際機場', sub: '台灣時間｜歡迎回家 🎉' });
    }
    day.tl = rows;
    day.transCost = transCost;
    day.modeCnt = modeCnt;
  }

  function generate() {
    const sel = ALL.filter(it => state.sel.has(it.id)).sort((a, b) => a._idx - b._idx);
    const spots = sel.filter(i => i.kind === 'spot');
    const foods = sel.filter(i => i.kind === 'food');
    const shops = sel.filter(i => i.kind === 'shop');

    const days = makeDays();

    /* 依勾選數量重新分配 Day2-4 的主題區域 */
    const cnt = { east: 0, gwangalli: 0, nampo: 0 };
    [...spots, ...foods].forEach(it => {
      const cs = it.flex || [it.cluster];
      cs.forEach(c => { if (cnt[c] !== undefined) cnt[c] += 1 / cs.length; });
    });
    const bigOrder = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
    const fullDays = days.filter(d => d.full);
    const themes = { east: '海雲台・機張 海岸線一日', gwangalli: '廣安里 海景與夜色', nampo: '南浦洞・甘川洞 舊城文化' };
    fullDays.forEach(d => {
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
            d.slots[sk] = { item, suggest: false };
            return true;
          }
        }
      }
      return false;
    }

    const unplaced = [];
    // 先放景點（slot 較稀缺）
    spots.forEach(it => {
      const clusters = it.flex || [it.cluster];
      if (!tryPlace(it, SPOT_PREF[it.slot] || SPOT_PREF.afternoon, clusters)) unplaced.push(it);
    });
    // 再放餐飲：固定區域者先、彈性（多分店）者後
    const fixedFoods = foods.filter(f => !f.flex);
    const flexFoods = foods.filter(f => f.flex);
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
      const suggest = (day, slotKey, filter) => {
        if (day.slots[slotKey]) return;
        const cand = FOODS.filter(f =>
          !state.sel.has(f.id) && !suggested.has(f.id) &&
          (f.flex || [f.cluster]).includes(day.cluster) &&
          (ACCEPT[slotKey] || []).includes(f.slot) &&
          (!filter || filter(f)))
          .sort((a, b) => (b.rec || 0) - (a.rec || 0) || a._idx - b._idx); // 補位取推薦度最高者
        if (cand.length) { suggested.add(cand[0].id); day.slots[slotKey] = { item: cand[0], suggest: true }; }
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
    const smGroups = storeGroups.filter(g => g !== cvsGroup && ZONES[g.store.zone].cluster === 'seomyeon');
    const otherGroups = storeGroups.filter(g => g !== cvsGroup && !smGroups.includes(g));

    /* 每日停靠序列（不含 d5shop 佔位，稍後客製） */
    days.forEach(d => {
      d.seq = d.slotKeys
        .filter(k => k !== 'd5shop' && d.slots[k])
        .map(k => ({ type: 'cell', slotKey: k, cell: d.slots[k] }));
    });

    /* 非西面門市 → 插入對應區域日：先試算各空隙的抵達時間，
       過濾「打烊前能逛完」的空隙，再取繞路最少者（皆不可行則取最早） */
    function insertStore(day, g) {
      const seq = day.seq;
      if (!seq.length) { seq.push(g); return; }
      const S = { lat: g.store.lat, lng: g.store.lng };
      const cand = [];
      for (let i = 0; i < seq.length; i++) {
        const seq2 = seq.slice();
        seq2.splice(i + 1, 0, g);
        const tmp = { key: day.key, cluster: day.cluster, seq: seq2 };
        computeTimeline(tmp);
        const row = tmp.tl.find(r => r.k === 'store' && r.g === g);
        if (!row) continue;
        const A = posOfStop(seq[i], day);
        const B = i === seq.length - 1 ? HOTEL : posOfStop(seq[i + 1], day);
        cand.push({ i, det: havKm(A, S) + havKm(S, B) - havKm(A, B), start: row.t, end: row.end });
      }
      if (!cand.length) { seq.push(g); return; }
      const close = g.store.close || 1440;
      const ok = cand.filter(c => c.end <= close && c.start <= 1170);
      const pool = ok.length ? ok : [cand.slice().sort((a, b) => a.start - b.start)[0]];
      const pick = pool.sort((a, b) => a.det - b.det)[0];
      seq.splice(pick.i + 1, 0, g);
    }
    otherGroups
      .sort((a, b) => b.items.length - a.items.length)
      .forEach(g => {
        const cl = ZONES[g.store.zone].cluster;
        const day = days.slice(1, 4).find(d => d.cluster === cl);
        if (day) insertStore(day, g);
        else g.unplaced = true;
      });

    /* Day 5：西面最終採購（客製列出門市與品項） */
    const d5 = days[4];
    let d5stop;
    if (smGroups.length) {
      let stay = smGroups.reduce((s, g) => s + storeStay(g), 0) + 8 * (smGroups.length - 1);
      const warn = stay > 100;
      d5stop = { type: 'd5shop', stores: smGroups, stay: Math.min(stay, 110), warn };
    } else {
      d5stop = { type: 'd5shop', stores: null, stay: 75 };
    }
    d5.seq = [];
    d5.slotKeys.forEach(k => {
      if (k === 'd5shop') d5.seq.push(d5stop);
      else if (d5.slots[k]) d5.seq.push({ type: 'cell', slotKey: k, cell: d5.slots[k] });
    });

    /* 時間軸試算 */
    days.forEach(computeTimeline);

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
    storeGroups.forEach(g => {
      const cl = ZONES[g.store.zone].cluster;
      let hint;
      if (g.storeId === 'cvs') hint = '隨時順手買｜' + g.store.name;
      else if (cl === 'seomyeon') hint = 'Day 5 上午集中採買（可提前 Day 1 傍晚）｜' + g.store.name;
      else {
        const di = days.findIndex(d => d.cluster === cl && d.full);
        hint = di >= 0 ? `Day ${di + 1} 順路採買｜${g.store.name}` : '自由安排｜' + g.store.name;
      }
      shopGroups[hint] = { store: g.store, items: g.items };
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
      ${priceLine}${waitLine}${it.area ? buyLine : ''}${extraLine}
      <p class="desc">${esc(it.desc)}</p>
      ${linkRow(it.links, imgQ(it))}
    </div>`;
  }

  function renderGrid() {
    let list;
    if (state.tab === 'spot') list = SPOTS;
    else if (state.tab === 'food') list = state.foodCat === 'all' ? FOODS : FOODS.filter(f => f.cat === state.foodCat);
    else list = state.shopCat === 'all' ? SHOPS : SHOPS.filter(s => s.cat === state.shopCat);
    if (state.region !== 'all') list = list.filter(i => (i.flex || [i.cluster]).includes(state.region));
    list = list.slice();
    if (state.sort === 'price') list.sort((a, b) => (a.est || 0) - (b.est || 0) || a._idx - b._idx);
    else if (state.sort === 'dist') list.sort((a, b) => a._km - b._km || a._idx - b._idx);
    else list.sort((a, b) => (b.rec || 0) - (a.rec || 0) || a._idx - b._idx); // 推薦度：跨分類混排
    $('#grid').innerHTML = list.map(cardHtml).join('') ||
      '<p class="empty">此分類目前沒有符合區域篩選的項目</p>';
  }

  function renderChips() {
    const tabs = [['spot', `🗼 景點（${SPOTS.length}）`], ['food', `🍜 美食（${FOODS.length}）`], ['shop', `🛍️ 購物（${SHOPS.length}）`]];
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

    $('#regionchips').innerHTML = `<button class="chip rg ${state.region === 'all' ? 'on' : ''}" data-rg="all">全部區域</button>` +
      Object.entries(CLUSTERS).map(([k, v]) =>
        `<button class="chip rg ${state.region === k ? 'on' : ''}" data-rg="${k}" style="--c:${v.color}">${v.label}</button>`).join('');

    const sorts = [['rec', '⭐ 推薦度'], ['price', '💰 價格低→高'], ['dist', '🏨 離飯店近→遠']];
    $('#sortrow').innerHTML = `<span class="sortlab">排序</span>` + sorts.map(([k, t]) =>
      `<button class="chip sort ${state.sort === k ? 'on' : ''}" data-sort="${k}">${t}</button>`).join('');
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
      return `<div class="entry free"><div class="t"><span class="clock sm">${fmtT(r.t)}</span><span class="slotlab">空檔</span></div>
        <div class="e-body"><div class="free-body">🌿 自由時間約${durTxt(r.mins)}——可回飯店休息、周邊隨逛，或提早出發慢慢走</div></div></div>`;
    }
    if (r.k === 'hotel') {
      return entryHtml(fmtT(r.t), '返回', `<div class="e-name">${r.pickup ? '🏨 回飯店領行李，整理後前往機場' : '🏨 回到樂天飯店，今日行程結束'}</div>`, 'fixed hotelend');
    }
    if (r.k === 'store') {
      const g = r.g;
      const lateWarn = r.end > (g.store.close || 1440)
        ? '<div class="store-note">⚠️ 此時段可能接近打烊，請以現場營業時間為準；來不及可改列自由採買。</div>' : '';
      return entryHtml(fmtT(r.t), '順路採購', `
        <div class="e-name">🛍️ ${esc(g.store.name)} <span class="stay">⏳ 停留約${durTxt(r.stay)}</span></div>
        <div class="store-items">${g.items.map(it => `<span>☐ ${esc(it.name)}</span>`).join('')}</div>
        ${g.store.note ? `<div class="store-note">💡 ${esc(g.store.note)}</div>` : ''}${lateWarn}
        ${linkRow(g.store.links, g.store.links && g.store.links.g)}`, 'storestop');
    }
    if (r.k === 'd5shop') {
      if (!r.stores) {
        return entryHtml(fmtT(r.t), SLOT_LABELS.d5shop, `
          <div class="e-name">🛍️ 西面最後採購：Olive Young 旗艦店＋樂天百貨／樂天超市 <span class="stay">⏳ 約${durTxt(r.stay)}</span></div>
          <div class="e-desc">美妝、伴手禮最後掃貨並辦理退稅（同店單筆滿 15,000₩ 即可退），採買完回飯店打包行李</div>
          ${linkRow({ g: '올리브영 부산 서면점', n: '롯데백화점 부산본점' }, '올리브영 부산 서면점')}`, 'storestop');
      }
      const inner = r.stores.map(g => `
        <div class="store-b"><b>🛍️ ${esc(g.store.name)}</b>
          <div class="store-items">${g.items.map(it => `<span>☐ ${esc(it.name)}</span>`).join('')}</div>
          ${g.store.note ? `<div class="store-note">💡 ${esc(g.store.note)}</div>` : ''}
          ${linkRow(g.store.links, g.store.links && g.store.links.g)}</div>`).join('');
      return entryHtml(fmtT(r.t), SLOT_LABELS.d5shop, `
        <div class="e-name">🛒 西面最終採購（${r.stores.reduce((s, g) => s + g.items.length, 0)} 項）<span class="stay">⏳ 合計約${durTxt(r.stay)}</span></div>
        ${inner}
        <div class="store-note">💳 記得帶護照辦退稅；買完回飯店領行李。${r.warn ? '<b>⚠️ 品項較多、離場前時間較緊，建議部分改到 Day 1 傍晚先買。</b>' : ''}</div>`, 'storestop');
    }
    /* item */
    const cell = r.cell;
    const label = SLOT_LABELS[r.slotKey] || '';
    if (cell.anchor) {
      const a = cell.anchor;
      return entryHtml(fmtT(r.t), label, `
        <div class="e-name">${a.shopping ? '🛍️' : '🚶'} ${esc(a.name)} <span class="badge free">${a.shopping ? '採購時間' : '免費散步'}</span> <span class="stay">⏳ 約${durTxt(r.stay)}</span></div>
        <div class="e-desc">${esc(a.desc)}</div>${linkRow(a.links, a.links && a.links.g)}`);
    }
    const it = cell.item;
    const ci = catInfo(it);
    return entryHtml(fmtT(r.t), label, `
      <div class="e-name">${ci.icon} ${esc(it.name)}
        ${cell.suggest ? '<span class="badge sug">推薦補位・未勾選</span>' : ''}
        ${it.tag ? `<span class="badge tag">${esc(it.tag)}</span>` : ''}
        <span class="stay">⏳ 停留約${durTxt(r.stay)}</span></div>
      <div class="e-meta">📌 ${esc(it.area || '')} ｜ 💰 ${esc(it.price || '')}</div>
      ${it.wait ? `<div class="e-meta sub">⏱ ${esc(it.wait)}</div>` : ''}
      <div class="e-desc">${esc(it.desc)}</div>${linkRow(it.links, imgQ(it))}`);
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

  function renderResult(plan) {
    const t = CONFIG.trip;
    const c = counts();
    const dayHtml = plan.days.map((d, i) => {
      const cl = CLUSTERS[d.cluster];
      const rows = d.tl.map(r => rowHtml(r, d)).join('');
      const backup = d.backup.length ? `
        <div class="backup"><b>⏸ 同區備選（時間排不下，可自行替換）</b>${d.backup.map(it => {
          const ci = catInfo(it);
          return `<div class="bk-item">${ci.icon} ${esc(it.name)}｜💰 ${esc(it.price || '')} ${linkRow(it.links, imgQ(it))}</div>`;
        }).join('')}</div>` : '';
      const dayTips = {
        d1: '🌕 ' + CONFIG.holidayNote,
        d2: '🌕 9/27（日）為中秋連假隔天的週日，海雲台一帶人潮較多，膠囊列車與熱門餐廳請務必提前預約／提早抽號。'
      };
      const mc = d.modeCnt || { taxi: 0, metro: 0, walk: 0 };
      const modeBits = [];
      if (mc.taxi) modeBits.push(`計程車${mc.taxi}段`);
      if (mc.metro) modeBits.push(`地鐵${mc.metro}段`);
      if (mc.walk) modeBits.push(`步行${mc.walk}段`);
      const transTip = d.seq && d.seq.length ? `<div class="tip">🧭 本日交通試算：${modeBits.join('＋') || '皆在步行圈'}｜交通費預估 ${money(d.transCost || 0)}（2人合計）｜時間為保守估算（含候車與緩衝），實際依路況調整。</div>` : '';
      const squeezeTip = d.squeeze ? `<div class="tip holiday">⚠️ 離場前時間較緊：建議把部分採買或用餐提前，或改到機場解決。</div>` : '';
      const lunchTip = d.lunchDropped ? `<div class="tip">🍜 登機前時間有限，午餐建議外帶輕食或在機場用餐（金海機場餐飲選擇不少）。</div>` : '';
      return `
      <section class="day" style="--c:${cl.color}">
        <header class="day-head">
          <div class="day-no">Day ${i + 1}</div>
          <div><h2>${d.date}｜${esc(d.theme)}</h2><div class="day-cl">${esc(cl.label)}</div></div>
        </header>
        ${dayTips[d.key] ? `<div class="tip holiday">${esc(dayTips[d.key])}</div>` : ''}
        <div class="tip">🚇 ${esc(TRANSIT[d.cluster])}</div>
        ${transTip}${squeezeTip}${lunchTip}
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
        <p class="hint">💡 已依「實際門市」分組並排進每日行程；退稅提醒：同店單筆滿 15,000₩ 即可退稅，Olive Young／樂天超市可現場即時退稅。</p>
        ${groups.map(g => {
          const grp = plan.shopGroups[g];
          return `<div class="shop-group"><h3>📍 ${esc(g)}</h3>${grp.items.map(it => {
            const ci = catInfo(it);
            const safeTxt = it.safe === 'warn' ? '<span class="badge warn">⚠️ 成分含肉禁帶</span>' :
              it.safe === 'ok-check' ? '<span class="badge note">須託運</span>' : '';
            return `<div class="shop-item"><div><b>${ci.icon} ${esc(it.name)}</b> ${safeTxt}<div class="e-meta sub">🏬 ${esc(it.buy)}｜💰 ${esc(it.price)}</div></div>${linkRow(it.links, imgQ(it))}</div>`;
          }).join('')}</div>`;
        }).join('')}
        <div class="tip customs">🛃 <b>台灣海關提醒：</b>所有肉類製品（肉乾、火腿腸、含肉塊泡麵）嚴禁入境，首次查獲罰 NT$20 萬；泡菜、芝麻油、果醬等液體/發酵品必須託運；純海鮮加工品（魚糕、海苔）可安心帶。不確定就走紅線主動申報，申報不罰。</div>
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
        ${versionBarHtml()}
        <div class="r-actions no-print">
          <button id="copyText">📋 複製文字版行程</button>
          <button id="copyLink">🔗 複製行程連結分享</button>
          <button id="sheetBtn" class="gsbtn">📊 Google 試算表</button>
          <button id="printBtn">🖨️ 列印／存 PDF</button>
        </div>
      </header>
      ${dayHtml}
      ${shopHtml}
      <footer class="r-foot">
        <div class="tip">📱 <b>排隊神器：</b>多數名店可用 CatchTable（有外國人版 CatchTable Global App）遠端抽號；現場機台可輸入 Email 登記並拍下 QR Code 留存。</div>
        <div class="tip">💡 ${esc(CONFIG.rateNote)}</div>
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
  function showResult() {
    save();
    snapshotVersion();
    const plan = generate();
    renderResult(plan);
    $('#pick').style.display = 'none';
    $('#result').style.display = '';
    window.scrollTo({ top: 0 });
    try { history.replaceState(null, '', location.pathname + '?s=' + [...state.sel].sort().join('.') + (state.autoFill ? '' : '&af=0')); } catch (e) {}
  }
  function showPick() {
    $('#result').style.display = 'none';
    $('#pick').style.display = '';
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    renderChips(); renderGrid(); renderBar();
    window.scrollTo({ top: 0 });
  }

  /* ---------- 事件 ---------- */
  function bindEvents() {
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
    $('#sortrow').addEventListener('click', e => {
      const b = e.target.closest('[data-sort]'); if (!b) return;
      state.sort = b.dataset.sort; renderChips(); renderGrid();
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
    if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id);
    const on = state.sel.has(id);
    card.classList.toggle('on', on);
    card.setAttribute('aria-checked', on);
    card.querySelector('.tick').textContent = on ? '✓ 已選' : '＋ 選擇';
    save(); renderBar();
  }

  /* ---------- 啟動 ---------- */
  function init() {
    const shared = parseUrl();
    if (!shared) load();
    renderChips(); renderGrid(); renderBar(); bindEvents();
    if (shared && ready()) showResult();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
