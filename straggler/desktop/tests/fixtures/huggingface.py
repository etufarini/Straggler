#!/usr/bin/env python3
"""Loopback Hub fixture for the native window; no external network or model weights."""

import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import time

COMMIT = "0123456789abcdef0123456789abcdef01234567"
PAYLOAD = b"native Hub GGUF fixture\n" * 4096
FILE = {"type": "file", "path": "native-fixture.gguf", "size": len(PAYLOAD),
        "lfs": {"oid": hashlib.sha256(PAYLOAD).hexdigest(), "size": len(PAYLOAD), "pointerSize": 123}}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_arguments):
        pass

    def do_GET(self):
        if "/revision/" in self.path:
            body = json.dumps({"sha": COMMIT, "gated": False}).encode()
        elif "/tree/" in self.path:
            body = json.dumps([FILE]).encode()
        elif "/resolve/" in self.path:
            offset = int(self.headers.get("Range", "bytes=0-")[6:-1])
            self.send_response(206 if offset else 200)
            if offset:
                self.send_header("Content-Range", f"bytes {offset}-{len(PAYLOAD) - 1}/{len(PAYLOAD)}")
            self.send_header("Content-Length", str(len(PAYLOAD) - offset))
            self.end_headers()
            try:
                for start in range(offset, len(PAYLOAD), 4096):
                    self.wfile.write(PAYLOAD[start:start + 4096])
                    self.wfile.flush()
                    time.sleep(0.005)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
print(f"http://127.0.0.1:{server.server_address[1]}/", flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
