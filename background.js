importScripts('settings.js');

const MM_PER_IN = 25.4;
const PX_PER_IN = 96;                 // CSS px 기준
const A4_IN = { w: 210 / MM_PER_IN, h: 297 / MM_PER_IN };
const MAX_PAGE_IN = 200;              // PDF 한 페이지 최대 크기(14400pt) 근처로 제한
const busyTabs = new Set();

async function getSettings() {
  return chrome.storage.sync.get(ECP_DEFAULTS);
}

async function startSelection(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  await chrome.tabs.sendMessage(tabId, { type: 'ecp-start' });
}

function dbg(target, method, params = {}) {
  return chrome.debugger.sendCommand(target, method, params);
}

function buildPrintParams(s, { width, height }) {
  const m = Math.max(0, Number(s.marginMm) || 0) / MM_PER_IN;
  const base = {
    printBackground: !!s.printBackground,
    preferCSSPageSize: false,
    displayHeaderFooter: false,
    marginTop: m, marginBottom: m, marginLeft: m, marginRight: m,
    transferMode: 'ReturnAsBase64'
  };

  if (s.mode === 'a4') {
    const landscape = s.orientation === 'landscape';
    const pw = landscape ? A4_IN.h : A4_IN.w;
    const ph = landscape ? A4_IN.w : A4_IN.h;
    const printablePx = (pw - 2 * m) * PX_PER_IN;
    let scale = s.fitWidth ? Math.min(1, printablePx / (width + 1)) : 1;
    if (scale < 0.1) throw new Error('요소 폭이 너무 넓어 A4에 맞출 수 없습니다. 가로 방향이나 한 장 모드를 사용하세요.');
    return {
      params: { ...base, paperWidth: pw, paperHeight: ph, scale },
      note: scale < 1 ? `용지 폭에 맞춰 ${Math.round(scale * 100)}%로 축소` : ''
    };
  }

  // 한 장짜리: 용지 크기를 요소 크기에 맞춤
  const wIn = (width + 1) / PX_PER_IN;
  const hIn = (height + 2) / PX_PER_IN;
  const maxContent = MAX_PAGE_IN - 2 * m;
  const scale = Math.min(1, maxContent / hIn, maxContent / wIn);
  if (scale < 0.1) throw new Error('요소가 너무 길어 한 장에 담을 수 없습니다. A4 분할 모드를 사용하세요.');
  return {
    params: {
      ...base,
      paperWidth: wIn * scale + 2 * m,
      paperHeight: hIn * scale + 2 * m,
      scale,
      pageRanges: '1'               // 반올림 오차로 생기는 빈 두 번째 페이지 방지
    },
    note: scale < 1 ? `한 장 최대 크기 제한으로 ${Math.round(scale * 100)}%로 축소` : ''
  };
}

function makeFilename(title, label) {
  const clean = (str) => (str || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const name = clean(title).slice(0, 60) || clean(label).slice(0, 40) || 'capture';
  return `${name}_${stamp}.pdf`;
}

function toast(tabId, text, kind) {
  chrome.tabs.sendMessage(tabId, { type: 'ecp-toast', text, kind }).catch(() => {});
}

async function capture(tab) {
  const tabId = tab.id;
  if (busyTabs.has(tabId)) return;
  busyTabs.add(tabId);

  const target = { tabId };
  const s = await getSettings();
  let attached = false, prepared = false, result;

  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    if (s.screenMedia) await dbg(target, 'Emulation.setEmulatedMedia', { media: 'screen' });

    prepared = true;
    const info = await chrome.tabs.sendMessage(tabId, { type: 'ecp-prepare', settings: s });
    if (!info || !info.ok) throw new Error(info?.error || '요소를 준비하지 못했습니다.');

    const { params, note } = buildPrintParams(s, info);
    const { data } = await dbg(target, 'Page.printToPDF', params);

    await chrome.downloads.download({
      url: 'data:application/pdf;base64,' + data,
      filename: makeFilename(tab.title, info.label),
      saveAs: !!s.saveAs,
      conflictAction: 'uniquify'
    });
    result = { text: 'PDF를 저장했습니다' + (note ? ` (${note})` : ''), kind: 'ok' };
  } catch (e) {
    result = { text: 'PDF 저장 실패: ' + (e?.message || String(e)), kind: 'error' };
  } finally {
    if (prepared) await chrome.tabs.sendMessage(tabId, { type: 'ecp-cleanup' }).catch(() => {});
    if (attached) {
      await dbg(target, 'Emulation.setEmulatedMedia', { media: '' }).catch(() => {});
      await chrome.debugger.detach(target).catch(() => {});
    }
    busyTabs.delete(tabId);
  }
  toast(tabId, result.text, result.kind);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ecp-start-from-popup') {
    startSelection(msg.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
    return true;
  }
  if (msg.type === 'ecp-capture' && sender.tab) {
    capture(sender.tab);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'start-selection' && tab?.id != null) {
    startSelection(tab.id).catch(() => {});
  }
});
