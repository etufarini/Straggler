#!/usr/bin/env python3
"""Packaging lifecycle fixture. No weights, GPU, or inference services are used."""

import argparse
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import signal
import sys
import time

root = Path(__file__).parent
if (root / "ignore-term").exists():
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
(root / "pid.txt").write_text(str(os.getpid()))
(root / "args.json").write_text(json.dumps(sys.argv[1:]))
if (root / "wait").exists():
    while True:
        time.sleep(0.05)
if "--version" in sys.argv:
    print("Fixture backend version")
    if (root / "version-error").exists():
        print("Fixture loader failure", file=sys.stderr)
        sys.exit(3)
    sys.exit(0)
if "--help" in sys.argv:
    print("x" * 40000 + "\nFixture help tail")
    sys.exit(0)

# These options follow common/arg.cpp in upstream b12248. /health follows its
# tools/server/README.md: 503 while loading and 200 when ready.
parser = argparse.ArgumentParser()
parser.add_argument("--model", required=True)
parser.add_argument("--host", required=True)
parser.add_argument("--port", required=True, type=int)
parser.add_argument("--gpu-layers", required=True)
parser.add_argument("--ctx-size", required=True, type=int)
parser.add_argument("--parallel", required=True, type=int)
parser.add_argument("--no-warmup", action="store_true")
options = parser.parse_args()
if not Path(options.model).is_file():
    print("Fixture model is missing", file=sys.stderr)
    sys.exit(2)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        assert self.path == "/health"
        loading = (root / "loading").exists()
        body = json.dumps({"status": "loading model" if loading else "ok"}).encode()
        self.send_response(503 if loading else 200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


HTTPServer((options.host, options.port), Handler).serve_forever()
