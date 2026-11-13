#!/usr/bin/env python3
"""Test-only llama-server stand-in. No model inference is performed."""
# Pinned upstream API and diagnostic references are in mir/desktop/README.md.
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import sys
import time

if '--version' in sys.argv:
    print(os.environ.get('TEST_BACKEND_VERSION', 'Test llama-server'))
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
        data = {'status': 'ok', 'pid': os.getpid()}
        if self.path == '/props':
            data = {'default_generation_settings': {'n_ctx': 4096},
                    'chat_template_caps': {'supports_system_role': True, 'supports_reasoning_effort': True,
                                           'reasoning_effort_levels': ['low', 'high']}}
            if os.path.exists(os.environ['TEST_REQUEST'] + '.context-unavailable'):
                data['default_generation_settings'] = {}
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path == '/tokenize':
            assert request.get('add_special') is False
            assert request.get('with_pieces') is False
            with open(os.environ['TEST_REQUEST'] + '.tokenize', 'w') as record:
                json.dump(request, record)
            content = request['content']
            body = json.dumps({'tokens': list(range((len(content.encode()) + 3) // 4))}).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == '/apply-template':
            thinking = request.get('chat_template_kwargs', {}).get('enable_thinking', True)
            prompt = '\n\n'.join(message['content'] for message in request['messages']) + ('<think>' if thinking else '</think>')
            body = json.dumps({'prompt': prompt}).encode()
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        with open(os.environ['TEST_REQUEST'], 'w') as record:
            json.dump(request, record)
        # Failed assistant turns are omitted, so consecutive user turns can be
        # merged. Fixture control words belong to the final user paragraph.
        prompt = request['messages'][-1]['content'].split('\n\n')[-1]
        if prompt == 'context-reject':
            # Pinned server-context.cpp rejects oversized input before the first
            # SSE event, including stream:true requests. Never simulate truncation.
            body = json.dumps({'error': {
                'code': 400,
                'type': 'exceed_context_size_error',
                'message': 'request (5000 tokens) exceeds the available context size (4096 tokens), try increasing it',
                'n_prompt_tokens': 5000,
                'n_ctx': 4096,
            }}).encode()
            self.send_response(400)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if prompt in ('oom', 'compute-error'):
            if prompt == 'oom':
                report_memory_failure()
            body = b'{"error":{"code":500,"message":"Compute error.","type":"server_error"}}'
            self.send_response(500)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
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
            event = 'data: ' + json.dumps({'choices': [{'delta': {'content': 'caffè ☕', 'reasoning_content': 'Thinking'}}], 'timings': {'cache_n': 10, 'prompt_n': 20, 'predicted_n': 2, 'predicted_ms': 100, 'predicted_per_second': 20, 'prompt_ms': 30}}, ensure_ascii=False) + '\r\n\r\n'
            for byte in event.encode():
                self.wfile.write(bytes([byte]))
                self.wfile.flush()
            if prompt == 'memory-warning':
                print('warning: out of memory, using a smaller allocation; recovered', file=sys.stderr, flush=True)
            if prompt == 'oom-stream':
                # The test acknowledges receipt before the independent log failure.
                deadline = time.monotonic() + 5
                while (
                    not os.path.exists(os.environ['TEST_REQUEST'] + '.continue')
                    and time.monotonic() < deadline
                ):
                    time.sleep(0.01)
                report_memory_failure()
            if prompt in ('wait', 'oom-stream'):
                while True:
                    self.wfile.write(b': heartbeat\n\n')
                    self.wfile.flush()
                    time.sleep(0.02)
            elif prompt != 'interrupted':
                self.wfile.write(b'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":2,"total_tokens":32}}\n\ndata: [DONE]\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


def report_memory_failure():
    print('error: Insufficient Memory (kIOGPUCommandBufferCallbackErrorOutOfMemory)', file=sys.stderr, flush=True)
    print('backend is in error state from a previous command buffer failure - recreate the backend to recover', file=sys.stderr, flush=True)


if os.environ.get('TEST_SERVER_MODE') == 'oom-init' or os.path.exists(os.environ['TEST_REQUEST'] + '.oom-init'):
    report_memory_failure()
print('Test server started', flush=True)
ThreadingHTTPServer((options.host, options.port), Handler).serve_forever()
