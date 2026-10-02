(() => {
  if (window.__ecpLoaded) return;
  window.__ecpLoaded = true;

  const A_TARGET = 'data-ecp-target';
  const A_ANC = 'data-ecp-anc';
  const A_HIDE = 'data-ecp-hide';
  const ACCENT = '#2563eb';

  let selecting = false;
  let current = null;
  let lastHover = null;        // 마우스가 마지막으로 가리킨 요소
  let downStack = [];          // ↑로 올라간 경로 (↓로 되돌아오기용)
  let ui = null;               // { host, box, label }
  let picked = null;
  let styleEl = null;
  let savedScroll = null;
  let toastHost = null;

  // ---------- 선택 UI ----------
  function buildUI() {
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .box { position: fixed; border: 2px solid ${ACCENT}; background: rgba(37,99,235,.12);
               box-sizing: border-box; transition: all .06s linear; }
        .label { position: absolute; left: -2px; top: -24px; max-width: 70vw; overflow: hidden;
                 white-space: nowrap; text-overflow: ellipsis; background: ${ACCENT}; color: #fff;
                 font: 12px/22px system-ui, "Malgun Gothic", sans-serif; padding: 0 8px; border-radius: 3px; }
        .label.inside { top: 2px; left: 2px; }
        .hint { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
                background: #0f172a; color: #e2e8f0; border-radius: 6px; padding: 8px 14px;
                font: 13px/1.4 system-ui, "Malgun Gothic", sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
        .hint b { color: #fff; font-weight: 600; }
      </style>
      <div class="box"><div class="label"></div></div>
      <div class="hint"><b>클릭</b> 캡처 &nbsp; <b>↑ ↓</b> 부모/자식 요소 &nbsp; <b>Enter</b> 캡처 &nbsp; <b>Esc</b> 취소</div>`;
    document.documentElement.appendChild(host);
    return { host, box: root.querySelector('.box'), label: root.querySelector('.label') };
  }

  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = [...el.classList].slice(0, 2);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  }

  function highlight(el) {
    current = el;
    if (!ui || !el) return;
    const r = el.getBoundingClientRect();
    Object.assign(ui.box.style, {
      left: r.left + 'px', top: r.top + 'px',
      width: Math.max(r.width, 1) + 'px', height: Math.max(r.height, 1) + 'px'
    });
    ui.label.textContent = `${describe(el)}  ${Math.round(r.width)} × ${Math.round(r.height)}`;
    ui.label.classList.toggle('inside', r.top < 26);
  }

  function selectable(el) {
    return el && el.nodeType === 1 && el !== document.documentElement && el !== ui?.host;
  }

  function onMove(e) {
    const el = e.target;
    if (selectable(el) && el !== lastHover) {
      lastHover = el;
      downStack = [];
      highlight(el);
    }
  }

  function block(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    block(e);
    const el = selectable(e.target) ? (current || e.target) : current;
    if (el) pick(el);
  }

  function onKey(e) {
    if (!selecting) return;
    if (e.key === 'Escape') { block(e); stopSelecting(); return; }
    if (e.key === 'Enter') { block(e); if (current) pick(current); return; }
    if (e.key === 'ArrowUp') {
      block(e);
      const p = current?.parentElement;
      if (p && p !== document.documentElement) { downStack.push(current); highlight(p); }
      return;
    }
    if (e.key === 'ArrowDown') {
      block(e);
      const next = downStack.pop() || current?.firstElementChild;
      if (next) highlight(next);
    }
  }

  function onScroll() { if (current) highlight(current); }

  const blocked = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'auxclick'];

  function startSelecting() {
    if (selecting) return;
    selecting = true;
    current = null;
    lastHover = null;
    downStack = [];
    ui = buildUI();
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('click', onClick, true);
    blocked.forEach((t) => document.addEventListener(t, block, true));
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
  }

  function stopSelecting() {
    selecting = false;
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    blocked.forEach((t) => document.removeEventListener(t, block, true));
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    ui?.host.remove();
    ui = null;
  }

  function pick(el) {
    stopSelecting();
    picked = el;
    showToast('PDF 만드는 중…', 'info', 0);
    chrome.runtime.sendMessage({ type: 'ecp-capture' });
  }

  // ---------- 출력 준비 ----------
  function isTransparent(color) {
    return !color || color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color);
  }

  function effectiveBackground(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (!isTransparent(c)) return c;
    }
    return '#ffffff';
  }

  async function waitImages(root, timeout = 4000) {
    const imgs = [...root.querySelectorAll('img')];
    if (root.tagName === 'IMG') imgs.push(root);
    imgs.forEach((img) => { if (img.loading === 'lazy') img.loading = 'eager'; });
    const waits = imgs.filter((img) => !img.complete).map((img) =>
      new Promise((res) => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); }));
    await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, timeout))]);
  }

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  async function prepare(settings) {
    const el = picked;
    if (!el || !el.isConnected) throw new Error('선택한 요소가 페이지에서 사라졌습니다. 다시 선택하세요.');
    hideToast();

    const cs = getComputedStyle(el);
    const isHtml = el instanceof HTMLElement;
    const rect = el.getBoundingClientRect();
    const width = Math.ceil(isHtml ? el.offsetWidth : rect.width) || Math.ceil(rect.width);
    const fixedHeight = Math.ceil(isHtml ? el.offsetHeight : rect.height);
    const scrollable = isHtml && el.scrollHeight > el.clientHeight + 1 &&
      /(auto|scroll|hidden)/.test(cs.overflowY);
    const expand = settings.expandScroll && scrollable;
    const bg = effectiveBackground(el);
    const needBg = isTransparent(cs.backgroundColor);

    savedScroll = { x: window.scrollX, y: window.scrollY };

    // 대상 → 조상 경로만 남기고 형제는 숨김
    el.setAttribute(A_TARGET, '');
    for (let node = el; node.parentElement; node = node.parentElement) {
      const parent = node.parentElement;
      parent.setAttribute(A_ANC, '');
      for (const sib of parent.children) {
        if (sib !== node) sib.setAttribute(A_HIDE, '');
      }
    }

    const tableParts = 'table,thead,tbody,tfoot,tr';
    styleEl = document.createElement('style');
    styleEl.textContent = `
      [${A_HIDE}] { display: none !important; }
      [${A_ANC}] {
        position: static !important; margin: 0 !important; padding: 0 !important; border: 0 !important;
        width: auto !important; min-width: 0 !important; max-width: none !important;
        height: auto !important; min-height: 0 !important; max-height: none !important;
        overflow: visible !important; transform: none !important; filter: none !important;
        background: transparent !important; box-shadow: none !important; float: none !important;
        opacity: 1 !important; clip-path: none !important; contain: none !important;
        columns: auto !important; translate: none !important; scale: none !important;
      }
      [${A_ANC}]:not(${tableParts}) { display: block !important; }
      html[${A_ANC}], body[${A_ANC}] { background: #fff !important; }
      [${A_TARGET}] {
        position: relative !important; inset: auto !important; margin: 0 !important; float: none !important;
        width: ${width}px !important; min-width: 0 !important; max-width: none !important;
        transform: none !important; translate: none !important; scale: none !important;
        flex: none !important; opacity: 1 !important; visibility: visible !important;
        ${expand
          ? `height: auto !important; max-height: none !important; min-height: ${fixedHeight}px !important; overflow: visible !important;`
          : `height: ${fixedHeight}px !important; max-height: none !important; min-height: 0 !important;`}
        ${needBg ? `background-color: ${bg} !important;` : ''}
        ${cs.display === 'block' ? 'display: flow-root !important;' : ''}
      }
      [${A_TARGET}], [${A_TARGET}] * { content-visibility: visible !important; }
      [${A_TARGET}] img, [${A_TARGET}] tr, [${A_TARGET}] figure { break-inside: avoid; }
    `;
    document.documentElement.appendChild(styleEl);
    styleEl.removeAttribute(A_HIDE);

    window.scrollTo(0, 0);
    await waitImages(el);
    await nextFrame();

    const r2 = el.getBoundingClientRect();
    const height = Math.ceil(Math.max(isHtml ? el.offsetHeight : r2.height, r2.height));
    if (!width || !height) throw new Error('선택한 요소의 크기가 0입니다. 다른 요소를 선택하세요.');
    return { ok: true, width, height, label: describe(el) };
  }

  function cleanup() {
    styleEl?.remove();
    styleEl = null;
    for (const a of [A_TARGET, A_ANC, A_HIDE]) {
      document.querySelectorAll(`[${a}]`).forEach((n) => n.removeAttribute(a));
    }
    if (savedScroll) window.scrollTo(savedScroll.x, savedScroll.y);
    savedScroll = null;
    picked = null;
  }

  // ---------- 알림 ----------
  function hideToast() { toastHost?.remove(); toastHost = null; }

  function showToast(text, kind = 'info', ms = 3500) {
    hideToast();
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    const colors = { info: '#0f172a', ok: '#15803d', error: '#b91c1c' };
    root.innerHTML = `<div style="background:${colors[kind] || colors.info};color:#fff;padding:10px 14px;border-radius:6px;
      font:13px/1.45 system-ui,'Malgun Gothic',sans-serif;max-width:360px;box-shadow:0 4px 16px rgba(0,0,0,.25)"></div>`;
    root.firstElementChild.textContent = text;
    document.documentElement.appendChild(host);
    toastHost = host;
    if (ms) setTimeout(() => { if (toastHost === host) hideToast(); }, ms);
  }

  // ---------- 메시지 ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case 'ecp-start':
        startSelecting();
        sendResponse({ ok: true });
        break;
      case 'ecp-prepare':
        prepare(msg.settings)
          .then(sendResponse)
          .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
        return true;
      case 'ecp-cleanup':
        cleanup();
        sendResponse({ ok: true });
        break;
      case 'ecp-toast':
        showToast(msg.text, msg.kind, msg.kind === 'error' ? 7000 : 3500);
        break;
    }
  });
})();
