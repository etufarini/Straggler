#!/usr/bin/env python3
"""Test-only llama-server stand-in. No model inference is performed."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import sys
import time

if '--version' in sys.argv:
    print('Test llama-server')
    sys.exit()
if '--help' in sys.argv:
    print('--model FNAME\n--port PORT\n--host HOST\n--ctx-size N\n--cache-type-k TYPE\n--cache-type-v TYPE\n--split-mode MODE\n--tensor-split N\n--fit-target N\n--device DEV\n--threads N\n--gpu-layers N\n--batch-size N\n--ubatch-size N\n--temperature N\n--top-p N\n--top-k N\n--min-p N\n--repeat-penalty N\n--presence-penalty N\n--frequency-penalty N\n--seed N\n--n-predict N')
    sys.exit()
if '--list-devices' in sys.argv:
    print('Available devices:\n  Test0: Test accelerator (8192 MiB, 6144 MiB free)')
    sys.exit()

parser = argparse.ArgumentParser()
parser.add_argument('--model')
parser.add_argument('--port', type=int)
parser.add_argument('--host')
for flag in ('ctx-size', 'cache-type-k', 'cache-type-v', 'split-mode', 'tensor-split', 'fit-target', 'device', 'threads', 'gpu-layers', 'batch-size', 'ubatch-size', 'temperature', 'top-p', 'top-k', 'min-p', 'repeat-penalty', 'presence-penalty', 'frequency-penalty', 'seed', 'n-predict'):
    parser.add_argument('--' + flag)
options = parser.parse_args()
if os.environ.get('TEST_LAUNCH'):
    with open(os.environ['TEST_LAUNCH'], 'w') as record:
        json.dump(vars(options), record)


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):
        body = json.dumps({'status': 'ok', 'pid': os.getpid()}).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        with open(os.environ['TEST_REQUEST'], 'w') as record:
            json.dump(request, record)
        prompt = request['messages'][-1]['content']
        if prompt == 'reject':
            body = b'{"error":{"message":"Unsupported chat template"}}'
            self.send_response(400)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.close_connection = True
        try:
            event = 'data: ' + json.dumps({'choices': [{'delta': {'content': 'caffè ☕', 'reasoning_content': 'Thinking'}}]}, ensure_ascii=False) + '\r\n\r\n'
            for byte in event.encode():
                self.wfile.write(bytes([byte]))
                self.wfile.flush()
            if prompt == 'wait':
                while True:
                    self.wfile.write(b': heartbeat\n\n')
                    self.wfile.flush()
                    time.sleep(0.02)
            elif prompt != 'interrupted':
                self.wfile.write(b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


print('Test server started', flush=True)
ThreadingHTTPServer((options.host, options.port), Handler).serve_forever()
