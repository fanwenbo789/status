#!/usr/bin/env python3
"""Fetch recent UptimeRobot events and write events.json for the main site.

The status page itself fetches UptimeRobot live. This small static endpoint is
for other pages that need the latest events without calling the API directly.
The read-only key is read from UPTIMEROBOT_API_KEY or config.js; it is public
by design but never written into events.json.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "config.js"
EVENTS = ROOT / "events.json"
API = "https://api.uptimerobot.com/v2/getMonitors"
EVENT_TYPES = {1: "故障", 2: "恢复", 98: "开始监控", 99: "暂停监控"}
LIMIT = 30


def read_key():
    key = os.environ.get("UPTIMEROBOT_API_KEY", "").strip()
    if key:
        return key
    text = CONFIG.read_text(encoding="utf-8")
    match = re.search(r"uptimerobotKey:\s*'([^']+)'", text)
    if not match:
        raise SystemExit("missing UPTIMEROBOT_API_KEY or uptimerobotKey in config.js")
    return match.group(1)


def fetch_monitors(key):
    body = urllib.parse.urlencode({
        "api_key": key,
        "format": "json",
        "logs": "1",
        "logs_limit": "50",
    }).encode()
    request = urllib.request.Request(
        API,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Cache-Control": "no-cache",
            "User-Agent": "akabane-status-events/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:300]
        raise SystemExit("UptimeRobot API %s: %s" % (error.code, detail))
    except urllib.error.URLError as error:
        raise SystemExit("UptimeRobot API network error: %s" % error)

    if data.get("stat") != "ok":
        raise SystemExit("UptimeRobot API error: %s" % data.get("error", "unknown"))
    return data.get("monitors") or []


def normalize(monitors):
    events = []
    for monitor in monitors:
        name = monitor.get("friendly_name") or "未命名监控"
        for log in monitor.get("logs") or []:
            try:
                event_type = int(log.get("type"))
                datetime = int(log.get("datetime"))
            except (TypeError, ValueError):
                continue
            reason = log.get("reason")
            if isinstance(reason, dict):
                reason = reason.get("detail") or reason.get("message") or reason.get("code") or ""
            events.append({
                "monitor": name,
                "type": event_type,
                "text": EVENT_TYPES.get(event_type, "事件"),
                "datetime": datetime,
                "duration": int(log.get("duration") or 0),
                "reason": str(reason or ""),
            })
    events.sort(key=lambda item: item["datetime"], reverse=True)
    return events[:LIMIT]


def main():
    monitors = fetch_monitors(read_key())
    events = normalize(monitors)
    payload = {"events": events}
    temp = EVENTS.with_name(EVENTS.name + ".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    temp.replace(EVENTS)
    print("saved %d events to %s" % (len(events), EVENTS))


if __name__ == "__main__":
    main()
