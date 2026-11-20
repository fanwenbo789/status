# status

赤羽 Akabane 的服务状态页，监控数据来自 UptimeRobot。

## 本地预览

```bash
cd status
python3 -m http.server 4010
```

打开 <http://127.0.0.1:4010/>。仓库初始的 `data.json` 是预览数据；运行 `sync.py` 后会替换成真实监控数据，页面不再显示“预览数据”标记。

## 对接 UptimeRobot

1. 在 UptimeRobot 的 Integrations & API → API 创建 **read-only** 或 **monitor-specific** API key。
2. 写入本地受保护文件，不要提交；如果是 monitor-specific key，只会返回对应的一个监控项：

   ```bash
   printf '%s' '你的 API key' > .uptimerobot_key
   chmod 600 .uptimerobot_key
   ```

   也可以使用环境变量 `UPTIMEROBOT_API_KEY`。
3. 拉取数据：

   ```bash
   python3 sync.py
   ```

   脚本调用 v2 `getMonitors`，写入 `data.json`，不会把 key 写进页面或 JSON。

## 数据格式

```json
{
  "generated": "2026-11-20T08:45:00Z",
  "overall": "up",
  "monitors": [
    {
      "id": 1,
      "name": "Akabane Blog",
      "url": "https://www.akabane.cn/",
      "status": 2,
      "uptime": { "day": 100, "week": 99.99, "month": 99.97 },
      "response_time": 182,
      "logs": []
    }
  ]
}
```

`status` 使用 UptimeRobot 原值：`0` 暂停、`1` 待检查、`2` 正常、`8` 疑似故障、`9` 故障。

## GitHub Actions

`.github/workflows/sync.yml` 目前只支持手动触发。上线前再决定刷新频率：

- 定时跑会频繁提交 `data.json`，需要接受提交历史增长
- 更接近实时的做法是用 Vercel/Cloudflare 的 serverless 代理，把 key 放在服务端，由页面请求代理

在仓库 Settings → Secrets and variables → Actions 添加 `UPTIMEROBOT_API_KEY`。

## 部署

页面全部使用相对路径，可以放在：

- GitHub Pages 的 `https://fanwenbo789.github.io/status/`
- 自定义域名，如 `status.akabane.cn`

如果使用 GitHub Pages，需要 public 仓库；`.nojekyll` 已存在。

## 说明

- 前端不直接请求 UptimeRobot，key 不会进入浏览器。
- UptimeRobot v2 是 legacy API，仍可用；后续可以迁移到 v3。
- 不引用外部 CDN、字体或 JS 库。
