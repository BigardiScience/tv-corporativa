#!/usr/bin/env python3
"""Executa um comando dentro de um pseudo-terminal (TTY de verdade) e digita as respostas combinadas.

Uso (usado só pelos testes, somente em Linux/macOS):
    pty-driver.py '<json>'
com {"argv": [...], "cwd": "...", "env": {...}, "steps": [{"expect": "regex", "send": "texto\\n"}], "timeout": 30}

Para cada passo, espera o texto esperado aparecer na saída ainda não consumida e só então digita a resposta.
Imprime em JSON: {"exit": <código>, "output": "<tudo o que o terminal mostrou>", "failedStep": <índice ou null>}.
"""
import json
import os
import pty
import re
import select
import sys
import time

spec = json.loads(sys.argv[1])
deadline = time.time() + spec.get("timeout", 30)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(spec["cwd"])
    os.execvpe(spec["argv"][0], spec["argv"], spec["env"])

output = b""
consumed = 0
failed = None


def read_some(wait=0.1):
    global output
    ready, _, _ = select.select([fd], [], [], wait)
    if not ready:
        return True
    try:
        chunk = os.read(fd, 65536)
    except OSError:
        return False
    if not chunk:
        return False
    output += chunk
    return True


alive = True
for index, step in enumerate(spec["steps"]):
    pattern = re.compile(step["expect"])
    while True:
        text = output[consumed:].decode("utf-8", "replace")
        match = pattern.search(text)
        if match:
            consumed += len(text[: match.end()].encode("utf-8"))
            break
        if not alive or time.time() > deadline:
            failed = index
            break
        alive = read_some()
    if failed is not None:
        break
    time.sleep(0.05)
    os.write(fd, step["send"].encode("utf-8"))

# Lê até o fim do processo.
while alive and time.time() < deadline:
    alive = read_some()

status = None
for _ in range(100):
    done, raw = os.waitpid(pid, os.WNOHANG)
    if done:
        status = os.waitstatus_to_exitcode(raw)
        break
    time.sleep(0.05)
if status is None:
    os.kill(pid, 9)
    os.waitpid(pid, 0)
    status = -9
    if failed is None:
        failed = len(spec["steps"])

print(json.dumps({"exit": status, "output": output.decode("utf-8", "replace"), "failedStep": failed}))
