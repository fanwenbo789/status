#!/usr/bin/env python3
"""Fetch UptimeRobot monitor data and write the static status page data.

Uses the legacy v2 getMonitors endpoint with a read-only or monitor-specific
API key. The key is read from UPTIMEROBOT_API_KEY or .uptimerobot_key and is
never written to data.json or the page.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
KEY_FILE = ROOT / ".uptimerobot_key"
DATA_FILE = ROOT / "data.json"
API = "https://api.uptimerobot.com/v2/getMonitors"


def get_key():
    key = os.environ.get("UPTIMEROBOT_API_KEY", "").strip()
    if not key and KEY_FILE.exists():
        key = KEY_FILE.read_text(encoding="utf-8").strip()
    if not key:
        raise SystemExit("missing UPTIMEROBOT_API_KEY or .uptimerobot_key")
    return key


def fetch_monitors(key):
    body = urllib.parse.urlencode({
        "api_key": key,
        "format": "json",
        "logs": "1",
        "logs_limit": "50",
        "response_times": "1",
        "response_times_limit": "1",
        "custom_uptime_ratios": "1-7-30",
    }).encode()
    request = urllib.request.Request(
        API,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Cache-Control": "no-cache",
            "User-Agent": "akabane-status/1.0",
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


def parse_uptimes(monitor):
    raw = monitor.get("custom_uptime_ratio")
    if raw is None:
        raw = monitor.get("custom_uptime_ratios")
    values = []
    for part in str(raw or "").split("-"):
        try:
            values.append(float(part))
        except ValueError:
            values.append(None)
    values += [None] * (3 - len(values))
    return {"day": values[0], "week": values[1], "month": values[2]}


def parse_response_time(monitor):
    for key in ("average_response_time", "response_time"):
        value = monitor.get(key)
        try:
            if value is not None and str(value).strip() != "":
                return float(value)
        except ValueError:
            pass
    times = monitor.get("response_times") or []
    if times:
        try:
            return float(times[-1].get("value"))
        except (TypeError, ValueError):
            pass
    return None


def normalize(monitor):
    logs = []
    for log in monitor.get("logs") or []:
        try:
            logs.append({
                "type": int(log.get("type")),
                "datetime": int(log.get("datetime")),
                "duration": int(log.get("duration") or 0),
                "reason": log.get("reason") or "",
            })
        except (TypeError, ValueError):
            continue
    logs.sort(key=lambda item: item["datetime"], reverse=True)
    return {
        "id": monitor.get("id"),
        "name": monitor.get("friendly_name") or "未命名监控",
        "url": monitor.get("url") or "",
        "status": int(monitor.get("status") or 1),
        "uptime": parse_uptimes(monitor),
        "response_time": parse_response_time(monitor),
        "logs": logs[:20],
    }


def overall_for(monitors):
    down = any(item["status"] in (8, 9) for item in monitors)
    if down:
        return "down"
    if any(item["status"] != 2 for item in monitors):
        return "partial"
    return "up"


def main():
    key = get_key()
    raw_monitors = fetch_monitors(key)
    monitors = [normalize(monitor) for monitor in raw_monitors]
    if not monitors:
        raise SystemExit("UptimeRobot returned no monitors")

    payload = {
        "generated": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "overall": overall_for(monitors),
        "monitors": monitors,
    }
    temp = DATA_FILE.with_name(DATA_FILE.name + ".tmp")
    temp.write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    temp.replace(DATA_FILE)

    counts = {}
    for monitor in monitors:
        counts[monitor["status"]] = counts.get(monitor["status"], 0) + 1
    print("saved %s monitors to %s" % (len(monitors), DATA_FILE))
    print("overall:", payload["overall"])
    print("status counts:", counts)


if __name__ == "__main__":
    main()
