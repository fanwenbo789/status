(function () {
  'use strict';

  var $ = function (selector) { return document.querySelector(selector); };
  var STATUS = {
    0: { text: '暂停', cls: 'unknown' },
    1: { text: '待检查', cls: 'unknown' },
    2: { text: '正常', cls: 'up' },
    8: { text: '疑似故障', cls: 'down' },
    9: { text: '故障', cls: 'down' }
  };
  var EVENT_TYPES = {
    1: { text: '故障', cls: 'down' },
    2: { text: '恢复', cls: 'up' },
    98: { text: '开始监控', cls: 'unknown' },
    99: { text: '暂停监控', cls: 'paused' }
  };
  var UPTIME_LABELS = [['day', '24 小时'], ['week', '7 天'], ['month', '30 天']];
  var state = { data: null, loading: false, timer: null };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function number(value) {
    var n = Number(value);
    return isFinite(n) ? n : null;
  }

  function formatPct(value) {
    if (value === null) return '—';
    if (value >= 99.995) return '100%';
    return value.toFixed(2) + '%';
  }

  function formatResponse(value) {
    if (value === null) return '';
    return '平均响应 ' + Math.round(value) + ' ms';
  }

  function formatDuration(seconds) {
    var s = Math.max(0, Math.round(Number(seconds) || 0));
    if (s < 60) return s + ' 秒';
    if (s < 3600) return Math.round(s / 60) + ' 分钟';
    return (s / 3600).toFixed(1) + ' 小时';
  }

  function formatTime(seconds) {
    var date = new Date(Number(seconds) * 1000);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatGenerated(value) {
    var date = value ? new Date(value) : new Date();
    if (isNaN(date.getTime())) date = new Date();
    return '最后更新：' + date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function statusFor(value) {
    return STATUS[value] || { text: '未知', cls: 'unknown' };
  }

  function overallFor(data, monitors) {
    var declared = data && data.overall;
    if (declared === 'up' || declared === 'partial' || declared === 'down') {
      return declared;
    }
    var down = monitors.some(function (m) { return m.status === 8 || m.status === 9; });
    if (down) return 'down';
    var partial = monitors.some(function (m) { return m.status !== 2; });
    if (partial || !monitors.length) return 'partial';
    return 'up';
  }

  function renderOverall(data, monitors) {
    var overall = overallFor(data, monitors);
    var box = $('#overall');
    var text = $('.overall-text');
    var labels = {
      up: '所有系统运行正常',
      partial: '部分服务需要关注',
      down: '服务出现故障'
    };
    box.className = 'overall is-' + overall;
    text.textContent = labels[overall] || '状态未知';
    $('#updated').textContent = formatGenerated(data && data.generated);
  }

  function renderUptime(monitor) {
    var grid = el('div', 'uptime-grid');
    UPTIME_LABELS.forEach(function (pair) {
      var key = pair[0];
      var value = monitor.uptime && number(monitor.uptime[key]);
      var item = el('div', 'uptime-item');
      item.appendChild(el('span', 'uptime-label', pair[1]));
      item.appendChild(el('span', 'uptime-value', formatPct(value)));

      var bar = el('div', 'uptime-bar');
      var fill = el('span');
      var pct = value === null ? 0 : Math.max(0, Math.min(100, value));
      fill.style.width = pct + '%';
      if (value !== null && value < 99) bar.classList.add('is-down');
      else if (value !== null && value < 99.9) bar.classList.add('is-partial');
      bar.appendChild(fill);
      item.appendChild(bar);
      grid.appendChild(item);
    });
    return grid;
  }

  function renderMonitor(monitor) {
    var card = document.createElement('mdui-card');
    card.className = 'monitor-card';
    card.setAttribute('variant', 'elevated');
    var head = el('div', 'monitor-head');
    var title = el('div', 'monitor-title');
    title.appendChild(el('h3', 'monitor-name', monitor.name || '未命名监控'));

    if (monitor.url) {
      var link = el('a', 'monitor-url', String(monitor.url).replace(/^https?:\/\//, ''));
      link.href = monitor.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      title.appendChild(link);
    }

    var status = statusFor(monitor.status);
    var pill = el('span', 'status-pill is-' + status.cls);
    pill.appendChild(el('span', 'status-dot'));
    pill.appendChild(document.createTextNode(status.text));

    head.appendChild(title);
    head.appendChild(pill);
    card.appendChild(head);
    card.appendChild(renderUptime(monitor));

    var response = number(monitor.response_time);
    if (response !== null) {
      card.appendChild(el('div', 'monitor-response', formatResponse(response)));
    }
    return card;
  }

  function renderMonitors(monitors) {
    var grid = $('#monitors');
    clear(grid);
    if (!monitors.length) {
      grid.appendChild(el('p', 'empty', '还没有监控数据。'));
      return;
    }
    monitors.forEach(function (monitor) {
      grid.appendChild(renderMonitor(monitor));
    });
  }

  function renderEvents(monitors) {
    var logs = [];
    monitors.forEach(function (monitor) {
      (monitor.logs || []).forEach(function (log) {
        if (!log || !log.datetime) return;
        logs.push({
          type: Number(log.type),
          datetime: Number(log.datetime),
          duration: Number(log.duration) || 0,
          reason: log.reason || '',
          monitor: monitor.name || '未命名监控'
        });
      });
    });
    logs.sort(function (a, b) { return b.datetime - a.datetime; });
    var recent = logs.slice(0, 8);
    var box = $('#events');
    clear(box);
    $('#event-count').textContent = recent.length ? recent.length + ' 条' : '';
    if (!recent.length) {
      box.appendChild(el('p', 'empty', '暂无近期事件。'));
      return;
    }

    recent.forEach(function (log) {
      var type = EVENT_TYPES[log.type] || { text: '事件', cls: 'unknown' };
      var row = el('div', 'event');
      row.appendChild(el('time', 'event-time', formatTime(log.datetime)));

      var main = el('div', 'event-main');
      main.appendChild(el('div', 'event-title', log.monitor + ' / ' + type.text));
      var detail = log.reason;
      if (!detail && log.type === 1 && log.duration) {
        detail = '持续 ' + formatDuration(log.duration);
      }
      if (!detail && log.type === 2) {
        detail = '服务恢复';
      }
      main.appendChild(el('div', 'event-detail', detail || '无附加说明'));
      row.appendChild(main);
      row.appendChild(el('span', 'event-tag is-' + type.cls, type.text));
      box.appendChild(row);
    });
  }

  function render(data) {
    state.data = data;
    var monitors = Array.isArray(data.monitors) ? data.monitors : [];
    $('#error').hidden = true;
    var demoBadge = $('#demo-badge');
    var footerDemo = $('#footer-demo');
    if (demoBadge) demoBadge.hidden = !data.demo;
    if (footerDemo) footerDemo.hidden = !data.demo;
    $('#monitor-count').textContent = monitors.length + ' 项';
    renderOverall(data, monitors);
    renderMonitors(monitors);
    renderEvents(monitors);
  }

  function renderError(message) {
    var box = $('#error');
    box.textContent = message;
    box.hidden = false;
    if (!state.data) {
      $('#overall').className = 'overall is-down';
      $('.overall-text').textContent = '状态获取失败';
      $('#updated').textContent = '最后更新：—';
      clear($('#monitors'));
      $('#monitors').appendChild(el('p', 'empty', '无法加载监控数据。'));
      clear($('#events'));
      $('#events').appendChild(el('p', 'empty', '无法加载事件。'));
      $('#monitor-count').textContent = '';
      $('#event-count').textContent = '';
    }
  }

  function load() {
    if (state.loading) return;
    state.loading = true;
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 8000) : null;
    var options = { cache: 'no-store', credentials: 'omit' };
    if (controller) options.signal = controller.signal;

    fetch('./data.json?t=' + Date.now(), options)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.monitors)) {
          throw new Error('data.json 格式不正确');
        }
        render(data);
      })
      .catch(function (error) {
        if (timer) clearTimeout(timer);
        renderError('状态加载失败：' + (error && error.message ? error.message : '未知错误'));
      })
      .then(function () {
        if (timer) clearTimeout(timer);
        state.loading = false;
      });
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.remove('mdui-theme-light', 'mdui-theme-dark');
    root.classList.add('mdui-theme-' + theme);
    var button = $('#theme-toggle');
    button.setAttribute('aria-label', theme === 'dark' ? '切换浅色模式' : '切换深色模式');
  }

  function initTheme() {
    var theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    applyTheme(theme);
    $('#theme-toggle').addEventListener('click', function () {
      theme = theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme);
      try { localStorage.setItem('status-theme', theme); } catch (e) {}
    });
  }

  var year = $('#year');
  if (year) year.textContent = String(new Date().getFullYear());
  initTheme();
  load();
  state.timer = setInterval(load, 60000);
})();
