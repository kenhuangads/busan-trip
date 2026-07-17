/* ============================================================
   2026 釜山五天四夜 — 互動行程規劃 App
   ============================================================ */
(function () {
  'use strict';

  const ALL = [...SPOTS, ...FOODS, ...SHOPS];
  const DB = {};
  ALL.forEach((it, idx) => { it._idx = idx; DB[it.id] = it; });

  const state = {
    sel: new Set(),
    tab: 'spot',            // spot | food | shop
    foodCat: 'all',
    shopCat: 'all',
    region: 'all',
    autoFill: true,
    fromShare: false
  };

  /* ---------- 工具 ---------- */
  const $ = (q, el) => (el || document).querySelector(q);
  const $$ = (q, el) => Array.from((el || document).querySelectorAll(q));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const gmap = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  const nmap = q => 'https://map.naver.com/p/search/' + encodeURIComponent(q);
  const gsearch = q => 'https://www.google.com/search?q=' + encodeURIComponent(q);
  const money = n => 'NT$' + Number(n).toLocaleString('en-US');

  function linkRow(links) {
    if (!links) return '';
    const a = [];
    if (links.g) a.push(`<a href="${gmap(links.g)}" target="_blank" rel="noopener">📍 Google地圖</a>`);
    if (links.o) a.push(`<a href="${esc(links.o)}" target="_blank" rel="noopener">🌐 官網／介紹</a>`);
    if (links.s) a.push(`<a href="${gsearch(links.s)}" target="_blank" rel="noopener">🔎 商品介紹</a>`);
    if (links.n) a.push(`<a href="${nmap(links.n)}" target="_blank" rel="noopener">🗺️ NAVER</a>`);
    return `<div class="links" onclick="event.stopPropagation()">${a.join('')}</div>`;
  }

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
     行程產生演算法（同樣勾選必產生同樣結果）
     ============================================================ */
  const SLOT_TIMES = {
    brunch: '09:00', morning: '10:15', lunch: '12:30', afternoon: '14:00',
    cafe: '15:45', sweet: '16:45', evening: '18:00', dinner: '19:15', night: '21:15',
    latelunch: '13:45', pmstroll: '15:30', pmcafe: '16:45', d1dinner: '18:30', d1night: '20:45',
    d5brunch: '09:00', d5shop: '10:15', d5lunch: '11:15'
  };
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
    d5brunch: ['brunch'], d5lunch: ['lunch']
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
    // 找出沒有任何項目的區域日，改派給項目最多的區域（第二天份）
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
          (!filter || filter(f)));
        if (cand.length) { suggested.add(cand[0].id); day.slots[slotKey] = { item: cand[0], suggest: true }; }
      };
      const d1 = days[0], d5 = days[4];
      // Day1 逢中秋連假 → 優先 24hr 店
      suggest(d1, 'latelunch', f => (f.tag || '').includes('24hr'));
      suggest(d1, 'latelunch');
      suggest(d1, 'd1dinner', f => (f.tag || '').includes('24hr'));
      suggest(d1, 'd1dinner');
      days.filter(d => d.full).forEach(d => { suggest(d, 'lunch'); suggest(d, 'dinner'); });
      suggest(d5, 'd5lunch');
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

    /* Day 5 固定：西面最後採購時段 */
    days[4].slots['d5shop'] = { anchor: {
      name: '西面最後採購：Olive Young 旗艦店＋樂天百貨／樂天超市',
      desc: '美妝、伴手禮最後掃貨並辦理退稅（同店單筆滿 15,000₩ 即可退），採買完回飯店打包行李',
      links: { g: '올리브영 부산 서면점', n: '롯데백화점 부산본점' }, shopping: true } };

    /* 購物清單分組（依店家所在區域 → 對應日） */
    const shopGroups = {};
    shops.forEach(it => {
      const c = it.cluster;
      let hint;
      if (c === 'seomyeon') hint = 'Day 1 傍晚／Day 5 上午・西面商圈';
      else {
        const d = days.find(dd => dd.cluster === c);
        hint = d ? `Day ${days.indexOf(d) + 1}・${CLUSTERS[c].short}順路` : `${CLUSTERS[c].short}周邊`;
      }
      (shopGroups[hint] = shopGroups[hint] || []).push(it);
    });

    /* 費用估算 */
    let cost = 0;
    [...spots, ...foods].forEach(it => { cost += it.est || 0; });
    let shopCost = 0;
    shops.forEach(it => { shopCost += it.est || 0; });

    return { days, shopGroups, cost, shopCost, sel, spots, foods, shops };
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
      ${priceLine}${waitLine}${it.area ? buyLine : ''}
      <p class="desc">${esc(it.desc)}</p>
      ${linkRow(it.links)}
    </div>`;
  }

  function renderGrid() {
    let list;
    if (state.tab === 'spot') list = SPOTS;
    else if (state.tab === 'food') list = state.foodCat === 'all' ? FOODS : FOODS.filter(f => f.cat === state.foodCat);
    else list = state.shopCat === 'all' ? SHOPS : SHOPS.filter(s => s.cat === state.shopCat);
    if (state.region !== 'all') list = list.filter(i => (i.flex || [i.cluster]).includes(state.region));
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
     畫面渲染 — 結果頁
     ============================================================ */
  function entryHtml(time, label, inner) {
    return `<div class="entry"><div class="t"><span class="clock">${time}</span><span class="slotlab">${label}</span></div><div class="e-body">${inner}</div></div>`;
  }
  function itemEntry(slotKey, cell) {
    const time = SLOT_TIMES[slotKey], label = SLOT_LABELS[slotKey];
    if (cell.anchor) {
      const a = cell.anchor;
      return entryHtml(time, label, `
        <div class="e-name">${a.shopping ? '🛍️' : '🚶'} ${esc(a.name)} <span class="badge free">${a.shopping ? '採購時間' : '免費散步'}</span></div>
        <div class="e-desc">${esc(a.desc)}</div>${linkRow(a.links)}`);
    }
    const it = cell.item;
    const ci = catInfo(it);
    return entryHtml(time, label, `
      <div class="e-name">${ci.icon} ${esc(it.name)}
        ${cell.suggest ? '<span class="badge sug">推薦補位・未勾選</span>' : ''}
        ${it.tag ? `<span class="badge tag">${esc(it.tag)}</span>` : ''}</div>
      <div class="e-meta">📌 ${esc(it.area || '')} ｜ 💰 ${esc(it.price || '')}</div>
      ${it.wait ? `<div class="e-meta sub">⏱ ${esc(it.wait)}</div>` : ''}
      <div class="e-desc">${esc(it.desc)}</div>${linkRow(it.links)}`);
  }

  function fixedEntry(time, text, sub) {
    return `<div class="entry fixed"><div class="t"><span class="clock">${time}</span><span class="slotlab">固定</span></div>
      <div class="e-body"><div class="e-name">${text}</div>${sub ? `<div class="e-meta sub">${sub}</div>` : ''}</div></div>`;
  }

  function renderResult(plan) {
    const t = CONFIG.trip;
    const c = counts();
    const dayHtml = plan.days.map((d, i) => {
      const cl = CLUSTERS[d.cluster];
      let rows = '';
      if (d.key === 'd1') {
        rows += fixedEntry('08:10', `✈️ ${t.outbound.dep}（${t.outbound.airline}）`, '建議 06:10 前抵達機場辦理報到與托運');
        rows += fixedEntry('11:30', '🛬 抵達金海國際機場', '韓國時間比台灣快 1 小時｜入境後可先領 WOWPASS／T-money');
        rows += fixedEntry('12:15', '🚉 機場 → 西面樂天飯店', '機場輕軌轉地鐵2號線約 40 分（每人約NT$40）／計程車約 25 分（約NT$430-540）');
        rows += fixedEntry('13:15', `🏨 ${t.hotel.name} 寄放行李`, '15:00 後正式入住｜' + esc(t.hotel.area) + ' ' +
          `<a href="${gmap(t.hotel.links.g)}" target="_blank" rel="noopener">📍地圖</a> <a href="${esc(t.hotel.links.o)}" target="_blank" rel="noopener">🌐官網</a>`);
      }
      if (d.key === 'd5') {
        rows += fixedEntry('08:30', '🧳 整理行李・辦理退房', '行李可寄放櫃台，中午回飯店領取');
      }
      d.slotKeys.forEach(k => { if (d.slots[k]) rows += itemEntry(k, d.slots[k]); });
      if (d.key === 'd5') {
        rows += fixedEntry('12:30', '🚕 前往金海國際機場', '計程車約 25 分；13:00 前抵達辦理退稅、報到與托運');
        rows += fixedEntry('15:00', `✈️ ${t.inbound.dep}（${t.inbound.airline}）`, '※回程起飛時間請以票面／訂位紀錄再確認');
        rows += fixedEntry('16:30', '🛬 抵達台中國際機場', '台灣時間｜歡迎回家 🎉');
      }
      const backup = d.backup.length ? `
        <div class="backup"><b>⏸ 同區備選（時間排不下，可自行替換）</b>${d.backup.map(it => {
          const ci = catInfo(it);
          return `<div class="bk-item">${ci.icon} ${esc(it.name)}｜💰 ${esc(it.price || '')} ${linkRow(it.links)}</div>`;
        }).join('')}</div>` : '';
      const dayTips = {
        d1: '🌕 ' + CONFIG.holidayNote,
        d2: '🌕 9/27（日）為中秋連假隔天的週日，海雲台一帶人潮較多，膠囊列車與熱門餐廳請務必提前預約／提早抽號。'
      };
      return `
      <section class="day" style="--c:${cl.color}">
        <header class="day-head">
          <div class="day-no">Day ${i + 1}</div>
          <div><h2>${d.date}｜${esc(d.theme)}</h2><div class="day-cl">${esc(cl.label)}</div></div>
        </header>
        ${dayTips[d.key] ? `<div class="tip holiday">${esc(dayTips[d.key])}</div>` : ''}
        <div class="tip">🚇 ${esc(TRANSIT[d.cluster])}</div>
        <div class="timeline">${rows}</div>
        ${backup}
      </section>`;
    }).join('');

    /* 勾選總覽（給老公審視用） */
    const placedIds = new Set();
    plan.days.forEach(d => d.slotKeys.forEach(k => {
      const cell = d.slots[k];
      if (cell && cell.item && !cell.suggest) placedIds.add(cell.item.id);
    }));
    const overview = plan.sel.filter(i => i.kind !== 'shop').map(it => {
      const inPlan = placedIds.has(it.id);
      return `<span class="ov ${inPlan ? 'in' : 'out'}">${inPlan ? '✅' : '⏸'} ${esc(it.name)}</span>`;
    }).join('');

    /* 購物清單 */
    let shopHtml = '';
    const groups = Object.keys(plan.shopGroups);
    if (groups.length) {
      shopHtml = `<section class="shoplist"><h2>🛍️ 採購清單（${plan.shops.length} 項）</h2>
        <p class="hint">💡 退稅提醒：同店單筆滿 15,000₩ 即可退稅，Olive Young／樂天Mart 可現場即時退稅；大型採買建議集中在 Day 5 上午西面一次完成。</p>
        ${groups.map(g => `<div class="shop-group"><h3>📍 ${esc(g)}</h3>${plan.shopGroups[g].map(it => {
          const ci = catInfo(it);
          const safeTxt = it.safe === 'warn' ? '<span class="badge warn">⚠️ 成分含肉禁帶</span>' :
            it.safe === 'ok-check' ? '<span class="badge note">須託運</span>' : '';
          return `<div class="shop-item"><div><b>${ci.icon} ${esc(it.name)}</b> ${safeTxt}<div class="e-meta sub">🏬 ${esc(it.buy)}｜💰 ${esc(it.price)}</div></div>${linkRow(it.links)}</div>`;
        }).join('')}</div>`).join('')}
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
            ${plan.shopCost ? `<div class="sub">購物清單全買約 ${money(plan.shopCost)}</div>` : ''}</div>
        </div>
        <div class="ov-wrap"><b>勾選總覽：</b>${overview}</div>
        <div class="r-actions no-print">
          <button id="copyText">📋 複製文字版行程</button>
          <button id="copyLink">🔗 複製給老公審核的連結</button>
          <button id="printBtn">🖨️ 列印／存 PDF</button>
        </div>
      </header>
      ${dayHtml}
      ${shopHtml}
      <footer class="r-foot">
        <div class="tip">📱 <b>排隊神器：</b>多數名店可用 CatchTable（有外國人版 CatchTable Global App）遠端抽號；現場機台可輸入 Email 登記並拍下 QR Code 留存。</div>
        <div class="tip">💡 ${esc(CONFIG.rateNote)}</div>
        <div class="tip">🎫 天空膠囊列車、遊艇、X the SKY 建議出發前 2 週完成線上預約；Spa Land 可先在 Klook/NOL 買優惠票。</div>
      </footer>`;

    $('#backBtn').addEventListener('click', () => { state.fromShare = false; showPick(); });
    $('#copyText').addEventListener('click', () => copyToClipboard(planText(plan), '#copyText', '📋 已複製！貼到 LINE 給老公吧'));
    $('#copyLink').addEventListener('click', () => copyToClipboard(shareUrl(), '#copyLink', '🔗 連結已複製！'));
    $('#printBtn').addEventListener('click', () => window.print());
  }

  /* 文字版行程（LINE 友善） */
  function planText(plan) {
    const t = CONFIG.trip;
    const L = [];
    L.push('🌊 2026 釜山五天四夜｜客製行程');
    L.push(`✈️ 去程 ${t.outbound.date} ${t.outbound.dep} → ${t.outbound.arr}`);
    L.push(`✈️ 回程 ${t.inbound.date} ${t.inbound.dep} → ${t.inbound.arr}`);
    L.push(`🏨 ${t.hotel.name}（西面站）`);
    plan.days.forEach((d, i) => {
      L.push('────────────');
      L.push(`📅 Day ${i + 1} ${d.date}｜${d.theme}`);
      if (d.key === 'd1') { L.push('　08:10 台中出發（星宇）'); L.push('　11:30 抵達金海機場 → 西面樂天飯店'); }
      if (d.key === 'd5') { L.push('　08:30 退房寄行李'); }
      d.slotKeys.forEach(k => {
        const cell = d.slots[k];
        if (!cell) return;
        if (cell.anchor) { L.push(`　${SLOT_TIMES[k]} ${cell.anchor.name}${cell.anchor.shopping ? '' : '（免費）'}`); return; }
        const it = cell.item;
        L.push(`　${SLOT_TIMES[k]} ${it.name}${cell.suggest ? '（推薦補位）' : ''}｜${it.price || ''}`);
      });
      d.backup.forEach(it => L.push(`　⏸ 備選：${it.name}`));
      if (d.key === 'd5') { L.push('　12:30 前往金海機場'); L.push('　15:00 起飛 → 16:30 抵台中'); }
    });
    if (plan.shops.length) {
      L.push('────────────');
      L.push(`🛍️ 採購清單（${plan.shops.length}項）`);
      plan.shops.forEach(it => L.push(`　□ ${it.name}｜${it.price}`));
    }
    L.push('────────────');
    L.push(`💰 預估每人餐飲＋門票：約 ${money(plan.cost)}（不含機酒交通購物）`);
    L.push(`🔗 互動版連結：${shareUrl()}`);
    return L.join('\n');
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
