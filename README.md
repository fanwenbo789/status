# status

赤羽 Akabane 的服务状态页，浏览器直接读取 UptimeRobot 的只读 API。

线上：<https://fanwenbo789.github.io/status/>

## 本地预览

```bash
cd status
python3 serve.py
```

打开 <http://127.0.0.1:4010/>。

`serve.py` 默认只监听 `127.0.0.1`，并拒绝 `.git`、`.uptimerobot_key` 等点文件和目录列表。不要用 `python3 -m http.server` 直接服务仓库根目录，它会把点文件和 `.git` 一起暴露出去。

## 数据来源

页面每 60 秒调用一次 UptimeRobot v2 `getMonitors`：

- `logs=1&logs_limit=50`
- `response_times=1&response_times_limit=48&response_times_average=30`
- `custom_uptime_ratios=1-7-30`
- `custom_uptime_ranges=最近 30 个自然日的区间`

30 天状态条中，监控创建前或没有数据的日期显示为灰色。点击 30 天格子查看当天状态和时间，点击延迟曲线查看采样点和时间。

API key 在 `config.js`：

```js
window.STATUS_CONFIG = {
  uptimerobotKey: 'ur...',
  refreshSeconds: 60
};
```

**`config.js` 是公开文件。** 只能使用 **read-only** 或 monitor-specific key，不要使用可写 key。任何人查看源码都能拿到它；如果被滥用，请在 UptimeRobot 后台轮换，并更新 `config.js`。

UptimeRobot v2 对 `get*` 接口返回 `access-control-allow-origin: *`，所以浏览器可以直接请求。免费额度约 10 请求/分钟，默认 60 秒刷新，单标签页足够。

## 部署

纯静态站点，无构建步骤。需要发布的文件：

- `index.html`
- `app.js`
- `config.js`
- `styles.css`
- `assets/`
- `.nojekyll`（GitHub Pages）

可以部署到 GitHub Pages 根目录，或自定义域名如 `status.akabane.cn`。

## 说明

- 页面不读取 `data.json`，也不需要 `sync.py` 或 GitHub Actions；这些旧文件已从当前版本移除，需要时可以从 git 历史恢复。
- UptimeRobot v2 是 legacy API，仍可用；后续可以迁移到 v3。
- 使用本地 MDUI 2 组件（`assets/mdui.min.css`、`assets/mdui.global.min.js`），顶栏、卡片、4px 圆角和浅/深色跟随主站。
- 不引用外部 CDN、字体或 JS 库。
- 如果以后要隐藏 key，改用 Cloudflare Worker/Vercel 代理，把 key 放在服务端。
