import argparse
import signal
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--data", type=Path, required=True)
parser.add_argument("--ready", type=Path, required=True)
parser.add_argument("--stopped", type=Path, required=True)
args = parser.parse_args()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/convert":
            self.send_response(404)
            self.end_headers()
            return
        value = args.data.read_text(encoding="utf-8").strip().upper()
        body = f'{{"value":"{value}"}}'.encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *values: object) -> None:
        return


def stop(_signum: int, _frame: object) -> None:
    args.stopped.parent.mkdir(parents=True, exist_ok=True)
    args.stopped.write_text("STOPPED\n", encoding="utf-8")
    raise SystemExit(0)


signal.signal(signal.SIGTERM, stop)
server = HTTPServer(("127.0.0.1", 18765), Handler)
args.ready.parent.mkdir(parents=True, exist_ok=True)
args.ready.write_text("READY\n", encoding="utf-8")
server.serve_forever()
