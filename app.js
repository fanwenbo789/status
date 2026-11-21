(function () {
  'use strict';

  var $ = function (selector) { return document.querySelector(selector); };
  var API_URL = 'https://api.uptimerobot.com/v2/getMonitors';
  var CONFIG = window.STATUS_CONFIG || {};
  var API_KEY = String(CONFIG.uptimerobotKey || '').trim();
  var REFRESH_MS = Math.max(30, Number(CONFIG.refreshSeconds) || 60) * 1000;

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
  var DAY_COUNT = 30;
  var LATENCY_BUCKETS = 48;
  var LATENCY_AVG_MIN = 30;
  var state = { data: null, loading: false, timer: null, signature: null };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function svgEl(tag, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttribute(key, attrs[key]);
      });
    }
    return node;
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

  function formatShortTime(seconds) {
    var date = new Date(Number(seconds) * 1000);
    if (isNaN(date.getTime())) return '—';
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return (date.getMonth() + 1) + '/' + date.getDate() + ' ' +
      pad(date.getHours()) + ':' + pad(date.getMinutes());
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

  function dayStatus(value) {
    if (value === null) return { text: 'No data', cls: 'empty' };
    if (value >= 99.995) return { text: 'Up', cls: 'up' };
    if (value <= 0.005) return { text: 'Down', cls: 'down' };
    return { text: 'Partial', cls: 'partial' };
  }

  function safeUrl(value) {
    if (!value) return '';
    try {
      var url = new URL(String(value), window.location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.href;
    } catch (e) {
      return '';
    }
  }

  function normalizeStatus(value) {
    if (value === undefined || value === null || value === '') return 1;
    var n = Number(value);
    return isFinite(n) ? n : 1;
  }

  function buildDailyRanges(count) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var now = Math.floor(Date.now() / 1000);
    var starts = [];
    var ends = [];
    var ranges = [];
    for (var i = count - 1; i >= 0; i--) {
      var startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 0, 0, 0, 0);
      var endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i + 1, 0, 0, 0, 0);
      var start = Math.floor(startDate.getTime() / 1000);
      var end = Math.min(Math.floor(endDate.getTime() / 1000), now);
      if (end <= start) end = start + 1;
      starts.push(start);
      ends.push(end);
      ranges.push(start + '_' + end);
    }
    return { query: ranges.join('-'), starts: starts, ends: ends };
  }

  function parseUptimes(monitor) {
    var raw = monitor.custom_uptime_ratio;
    if (raw === undefined || raw === null) raw = monitor.custom_uptime_ratios;
    var values = String(raw === undefined || raw === null ? '' : raw).split('-').map(function (part) {
      var text = String(part).trim();
      if (!text) return null;
      var n = Number(text);
      return isFinite(n) ? n : null;
    });
    while (values.length < 3) values.push(null);
    return { day: values[0], week: values[1], month: values[2] };
  }

  function parseDays(monitor, starts, ends) {
    var raw = monitor.custom_uptime_ranges;
    if (!raw || !starts || !starts.length) return [];
    var parts = String(raw).split('-');
    var created = Number(monitor.create_datetime) || 0;
    return starts.map(function (start, index) {
      var text = String(parts[index] === undefined ? '' : parts[index]).trim();
      var value = text === '' ? null : Number(text);
      if (!isFinite(value) || value < 0) value = null;
      var end = ends && ends[index] !== undefined ? ends[index] : start + 86400;
      if (created > 0 && end <= created) value = null;
      return { start: start, end: end, uptime: value };
    });
  }

  function parseResponseTime(monitor) {
    var average = monitor.average_response_time;
    if (average !== undefined && average !== null && String(average).trim() !== '') {
      var n = Number(average);
      if (isFinite(n)) return n;
    }
    var times = monitor.response_times || [];
    if (times.length) {
      var latest = times.slice().sort(function (a, b) {
        return Number(b.datetime) - Number(a.datetime);
      })[0];
      var value = Number(latest && latest.value);
      if (isFinite(value)) return value;
    }
    return null;
  }

  function parseLatency(monitor) {
    return (monitor.response_times || []).map(function (point) {
      var datetime = Number(point && point.datetime);
      var value = Number(point && point.value);
      if (!isFinite(datetime) || datetime <= 0 || !isFinite(value) || value < 0) return null;
      return { datetime: datetime, value: value };
    }).filter(function (point) { return point !== null; }).sort(function (a, b) {
      return a.datetime - b.datetime;
    });
  }

  function normalizeLogs(monitor) {
    var logs = [];
    (monitor.logs || []).forEach(function (log) {
      var datetime = Number(log && log.datetime);
      if (!isFinite(datetime) || datetime <= 0) return;
      logs.push({
        type: Number(log.type),
        datetime: datetime,
        duration: Number(log.duration) || 0,
        reason: log.reason || ''
      });
    });
    logs.sort(function (a, b) { return b.datetime - a.datetime; });
    return logs.slice(0, 20);
  }

  function normalizeMonitor(monitor, starts, ends) {
    return {
      id: monitor.id,
      name: monitor.friendly_name || '未命名监控',
      url: safeUrl(monitor.url),
      status: normalizeStatus(monitor.status),
      uptime: parseUptimes(monitor),
      days: parseDays(monitor, starts, ends),
      response_time: parseResponseTime(monitor),
      latency: parseLatency(monitor),
      logs: normalizeLogs(monitor)
    };
  }

  function overallFor(monitors) {
    if (!monitors.length) return 'empty';
    if (monitors.some(function (m) { return m.status === 8 || m.status === 9; })) return 'down';
    if (monitors.some(function (m) { return m.status !== 2; })) return 'partial';
    return 'up';
  }

  function normalize(payload, starts, ends) {
    var monitors = (payload.monitors || []).map(function (monitor) {
      return normalizeMonitor(monitor, starts, ends);
    });
    return {
      generated: new Date().toISOString(),
      overall: overallFor(monitors),
      monitors: monitors
    };
  }

  function renderOverall(data, monitors) {
    var overall = data && data.overall;
    if (overall !== 'up' && overall !== 'partial' && overall !== 'down' && overall !== 'empty') {
      overall = overallFor(monitors);
    }
    var box = $('#overall');
    var text = $('.overall-text');
    var labels = {
      up: '所有系统运行正常',
      partial: '部分服务需要关注',
      down: '服务出现故障',
      empty: '暂无监控数据'
    };
    box.className = 'overall is-' + overall;
    text.textContent = labels[overall] || '状态未知';
    $('#updated').textContent = formatGenerated(data && data.generated);
  }

  function renderDays(monitor) {
    var days = monitor.days || [];
    var summary = monitor.uptime && number(monitor.uptime.month);
    var box = el('div', 'day-status');
    var head = el('div', 'day-status-head');
    head.appendChild(el('span', 'day-status-label', '30 天可用率'));
    head.appendChild(el('span', 'day-status-value', formatPct(summary)));
    box.appendChild(head);

    var bars = el('div', 'day-bars');
    bars.setAttribute('role', 'group');
    bars.setAttribute('aria-label', '最近 30 天状态');
    var detail = el('div', 'day-detail');
    detail.setAttribute('aria-live', 'polite');

    function selectDay(day, button) {
      var status = dayStatus(day.uptime);
      clear(detail);
      detail.appendChild(el('span', 'day-detail-status is-' + status.cls, status.text));
      detail.appendChild(el('span', 'day-detail-time', formatShortTime(day.start) + ' – ' + formatShortTime(day.end)));
      detail.appendChild(el('span', 'day-detail-value', day.uptime === null ? '—' : formatPct(day.uptime)));
      var buttons = bars.querySelectorAll('.day-bar');
      for (var i = 0; i < buttons.length; i++) {
        var selected = buttons[i] === button;
        buttons[i].setAttribute('aria-pressed', selected ? 'true' : 'false');
        buttons[i].classList.toggle('is-selected', selected);
      }
    }

    days.forEach(function (day) {
      var status = dayStatus(day.uptime);
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'day-bar is-' + status.cls;
      button.setAttribute('aria-pressed', 'false');
      var range = formatShortTime(day.start) + ' – ' + formatShortTime(day.end);
      var text = status.text + ' · ' + range;
      if (day.uptime !== null) text += ' · ' + formatPct(day.uptime);
      button.title = text;
      button.setAttribute('aria-label', text);
      button.addEventListener('click', function () {
        selectDay(day, button);
      });
      bars.appendChild(button);
    });
    box.appendChild(bars);

    var axis = el('div', 'day-axis');
    axis.setAttribute('aria-hidden', 'true');
    axis.appendChild(el('span', null, '30 天前'));
    axis.appendChild(el('span', null, '今天'));
    box.appendChild(axis);

    if (days.length) {
      selectDay(days[days.length - 1], bars.children[days.length - 1]);
    } else {
      detail.appendChild(el('span', 'day-detail-time', '暂无 30 天数据'));
    }
    box.appendChild(detail);

    if (days.some(function (day) { return day.uptime === null; })) {
      box.appendChild(el('p', 'day-note', '灰色为无数据'));
    }
    return box;
  }

  function renderLatency(monitor) {
    var box = el('div', 'latency');
    var avg = number(monitor.response_time);
    var head = el('div', 'latency-head');
    head.appendChild(el('span', 'latency-label', '24 小时延迟'));
    head.appendChild(el('span', 'latency-value', avg === null ? '—' : '平均 ' + Math.round(avg) + ' ms'));
    box.appendChild(head);

    var points = monitor.latency || [];
    if (points.length < 2) {
      box.appendChild(el('p', 'latency-empty', '数据积累中'));
      return box;
    }

    var width = 300;
    var height = 48;
    var pad = 4;
    var values = points.map(function (point) { return point.value; });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    if (max === min) {
      min = Math.max(0, min - 1);
      max = max + 1;
    }
    var span = max - min || 1;
    var step = (width - pad * 2) / (points.length - 1);
    var coords = points.map(function (point, index) {
      return {
        x: pad + index * step,
        y: height - pad - ((point.value - min) / span) * (height - pad * 2),
        value: point.value,
        datetime: point.datetime
      };
    });
    var line = coords.map(function (point, index) {
      return (index === 0 ? 'M' : 'L') + point.x.toFixed(1) + ' ' + point.y.toFixed(1);
    }).join(' ');
    var area = line + ' L' + (width - pad).toFixed(1) + ' ' + (height - pad) +
      ' L' + pad + ' ' + (height - pad) + ' Z';
    var gradientId = 'latency-gradient-' + String(monitor.id || 'monitor');

    var svg = svgEl('svg', {
      class: 'latency-chart',
      viewBox: '0 0 ' + width + ' ' + height,
      preserveAspectRatio: 'none',
      role: 'img',
      tabindex: '0',
      'aria-label': '24 小时延迟曲线，平均 ' + (avg === null ? '未知' : Math.round(avg) + ' 毫秒，使用左右方向键查看采样点')
    });

    var defs = svgEl('defs');
    var gradient = svgEl('linearGradient', {
      id: gradientId,
      x1: '0',
      y1: '0',
      x2: '0',
      y2: '1'
    });
    gradient.appendChild(svgEl('stop', { offset: '0%', 'stop-color': 'currentColor', 'stop-opacity': '0.28' }));
    gradient.appendChild(svgEl('stop', { offset: '100%', 'stop-color': 'currentColor', 'stop-opacity': '0' }));
    defs.appendChild(gradient);
    svg.appendChild(defs);
    svg.appendChild(svgEl('path', { class: 'latency-area', d: area, fill: 'url(#' + gradientId + ')' }));
    svg.appendChild(svgEl('path', { class: 'latency-line', d: line }));

    if (avg !== null) {
      var avgY = height - pad - ((avg - min) / span) * (height - pad * 2);
      if (avgY >= 0 && avgY <= height) {
        svg.appendChild(svgEl('line', {
          class: 'latency-avg',
          x1: pad,
          y1: avgY.toFixed(1),
          x2: width - pad,
          y2: avgY.toFixed(1)
        }));
      }
    }

    var last = coords[coords.length - 1];
    svg.appendChild(svgEl('line', {
      class: 'latency-now',
      x1: last.x.toFixed(1),
      y1: 0,
      x2: last.x.toFixed(1),
      y2: height
    }));

    var cursor = svgEl('line', {
      class: 'latency-cursor',
      x1: last.x.toFixed(1),
      y1: 0,
      x2: last.x.toFixed(1),
      y2: height
    });
    svg.appendChild(cursor);

    var title = svgEl('title');
    title.textContent = '最低 ' + Math.round(min) + ' ms / 最高 ' + Math.round(max) + ' ms';
    svg.appendChild(title);
    box.appendChild(svg);

    var axis = el('div', 'latency-axis');
    axis.setAttribute('aria-hidden', 'true');
    axis.appendChild(el('span', null, formatShortTime(points[0].datetime)));
    axis.appendChild(el('span', null, formatShortTime(points[points.length - 1].datetime)));
    box.appendChild(axis);

    var detail = el('div', 'latency-detail');
    detail.setAttribute('aria-live', 'polite');
    box.appendChild(detail);

    var selected = coords.length - 1;
    function selectPoint(index) {
      selected = Math.max(0, Math.min(coords.length - 1, index));
      var point = coords[selected];
      cursor.setAttribute('x1', point.x.toFixed(1));
      cursor.setAttribute('x2', point.x.toFixed(1));
      cursor.style.opacity = '1';
      detail.textContent = formatShortTime(point.datetime) + ' · ' + Math.round(point.value) + ' ms';
    }

    svg.addEventListener('click', function (event) {
      var rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      var x = ((event.clientX - rect.left) / rect.width) * width;
      var nearest = 0;
      for (var i = 1; i < coords.length; i++) {
        if (Math.abs(coords[i].x - x) < Math.abs(coords[nearest].x - x)) nearest = i;
      }
      selectPoint(nearest);
    });

    svg.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      selectPoint(selected + (event.key === 'ArrowRight' ? 1 : -1));
    });

    selectPoint(selected);
    return box;
  }

  function renderMonitor(monitor) {
    var card = document.createElement('mdui-card');
    card.className = 'monitor-card';
    card.setAttribute('variant', 'elevated');
    var head = el('div', 'monitor-head');
    var title = el('div', 'monitor-title');
    title.appendChild(el('h3', 'monitor-name', monitor.name || '未命名监控'));

    if (monitor.url) {
      var display = String(monitor.url).replace(/^https?:\/\//, '').replace(/\/$/, '');
      var link = el('a', 'monitor-url', display);
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
    card.appendChild(renderDays(monitor));
    card.appendChild(renderLatency(monitor));
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
    $('#event-count').textContent = recent.length ? '(' + recent.length + ' 条)' : '';
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
    var monitors = Array.isArray(data.monitors) ? data.monitors : [];
    var signature = JSON.stringify(monitors);
    var unchanged = state.data && state.signature === signature;
    state.data = data;
    $('#error').hidden = true;
    $('#monitor-count').textContent = '(' + monitors.length + ' 项)';
    renderOverall(data, monitors);
    if (unchanged) return;
    state.signature = signature;
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
      return;
    }
    $('#updated').textContent = formatGenerated(state.data.generated) + '（刷新失败，显示上次数据）';
  }

  function friendlyError(error) {
    var message = error && error.message ? String(error.message) : '';
    if (error && error.name === 'AbortError') return '请求超时，请稍后重试。';
    if (error && error.name === 'SyntaxError') return 'UptimeRobot 返回了无法解析的数据。';
    if (message === 'MISSING_KEY') return '未配置 UptimeRobot API key，请检查 config.js。';
    if (message === 'RATE_LIMIT' || /HTTP 429/.test(message)) return '请求过于频繁，请稍后再试。';
    if (/Failed to fetch|NetworkError|Load failed/i.test(message)) return '无法连接 UptimeRobot，请检查网络。';
    if (/api_key/i.test(message)) return 'UptimeRobot API key 无效，请检查 config.js。';
    if (/^HTTP \d+$/.test(message)) return 'UptimeRobot 返回 ' + message + '。';
    if (message === 'API_ERROR') return 'UptimeRobot 返回错误，请稍后再试。';
    return message || '加载失败，请稍后重试。';
  }

  function fetchMonitors(signal) {
    if (!API_KEY) return Promise.reject(new Error('MISSING_KEY'));

    var daily = buildDailyRanges(DAY_COUNT);
    var body = new URLSearchParams();
    body.set('api_key', API_KEY);
    body.set('format', 'json');
    body.set('logs', '1');
    body.set('logs_limit', '50');
    body.set('response_times', '1');
    body.set('response_times_limit', String(LATENCY_BUCKETS));
    body.set('response_times_average', String(LATENCY_AVG_MIN));
    body.set('custom_uptime_ratios', '1-7-30');
    body.set('custom_uptime_ranges', daily.query);

    return fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: signal
    }).then(function (response) {
      if (!response.ok) {
        if (response.status === 429) throw new Error('RATE_LIMIT');
        throw new Error('HTTP ' + response.status);
      }
      return response.json();
    }).then(function (payload) {
      if (!payload || payload.stat !== 'ok') {
        var message = payload && payload.error;
        if (message && typeof message === 'object') message = message.message;
        throw new Error(message || 'API_ERROR');
      }
      return normalize(payload, daily.starts, daily.ends);
    });
  }

  function load() {
    if (state.loading) return;
    state.loading = true;
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 10000) : null;

    fetchMonitors(controller ? controller.signal : undefined)
      .then(function (data) {
        render(data);
      })
      .catch(function (error) {
        renderError(friendlyError(error));
      })
      .then(function () {
        if (timer) clearTimeout(timer);
        state.loading = false;
      });
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    root.dataset.theme = theme;
    root.classList.remove('mdui-theme-light', 'mdui-theme-dark', 'mdui-theme-auto');
    root.classList.add('mdui-theme-' + theme);

    var label = theme === 'dark' ? '切换浅色模式' : '切换深色模式';
    var hidden = $('#theme-label');
    if (hidden) hidden.textContent = label;

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0277bd' : '#29b6f6');

    var host = $('#theme-toggle');
    var button = host && host.shadowRoot && host.shadowRoot.querySelector('button');
    if (button) button.setAttribute('aria-label', label);
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
  state.timer = setInterval(load, REFRESH_MS);
  window.addEventListener('online', load);
})();
