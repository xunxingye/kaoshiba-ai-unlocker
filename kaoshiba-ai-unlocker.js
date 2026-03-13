// ==UserScript==
// @name         考试宝 AI解析 & 纯净模式
// @namespace    https://www.kaoshibao.com/
// @version      2.3.0
// @description  提取并显示 AI解析；支持纯净模式、暗色模式；浮窗支持拖动和四角位置预设
// @author       You
// @match        https://www.kaoshibao.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /* ─────────────────── 常量 / 选择器 ─────────────────── */
  const AI_SELECTOR =
    '#body > div.middle-container.bj-eee > div.layout-container.prative-page > div.clearfix > div.layout-left.pull-left.lianxi-left > div > div.answer-box > div.answer-box-detail > div:nth-child(1) > div.answer-analysis-row.hide-height > div:nth-child(1) > p';

  const STORAGE_KEY  = 'tm_ksb_settings';
  const PANEL_ID     = 'tm-ksb-panel';
  const CTRL_ID      = 'tm-ksb-ctrl';
  const STYLE_ID     = 'tm-ksb-optimize-style';
  const DARK_STYLE_ID = 'tm-ksb-dark-style';

  /* ─────────────────── 持久化设置 ─────────────────── */
  const DEFAULT_SETTINGS = {
    pureMode: true,      // 纯净模式（原页面优化）
    darkMode: false,
    pos: { right: 16, bottom: 16 },   // 浮窗位置（right/bottom 或 left/top，见 posMode）
    posMode: 'rb',                     // tl | tr | bl | br | custom
    collapsed: false,
  };

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      // 兼容旧配置 pageOptimize -> pureMode
      if ('pageOptimize' in saved && !('pureMode' in saved)) {
        saved.pureMode = saved.pageOptimize;
        delete saved.pageOptimize;
      }
      return Object.assign({}, DEFAULT_SETTINGS, saved);
    } catch { return { ...DEFAULT_SETTINGS }; }
  }

  function saveSettings(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  let cfg = loadSettings();

  /* ─────────────────── 纯净模式 CSS ─────────────────── */
  const PURE_MODE_CSS = `
    /* 取消解析区折叠高度限制，让 AI解析可见（供脚本获取内容） */
    .answer-analysis-row.hide-height { max-height: none !important; overflow: visible !important; }
    .hide-height-mask { display: none !important; }

    /* 确保解析区域在DOM中存在（供脚本读取），但隐藏可视显示 */
    .answer-box-detail { 
      display: block !important; 
      visibility: hidden !important; 
      position: absolute !important; 
      left: -9999px !important; 
      width: 1px !important; 
      height: 1px !important; 
      overflow: hidden !important; 
    }
    .answer-analysis-row { display: block !important; visibility: hidden !important; }
    .answer-analysis-row > div { display: block !important; }
    .answer-analysis-row p { display: block !important; }

    /* 增大题目/选项字号，保持原有布局宽度 */
    .subject-box .subject-content,
    .subject-wrap .content,
    .lianxi-left .subject-text { font-size: 17px !important; line-height: 1.9 !important; }
    .option-list .option-item,
    .option-item .item-content { font-size: 16px !important; line-height: 1.85 !important; }

    /* 题干/选项区字间距提升可读性 */
    .subject-text, .option-item { letter-spacing: .025em; }

    /* 默认折叠页面内置设置面板（只折叠内容，保留标题行可手动展开） */
    .setting-box .setting-content,
    .set-box .set-content,
    .pratic-set .set-body,
    .config-panel .config-body { display: none !important; }

    /* 滚动条美化 */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-thumb { background: #c1c1c1; border-radius: 3px; }
  `;

  /* 纯净模式：删除 VIP 权益内容，但保留 AI 解析区域 */
  function removeClutterElements() {
    // 删除明确的VIP相关元素
    const selectors = [
      '.vip-quanyi',
      '.vip-row', '.vip-box', '.vip-info', '.vip-equity',
      '.equity-wrap', '.equity-box', '.member-equity',
      '.vip-tips', '.vip-mask', '.vip-banner', '.vip-limit',
      '.lock-vip', '.ban-vip', '.upgrade-vip',
      '.rights-box', '.rights-row', '.rights-wrap'
    ];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.remove());
    });

    // 精确删除答案详情区中的VIP内容，但保留AI解析
    document.querySelectorAll('.answer-box-detail').forEach(detailBox => {
      // 保留包含AI解析的区域（通过检查是否包含解析内容）
      const hasAnalysis = detailBox.querySelector('.answer-analysis-row') || 
                         detailBox.textContent.includes('解析') ||
                         detailBox.textContent.includes('分析');
      
      if (!hasAnalysis) {
        // 如果没有解析内容，可以安全删除
        detailBox.remove();
      } else {
        // 如果有解析内容，只删除其中的VIP相关子元素
        const vipSelectors = [
          '.vip-content', '.vip-notice', '.member-only', 
          '.upgrade-notice', '.pay-notice', '.lock-content',
          '[class*="vip"]', '[class*="member"]', '[class*="pay"]'
        ];
        vipSelectors.forEach(vipSel => {
          detailBox.querySelectorAll(vipSel).forEach(vipEl => {
            // 额外检查：确保不删除包含"解析"关键词的元素
            if (!vipEl.textContent.includes('解析') && !vipEl.textContent.includes('分析')) {
              vipEl.remove();
            }
          });
        });
      }
    });
  }

  /* ─────────────────── 暗色模式 CSS ─────────────────── */
  /*
   * 三层配色策略：
   *   L0 页面底层背景     #101318  (纯黑)
   *   L1 内容卡片/面板    #1e232e  (深灰)
   *   L2 次级元素/输入    #272e3c  (灰)
   *   L3 悬停/高亮       #303848  (浅灰)
   *   边框               #3b4455
   *   文字               #e8edf5  (主) / #9aa5ba (次)
   */
  const DARK_CSS = `
    :root {
      --dk-bg:      #101318;
      --dk-s1:      #1e232e;
      --dk-s2:      #272e3c;
      --dk-s3:      #303848;
      --dk-bd:      #3b4455;
      --dk-tx:      #e8edf5;
      --dk-tx2:     #9aa5ba;
      --dk-blue:    #3b7de8;
      --dk-green:   #206940;
      --dk-red:     #6e2828;
    }

    /* === L0 最外层背景（唯一纯黑区域） === */
    html, body, #body, #app, #__nuxt, #__layout,
    .middle-container, .middle-container.bj-eee,
    .bj-eee, .bj-f5, .bj-f6, .bj-fff {
      background-color: var(--dk-bg) !important;
      color: var(--dk-tx) !important;
    }

    /* 透明过渡层，不加背景色避免叠深 */
    .layout-container, .layout-container.prative-page,
    .clearfix, .page-container, .main-container,
    .content-container {
      background-color: transparent !important;
    }

    /* === L1 主要内容卡片（深灰）=== */
    /* 左侧刷题区 */
    .layout-left, .lianxi-left, .lianxi-left > div,
    .lianxi-box, .pratic-wrap, .lianxi-wrap,
    .subject-box, .subject-wrap, .subject-container,
    .item-box, .question-box, .question-wrap,
    /* 答案解析区 */
    .answer-box, .answer-wrap, .answer-container,
    .answer-analysis-row, .analysis-box, .analysis-wrap,
    .answer-right, .answer-right-box,
    .right-answer-box, .correct-answer,
    /* 右侧答题卡 */
    .layout-right, .layout-right.pull-right,
    .answer-card, .answer-card-box, .card-box,
    .card-wrap, .card-list-wrap, .card-container,
    .card-content, .card-header, .card-body,
    .datika-box, .datika-wrap,
    /* 设置面板 */
    .setting-box, .set-box, .pratic-set,
    .config-panel, .set-panel, .settings-wrap,
    .setting-content, .set-content, .set-body,
    /* 笔记区 */
    .note-box, .note-wrap, .biji-box, .biji-wrap,
    .note-list, .memo-box, .note-container,
    /* 标签栏 / 功能区 */
    .tab-box, .action-bar, .func-bar,
    .shoucang-box, .collect-box, .tabs-wrap,
    /* 弹窗 */
    .modal, .dialog, .popup, .modal-content, .dialog-content {
      background-color: var(--dk-s1) !important;
      border-color: var(--dk-bd) !important;
      color: var(--dk-tx) !important;
    }

    /* === L2 次级元素（灰）=== */
    /* 选项 */
    .option-item, .option-box,
    /* 次级卡片 */
    .answer-card .summary-box, .answer-card .result-box,
    .answer-card .tongji-box, .answer-card .tj-box,
    .answer-card .btn-box, .card-footer, .card-stat, .card-total,
    /* 设置行 */
    .setting-row, .set-row, .set-item,
    .setting-header, .set-header, .set-title,
    /* 输入控件 */
    input, select, textarea,
    .note-box textarea, .biji-textarea,
    /* 题号 */
    .num-item, .num-box, .card-num, .topic-num,
    /* 普通按钮 */
    .btn, button, .btn-default, .btn-white, .btn-normal {
      background-color: var(--dk-s2) !important;
      border-color: var(--dk-bd) !important;
      color: var(--dk-tx) !important;
    }

    /* === L3 悬停 / 激活状态 === */
    .option-item:hover, .option-box:hover,
    .num-item:hover, button:hover, .btn:hover {
      background-color: var(--dk-s3) !important;
    }

    /* 选中选项 */
    .option-item.active, .option-item.selected,
    .option-box.active, .option-box.selected {
      background-color: #1e3a6a !important;
      border-color: #4f86f7 !important;
    }
    /* 正确选项 */
    .option-item.right-answer, .option-item.right,
    .option-item.correct, .option-item.true {
      background-color: #1a4233 !important;
      border-color: #2ea86b !important;
    }
    /* 错误选项 */
    .option-item.wrong-answer, .option-item.wrong,
    .option-item.error, .option-item.false {
      background-color: #4a1f1f !important;
      border-color: #c94040 !important;
    }

    /* 答题卡题号状态 */
    .num-item.active, .num-item.current {
      background-color: var(--dk-blue) !important;
      color: #fff !important;
    }
    .num-item.right, .num-item.correct {
      background-color: var(--dk-green) !important;
      color: #7de0a8 !important;
    }
    .num-item.wrong, .num-item.error {
      background-color: var(--dk-red) !important;
      color: #f08080 !important;
    }
    .num-item.answered, .num-item.done {
      background-color: #254d70 !important;
      color: #c0d8f0 !important;
    }

    /* === 全局文字颜色 === */
    /* 主文字 */
    body, p, h1, h2, h3, h4, h5, h6,
    span, div, label, li, td, th,
    .subject-text, .subject-content,
    .option-item *, .option-box *,
    .answer-box *, .answer-wrap *, .answer-right *,
    .layout-right *, .card-box *, .datika-box *,
    .setting-box *, .set-box *, .settings-wrap *,
    .note-box *, .biji-box *, .tab-box *,
    .modal *, .dialog * {
      color: var(--dk-tx) !important;
    }
    /* 次要文字 */
    .muted, .text-muted, .secondary,
    .breadcrumb *, .bread-crumb *,
    small, .small, .hint, .tip-text {
      color: var(--dk-tx2) !important;
    }
    /* 链接 */
    a { color: #6ab0ff !important; }
    a:hover { color: #90c8ff !important; }

    /* 主色按钮保持原色不暗化 */
    .btn-primary, .btn-blue, button.primary {
      background-color: var(--dk-blue) !important;
      border-color: var(--dk-blue) !important;
      color: #fff !important;
    }
    .btn-success, .btn-green {
      background-color: var(--dk-green) !important;
      border-color: var(--dk-green) !important;
      color: #fff !important;
    }

    /* === 导航顶栏 === */
    header, .header, .page-nav, .nav-bar,
    .top-bar, .header-wrap, .navbar, .top-header {
      background-color: #13171f !important;
      border-color: var(--dk-bd) !important;
    }
    header *, .header *, .nav-bar *, .navbar *,
    .top-bar *, .page-nav * {
      color: var(--dk-tx) !important;
    }

    /* === 开关控件 === */
    .switch, .el-switch__core, .ivu-switch, .ant-switch {
      background-color: #505a6e !important;
      border-color: #505a6e !important;
    }
    .switch.is-checked, .el-switch.is-checked .el-switch__core,
    .ivu-switch-checked, .ant-switch-checked {
      background-color: var(--dk-blue) !important;
      border-color: var(--dk-blue) !important;
    }

    /* === 内联白底兜底（CSS 属性选择器） === */
    :not(#tm-ksb-panel):not(#tm-ksb-settings-modal):not(#tm-ksb-ctrl)
      [style*="background:#fff"],
    :not(#tm-ksb-panel):not(#tm-ksb-settings-modal):not(#tm-ksb-ctrl)
      [style*="background: #fff"],
    :not(#tm-ksb-panel):not(#tm-ksb-settings-modal):not(#tm-ksb-ctrl)
      [style*="background-color:#fff"],
    :not(#tm-ksb-panel):not(#tm-ksb-settings-modal):not(#tm-ksb-ctrl)
      [style*="background-color: #fff"],
    :not(#tm-ksb-panel):not(#tm-ksb-settings-modal):not(#tm-ksb-ctrl)
      [style*="background: white"],
    :not(#tm-ksb-panel):not(#tm-ksb-settings-modal):not(#tm-ksb-ctrl)
      [style*="background-color: white"],
    :not(#tm-ksb-panel):not(#tm-ksb-settings-modal):not(#tm-ksb-ctrl)
      [style*="background: rgb(255, 255, 255)"],
    :not(#tm-ksb-panel):not(#tm-ksb-settings-modal):not(#tm-ksb-ctrl)
      [style*="background-color: rgb(255, 255, 255)"],
    :not(#tm-ksb-panel):not(#tm-ksb-settings-modal):not(#tm-ksb-ctrl)
      [style*="background: rgb(245"],
    :not(#tm-ksb-panel):not(#tm-ksb-settings-modal):not(#tm-ksb-ctrl)
      [style*="background: rgb(238"],
    :not(#tm-ksb-panel):not(#tm-ksb-settings-modal):not(#tm-ksb-ctrl)
      [style*="background: rgb(250"],
    :not(#tm-ksb-panel):not(#tm-ksb-settings-modal):not(#tm-ksb-ctrl)
      [style*="background: #f"] {
      background-color: var(--dk-s1) !important;
      color: var(--dk-tx) !important;
    }

    /* === 分隔线 === */
    hr, .divider, .separator {
      border-color: var(--dk-bd) !important;
      background-color: var(--dk-bd) !important;
    }

    /* === 占位符 === */
    ::placeholder { color: #606778 !important; }

    /* === 滚动条 === */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #0e1116 !important; }
    ::-webkit-scrollbar-thumb { background: #3c4760 !important; border-radius: 3px; }

    /* === 图标 === */
    .iconfont, [class*="icon-"] { color: var(--dk-tx) !important; }

    /* === 脚本浮窗（使用 L1 配色，不受通用规则影响）=== */
    #tm-ksb-panel {
      background: var(--dk-s1) !important;
      color: var(--dk-tx) !important;
      border-color: var(--dk-bd) !important;
    }
    #tm-ksb-panel-header {
      background: #171c26 !important;
      border-color: var(--dk-bd) !important;
    }
    #tm-ksb-panel-header * { color: var(--dk-tx) !important; }
    #tm-ksb-panel button {
      background: var(--dk-s2) !important;
      color: var(--dk-tx) !important;
      border-color: var(--dk-bd) !important;
    }
    #tm-ksb-panel-body { color: var(--dk-tx) !important; }

    /* 脚本设置弹窗 */
    #tm-ksb-settings-modal {
      background: var(--dk-s1) !important;
      color: var(--dk-tx) !important;
      border-color: var(--dk-bd) !important;
    }
    #tm-ksb-settings-modal * { color: var(--dk-tx) !important; }
    #tm-ksb-settings-modal hr,
    #tm-ksb-settings-modal [style*="border-top"] {
      border-color: var(--dk-bd) !important;
    }
    #tm-ksb-settings-modal button[data-pos] {
      background: var(--dk-s2) !important;
      border-color: var(--dk-bd) !important;
      color: var(--dk-tx) !important;
    }
    #tm-ksb-settings-modal button[data-pos]:hover {
      background: var(--dk-s3) !important;
    }
    /* 开关滑块圆点 */
    #tm-ksb-settings-modal span[id$="slider"] > span,
    #tm-ksb-settings-modal span[id*="slider"] > span {
      background: #fff !important;
    }

    /* 迷你控制按钮 */
    #tm-ksb-ctrl {
      background: var(--dk-s1) !important;
      color: var(--dk-tx) !important;
      border-color: var(--dk-bd) !important;
    }
  `;

  function applyPureMode(enable) {
    let el = document.getElementById(STYLE_ID);
    if (enable) {
      if (!el) {
        el = document.createElement('style');
        el.id = STYLE_ID;
        document.head.appendChild(el);
      }
      el.textContent = PURE_MODE_CSS;
      // 直接删除杂乱元素
      removeClutterElements();
    } else {
      if (el) el.remove();
    }
  }

  function parseCssColor(value) {
    if (!value) return null;
    const normalized = value.replace(/\s+/g, '');
    if (normalized === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

    const rgbMatch = normalized.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/i);
    if (rgbMatch) {
      return {
        r: Number(rgbMatch[1]),
        g: Number(rgbMatch[2]),
        b: Number(rgbMatch[3]),
        a: rgbMatch[4] === undefined ? 1 : Number(rgbMatch[4])
      };
    }

    const hexMatch = normalized.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if (hexMatch) {
      const hex = hexMatch[1];
      const fullHex = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex;
      return {
        r: parseInt(fullHex.slice(0, 2), 16),
        g: parseInt(fullHex.slice(2, 4), 16),
        b: parseInt(fullHex.slice(4, 6), 16),
        a: 1
      };
    }

    return null;
  }

  function isLightColor(color, alphaThreshold = 0.65) {
    if (!color || color.a < alphaThreshold) return false;
    const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    return luminance >= 180;
  }

  function isDarkText(color) {
    if (!color || color.a < 0.6) return false;
    const luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
    return luminance <= 135;
  }

  function shouldSkipDarkFix(el, skipIds) {
    if (!el || !(el instanceof HTMLElement)) return true;
    if (skipIds.has(el.id)) return true;

    let current = el;
    while (current) {
      if (skipIds.has(current.id)) return true;
      current = current.parentElement;
    }

    if (el.tagName === 'IMG' || el.tagName === 'VIDEO' || el.tagName === 'CANVAS') return true;
    return false;
  }

  /* 运行时修复无法被 CSS 覆盖的浅色背景、浅边框和深色文字 */
  function fixInlineStyles() {
    const SKIP_IDS = new Set([PANEL_ID, CTRL_ID, 'tm-ksb-settings-modal']);
    const candidates = new Set();
    const scopeSelectors = [
      '.layout-right', '.layout-right *',
      '.answer-card', '.answer-card *',
      '.card-box', '.card-box *',
      '.setting-box', '.setting-box *',
      '.set-box', '.set-box *',
      '.pratic-set', '.pratic-set *',
      '.config-panel', '.config-panel *',
      '.answer-right', '.answer-right *',
      '.note-box', '.note-box *',
      '.biji-box', '.biji-box *',
      '[style]'
    ];

    scopeSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => candidates.add(el));
    });

    candidates.forEach(el => {
      if (shouldSkipDarkFix(el, SKIP_IDS)) return;

      const computed = getComputedStyle(el);
      const bg = parseCssColor(computed.backgroundColor);
      const color = parseCssColor(computed.color);
      const borderTop = parseCssColor(computed.borderTopColor);
      const borderRight = parseCssColor(computed.borderRightColor);
      const borderBottom = parseCssColor(computed.borderBottomColor);
      const borderLeft = parseCssColor(computed.borderLeftColor);

      const hasLightBg = isLightColor(bg);
      const hasLightBorder = [borderTop, borderRight, borderBottom, borderLeft].some(border => isLightColor(border, 0.45));
      const hasDarkText = isDarkText(color);

      if (hasLightBg) {
        el.style.setProperty('background-color', '#1e232e', 'important');
        el.style.setProperty('background-image', 'none', 'important');
      }

      if (hasLightBorder) {
        el.style.setProperty('border-color', '#3b4455', 'important');
      }

      if ((hasLightBg || hasDarkText) && !el.matches('.num-item.right, .num-item.correct, .num-item.wrong, .num-item.error, .num-item.active, .num-item.current')) {
        el.style.setProperty('color', '#e8edf5', 'important');
      }
    });
  }

  function applyDarkMode(enable) {
    let el = document.getElementById(DARK_STYLE_ID);
    if (enable) {
      if (!el) {
        el = document.createElement('style');
        el.id = DARK_STYLE_ID;
        document.head.appendChild(el);
      }
      el.textContent = DARK_CSS;
      // 补几次延迟修复，处理异步渲染出来的右栏/设置模块
      setTimeout(fixInlineStyles, 80);
      setTimeout(fixInlineStyles, 300);
      setTimeout(fixInlineStyles, 800);
    } else {
      if (el) el.remove();
    }
  }

  /* 折叠页面内置「设置」面板（JS兜底，CSS已隐藏内容区） */
  function collapseBuiltinSettings() {
    // 尝试多种选择器，找到内置设置面板后模拟点击其收起按钮
    const candidates = [
      '.setting-box',
      '.set-box',
      '.pratic-set',
      '.config-panel',
      '.set-panel',
    ];
    for (const sel of candidates) {
      const box = document.querySelector(sel);
      if (!box) continue;
      // 找标题行中的箭头/toggle按钮并点击
      const toggle = box.querySelector('.set-title, .setting-title, .title-bar, .fold-btn, [class*="arrow"], [class*="toggle"]');
      if (toggle) { toggle.click(); return; }
      // 没有按钮时直接收起内容
      const body = box.querySelector('.set-content, .setting-content, .set-body');
      if (body) { body.style.display = 'none'; return; }
    }
  }

  /* ─────────────────── 浮窗定位 ─────────────────── */
  const PRESETS = {
    tl: { top: 16,    left:  16,  bottom: 'auto', right: 'auto' },
    tr: { top: 16,    right: 16,  bottom: 'auto', left:  'auto' },
    bl: { bottom: 16, left:  16,  top:    'auto', right: 'auto' },
    br: { bottom: 16, right: 16,  top:    'auto', left:  'auto' },
  };

  function applyPos(panel) {
    const mode = cfg.posMode;
    if (mode in PRESETS) {
      const p = PRESETS[mode];
      Object.assign(panel.style, {
        top:    p.top    !== 'auto' ? p.top    + 'px' : 'auto',
        left:   p.left   !== 'auto' ? p.left   + 'px' : 'auto',
        right:  p.right  !== 'auto' ? p.right  + 'px' : 'auto',
        bottom: p.bottom !== 'auto' ? p.bottom + 'px' : 'auto',
      });
    } else {
      // custom: 保存的是 { top, left }（绝对像素）
      const { top = 16, left = 16 } = cfg.pos || {};
      Object.assign(panel.style, {
        top: top + 'px', left: left + 'px',
        right: 'auto',   bottom: 'auto',
      });
    }
  }

  /* ─────────────────── 拖动逻辑 ─────────────────── */
  function makeDraggable(panel, handle) {
    let ox = 0, oy = 0, dragging = false;

    handle.style.cursor = 'move';

    handle.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      // 切换为 top/left 定位模式
      Object.assign(panel.style, {
        top: rect.top + 'px', left: rect.left + 'px',
        right: 'auto', bottom: 'auto',
      });
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const x = Math.max(0, Math.min(e.clientX - ox, window.innerWidth  - panel.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - oy, window.innerHeight - panel.offsetHeight));
      panel.style.left = x + 'px';
      panel.style.top  = y + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      cfg.posMode = 'custom';
      cfg.pos = {
        top:  parseInt(panel.style.top,  10) || 0,
        left: parseInt(panel.style.left, 10) || 0,
      };
      saveSettings(cfg);
    });
  }

  /* ─────────────────── 设置面板 UI ─────────────────── */
  function buildSettingsModal() {
    const modal = document.createElement('div');
    modal.id = 'tm-ksb-settings-modal';
    modal.style.cssText = `
      display:none; position:fixed; z-index:1000001;
      top:50%; left:50%; transform:translate(-50%,-50%);
      background:#fff; border:1px solid #ddd; border-radius:12px;
      padding:20px 24px; width:280px;
      box-shadow:0 12px 40px rgba(0,0,0,.18); font-size:14px; color:#222;
    `;

    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <strong style="font-size:15px;">⚙️ 脚本设置</strong>
        <button id="tm-ksb-modal-close" style="cursor:pointer;border:none;background:none;font-size:18px;line-height:1;color:#888;">×</button>
      </div>

      <!-- 纯净模式开关 -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid #f0f0f0;">
        <div>
          <div style="font-weight:600;">纯净模式</div>
          <div style="font-size:12px;color:#888;margin-top:2px;">移除VIP广告 · 展开解析区</div>
        </div>
        <label id="tm-ksb-toggle-wrap" style="position:relative;display:inline-block;width:40px;height:22px;cursor:pointer;">
          <input type="checkbox" id="tm-ksb-pure-toggle" style="opacity:0;width:0;height:0;">
          <span id="tm-ksb-slider" style="
            position:absolute;inset:0;border-radius:22px;transition:.25s;
            background:${cfg.pureMode ? '#4f86f7' : '#ccc'};
          ">
            <span style="
              position:absolute;top:3px;left:3px;width:16px;height:16px;
              border-radius:50%;background:#fff;transition:.25s;
              transform:${cfg.pureMode ? 'translateX(18px)' : 'translateX(0)'};
            "></span>
          </span>
        </label>
      </div>

      <!-- 暗色模式开关 -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid #f0f0f0;">
        <div>
          <div style="font-weight:600;">暗色模式</div>
          <div style="font-size:12px;color:#888;margin-top:2px;">深色背景，保护视力</div>
        </div>
        <label style="position:relative;display:inline-block;width:40px;height:22px;cursor:pointer;">
          <input type="checkbox" id="tm-ksb-dark-toggle" style="opacity:0;width:0;height:0;">
          <span id="tm-ksb-dark-slider" style="
            position:absolute;inset:0;border-radius:22px;transition:.25s;
            background:${cfg.darkMode ? '#4f86f7' : '#ccc'};
          ">
            <span style="
              position:absolute;top:3px;left:3px;width:16px;height:16px;
              border-radius:50%;background:#fff;transition:.25s;
              transform:${cfg.darkMode ? 'translateX(18px)' : 'translateX(0)'};
            "></span>
          </span>
        </label>
      </div>

      <!-- 浮窗位置预设 -->
      <div style="padding:10px 0;border-top:1px solid #f0f0f0;">
        <div style="font-weight:600;margin-bottom:8px;">解析浮窗位置</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          ${[['tl','↖ 左上'],['tr','↗ 右上'],['bl','↙ 左下'],['br','↘ 右下']].map(([k,v])=>`
            <button data-pos="${k}" style="
              cursor:pointer;padding:6px 0;border-radius:6px;font-size:13px;
              border:1px solid ${cfg.posMode===k?'#4f86f7':'#ddd'};
              background:${cfg.posMode===k?'#eef4ff':'#fafafa'};
              color:${cfg.posMode===k?'#4f86f7':'#444'};
            ">${v}</button>
          `).join('')}
        </div>
        <div style="font-size:12px;color:#888;margin-top:6px;">也可以直接拖动浮窗标题栏</div>
      </div>
    `;

    document.body.appendChild(modal);

    // 关闭
    modal.querySelector('#tm-ksb-modal-close').addEventListener('click', () => {
      modal.style.display = 'none';
    });

    // 纯净模式开关
    const toggle = modal.querySelector('#tm-ksb-pure-toggle');
    const slider = modal.querySelector('#tm-ksb-slider');
    toggle.checked = cfg.pureMode;
    toggle.addEventListener('change', () => {
      cfg.pureMode = toggle.checked;
      slider.style.background = cfg.pureMode ? '#4f86f7' : '#ccc';
      slider.querySelector('span').style.transform = cfg.pureMode ? 'translateX(18px)' : 'translateX(0)';
      applyPureMode(cfg.pureMode);
      saveSettings(cfg);
    });

    // 暗色模式开关
    const darkToggle = modal.querySelector('#tm-ksb-dark-toggle');
    const darkSlider = modal.querySelector('#tm-ksb-dark-slider');
    darkToggle.checked = cfg.darkMode;
    darkToggle.addEventListener('change', () => {
      cfg.darkMode = darkToggle.checked;
      darkSlider.style.background = cfg.darkMode ? '#4f86f7' : '#ccc';
      darkSlider.querySelector('span').style.transform = cfg.darkMode ? 'translateX(18px)' : 'translateX(0)';
      applyDarkMode(cfg.darkMode);
      modal.querySelectorAll('[data-pos]').forEach(b => {
        const active = b.dataset.pos === cfg.posMode;
        if (cfg.darkMode) {
          b.style.borderColor = active ? '#4f86f7' : '#394150';
          b.style.background = active ? '#243c63' : '#222833';
          b.style.color = '#f3f6fb';
        } else {
          b.style.borderColor = active ? '#4f86f7' : '#ddd';
          b.style.background = active ? '#eef4ff' : '#fafafa';
          b.style.color = active ? '#4f86f7' : '#444';
        }
      });
      saveSettings(cfg);
    });

    // 位置预设按钮
    modal.querySelectorAll('[data-pos]').forEach(btn => {
      btn.addEventListener('click', () => {
        cfg.posMode = btn.dataset.pos;
        saveSettings(cfg);
        applyPos(document.getElementById(PANEL_ID));
        // 更新按钮样式
        modal.querySelectorAll('[data-pos]').forEach(b => {
          const active = b.dataset.pos === cfg.posMode;
          if (cfg.darkMode) {
            b.style.borderColor = active ? '#4f86f7' : '#394150';
            b.style.background = active ? '#243c63' : '#222833';
            b.style.color = '#f3f6fb';
          } else {
            b.style.borderColor = active ? '#4f86f7' : '#ddd';
            b.style.background  = active ? '#eef4ff' : '#fafafa';
            b.style.color       = active ? '#4f86f7' : '#444';
          }
        });
      });
    });

    return modal;
  }

  /* ─────────────────── 主浮窗 ─────────────────── */
  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position:fixed; z-index:999999;
      width:min(420px, calc(100vw - 32px));
      max-height:55vh; overflow:hidden;
      border-radius:12px;
      box-shadow:0 8px 32px rgba(0,0,0,.2);
      background:#fff; color:#222;
      font-size:14px; line-height:1.7;
      border:1px solid #e5e7eb;
      display:flex; flex-direction:column;
    `;

    panel.innerHTML = `
      <div id="tm-ksb-panel-header" style="
        display:flex; align-items:center; gap:6px;
        padding:9px 12px; border-bottom:1px solid #f0f0f0;
        background:#fafafa; border-radius:12px 12px 0 0; flex-shrink:0;
      ">
        <span style="font-weight:700;font-size:14px;flex:1;">🤖 AI解析</span>
        <button id="tm-ksb-settings-btn" title="设置" style="
          cursor:pointer;border:1px solid #e0e0e0;background:#fff;
          border-radius:6px;padding:2px 7px;font-size:13px;">⚙️</button>
        <button id="tm-ksb-collapse-btn" title="折叠/展开" style="
          cursor:pointer;border:1px solid #e0e0e0;background:#fff;
          border-radius:6px;padding:2px 7px;font-size:13px;">—</button>
        <button id="tm-ksb-close-btn" title="关闭" style="
          cursor:pointer;border:1px solid #e0e0e0;background:#fff;
          border-radius:6px;padding:2px 7px;font-size:13px;">✕</button>
      </div>
      <div id="tm-ksb-panel-body" style="
        overflow-y:auto; padding:12px 14px;
        white-space:pre-wrap; word-break:break-word;
      "></div>
    `;

    document.body.appendChild(panel);
    applyPos(panel);

    const body      = panel.querySelector('#tm-ksb-panel-body');
    const collapseBtn = panel.querySelector('#tm-ksb-collapse-btn');
    const header    = panel.querySelector('#tm-ksb-panel-header');

    // 折叠/展开
    function setCollapsed(v) {
      cfg.collapsed = v;
      body.style.display = v ? 'none' : '';
      collapseBtn.textContent = v ? '＋' : '—';
      saveSettings(cfg);
    }
    setCollapsed(cfg.collapsed);
    collapseBtn.addEventListener('click', () => setCollapsed(!cfg.collapsed));

    // 关闭（仅隐藏，可通过控制按钮重新打开）
    panel.querySelector('#tm-ksb-close-btn').addEventListener('click', () => {
      panel.style.display = 'none';
      const ctrl = document.getElementById(CTRL_ID);
      if (ctrl) ctrl.style.display = 'flex';
    });

    // 设置按钮
    let settingsModal = null;
    panel.querySelector('#tm-ksb-settings-btn').addEventListener('click', () => {
      if (!settingsModal) settingsModal = buildSettingsModal();
      settingsModal.style.display = settingsModal.style.display === 'none' ? 'block' : 'none';
    });

    // 拖动
    makeDraggable(panel, header);

    return panel;
  }

  /* ─────────────────── 重新显示按钮（关闭后） ─────────────────── */
  function ensureCtrl() {
    let ctrl = document.getElementById(CTRL_ID);
    if (ctrl) return ctrl;

    ctrl = document.createElement('button');
    ctrl.id = CTRL_ID;
    ctrl.textContent = '🤖';
    ctrl.title = '显示 AI解析';
    ctrl.style.cssText = `
      display:none; position:fixed; z-index:999999;
      bottom:16px; right:16px; width:40px; height:40px;
      border-radius:50%; border:1px solid #ddd;
      background:#fff; font-size:18px; cursor:pointer;
      box-shadow:0 4px 12px rgba(0,0,0,.15);
    `;
    ctrl.addEventListener('click', () => {
      const panel = document.getElementById(PANEL_ID);
      if (panel) panel.style.display = 'flex';
      ctrl.style.display = 'none';
    });
    document.body.appendChild(ctrl);
    return ctrl;
  }

  /* ─────────────────── 内容更新 ─────────────────── */
  let lastText = '';
  let timer    = null;

  function update() {
    const el   = document.querySelector(AI_SELECTOR);
    const text = el ? (el.textContent || '').trim() : '';
    if (text === lastText) return;
    lastText = text;

    // 只更新内容，不控制面板显示（面板由初始化时创建）
    const body = document.getElementById('tm-ksb-panel-body');
    if (body) body.textContent = text || '未获取到 AI解析，请确认题目解析区域已展开。';
  }

  /* ─────────────────── 初始化 ─────────────────── */
  // 纯净模式和暗色模式立即生效
  applyPureMode(cfg.pureMode);
  applyDarkMode(cfg.darkMode);

  // 立即创建浮窗和控制按钮（不等待 AI 解析内容）
  ensureCtrl();
  ensurePanel();

  // 首次尝试获取内容
  update();

  // 等 DOM 稳定后折叠内置设置面板
  setTimeout(collapseBuiltinSettings, 800);

  const observer = new MutationObserver(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      update();
      if (cfg.pureMode) removeClutterElements();
      if (cfg.darkMode) fixInlineStyles();
    }, 150);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

})();
