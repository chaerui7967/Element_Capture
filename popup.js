const $ = (id) => document.getElementById(id);
const CHECKS = ['fitWidth', 'printBackground', 'screenMedia', 'expandScroll', 'saveAs'];

function readForm() {
  const s = {
    mode: document.querySelector('input[name=mode]:checked')?.value || 'single',
    orientation: document.querySelector('input[name=orientation]:checked')?.value || 'portrait',
    marginMm: Math.min(50, Math.max(0, Number($('marginMm').value) || 0))
  };
  CHECKS.forEach((k) => { s[k] = $(k).checked; });
  return s;
}

function render(s) {
  document.querySelector(`input[name=mode][value=${s.mode}]`).checked = true;
  document.querySelector(`input[name=orientation][value=${s.orientation}]`).checked = true;
  $('marginMm').value = s.marginMm;
  CHECKS.forEach((k) => { $(k).checked = !!s[k]; });
  $('a4Options').hidden = s.mode !== 'a4';
}

async function save() {
  const s = readForm();
  $('a4Options').hidden = s.mode !== 'a4';
  await chrome.storage.sync.set(s);
}

async function start() {
  $('error').textContent = '';
  $('start').disabled = true;
  await save();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const res = await chrome.runtime.sendMessage({ type: 'ecp-start-from-popup', tabId: tab.id });
  if (res?.ok) {
    window.close();
  } else {
    $('start').disabled = false;
    $('error').textContent = '이 페이지에서는 사용할 수 없습니다. 크롬 설정 페이지나 웹 스토어 같은 페이지는 확장 프로그램이 접근할 수 없습니다.';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  render(await chrome.storage.sync.get(ECP_DEFAULTS));
  document.body.addEventListener('change', save);
  $('start').addEventListener('click', start);
});
