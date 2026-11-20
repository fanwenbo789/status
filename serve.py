#!/usr/bin/env python3
"""Local preview server for the status page.

Serves the repository root but refuses dotfiles, .git and directory listings,
so local secret files are never exposed. Binds to 127.0.0.1 by default.
This is a development server only; deploy the static files with a normal web
server or GitHub Pages.
"""
import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _blocked(self):
        path = unquote(urlsplit(self.path).path)
        return any(part.startswith(".") for part in path.split("/") if part)

    def do_GET(self):
        if self._blocked():
            self.send_error(404, "Not Found")
            return
        super().do_GET()

    def do_HEAD(self):
        if self._blocked():
            self.send_error(404, "Not Found")
            return
        super().do_HEAD()

    def list_directory(self, path):
        self.send_error(404, "Not Found")
        return None


class Server(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description="Status page local preview")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4010)
    args = parser.parse_args()

    server = Server((args.bind, args.port), Handler)
    print("Serving %s on http://%s:%d/ (dotfiles blocked)" % (ROOT, args.bind, args.port))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
