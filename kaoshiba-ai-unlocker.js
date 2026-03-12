// ==UserScript==
// @name         考试宝 AI解析提取显示
// @namespace    https://www.kaoshibao.com/
// @version      1.0.0
// @description  提取页面中的 AI解析 并在页面右下角固定显示
// @author       You
// @match        https://www.kaoshibao.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TARGET_SELECTOR = '#body > div.middle-container.bj-eee > div.layout-container.prative-page > div.clearfix > div.layout-left.pull-left.lianxi-left > div > div.answer-box > div.answer-box-detail > div:nth-child(1) > div.answer-analysis-row.hide-height > div:nth-child(1) > p';
  const PANEL_ID = 'tm-ai-analysis-panel';
  let lastText = '';
  let timer = null;

  function getAnalysisText() {
    const el = document.querySelector(TARGET_SELECTOR);
    if (!el) return '';
    return (el.textContent || '').trim();
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'z-index:999999',
      'width:min(420px, calc(100vw - 32px))',
      'max-height:50vh',
      'overflow:auto',
      'padding:12px 14px',
      'border-radius:10px',
      'box-shadow:0 8px 28px rgba(0,0,0,.22)',
      'background:#ffffff',
      'color:#222',
      'font-size:14px',
      'line-height:1.6',
      'border:1px solid #e5e7eb'
    ].join(';');

    panel.innerHTML = [
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">',
      '  <strong style="font-size:15px;">AI解析</strong>',
      '  <button id="tm-ai-analysis-close" type="button" style="cursor:pointer;border:1px solid #ddd;background:#f8f8f8;border-radius:6px;padding:2px 8px;">关闭</button>',
      '</div>',
      '<div id="tm-ai-analysis-content" style="white-space:pre-wrap;word-break:break-word;"></div>'
    ].join('');

    document.body.appendChild(panel);

    const closeBtn = document.getElementById('tm-ai-analysis-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        panel.style.display = 'none';
      });
    }

    return panel;
  }

  function render(text) {
    const panel = ensurePanel();
    panel.style.display = 'block';

    const content = document.getElementById('tm-ai-analysis-content');
    if (!content) return;

    content.textContent = text || '未获取到 AI解析，请确认题目解析区域已展开。';
  }

  function update() {
    const text = getAnalysisText();
    if (text === lastText) return;
    lastText = text;
    render(text);
  }

  // 首次尝试
  update();

  // 监听 DOM 变化，处理异步加载和切题
  const observer = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(update, 120);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
