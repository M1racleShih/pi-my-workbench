#!/usr/bin/env python3
"""Isolated real-TUI summary/details/reload checks. Requires Pi and tmux; sends no model prompts."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', help='Local package directory or an already published Pi Git source')
parser.add_argument('--mode', choices=['regular', 'fullscreen'], default='fullscreen')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
source = args.source or str(root)
out = root / '.workbench' / ('startup-smoke-' + args.mode)
out.mkdir(parents=True, exist_ok=True)
socket = 'pi-workbench-startup-' + str(os.getpid())
pi = shutil.which('pi')
if not pi or not shutil.which('tmux'):
    raise SystemExit('Pi and tmux must be installed')

def tmux(*argv):
    return subprocess.check_output(['tmux', '-L', socket, *argv], text=True)

def capture(name):
    text = tmux('capture-pane', '-p', '-t', 'qa')
    (out / (name + '.txt')).write_text(text)
    assert not re.search(r'Failed to load extension|Extension error|Extension shortcut conflict', text, re.I), text
    return text

def wait_for(predicate, name, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        text = capture(name)
        if predicate(text):
            return text
        time.sleep(.1)
    raise AssertionError('Timed out waiting for ' + name + '\n' + text)

def collapsed(text):
    return 'Extensions · 1' in text and len(re.findall(r'\bpi-my-workbench\b', text)) == 1

expected = [
    'node_modules/pi-provider-model-picker/extensions',
    'node_modules/pi-session-titler/extensions/auto-session-name.ts',
    'node_modules/pi-hud',
    'extensions/block-editor.ts',
    'extensions/clear.ts',
    'extensions/model-overrides.ts',
]
with tempfile.TemporaryDirectory(prefix='pi-workbench-startup-') as temp:
    temp = Path(temp)
    agent = temp / 'agent'; agent.mkdir()
    cwd = temp / 'workspace'; cwd.mkdir()
    home = temp / 'home'; home.mkdir()
    env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'TERM': 'xterm-256color', 'LANG': 'C.UTF-8',
           'PI_CODING_AGENT_DIR': str(agent), 'PI_OFFLINE': '1', 'PI_TITLE_OFF': '1',
           'PI_PROVIDER_MODEL_PICKER_SHORTCUT': 'alt+m'}
    if source.startswith(('git:', 'npm:')):
        # Install outside the real agent directory before the offline TUI starts.
        subprocess.run([pi, 'install', source], cwd=cwd, env=env, check=True)
    settings = {'packages': [source], 'skills': [], 'quietStartup': False, 'theme': 'light',
                'defaultProvider': 'workbench-offline', 'defaultModel': 'dummy'}
    (agent / 'settings.json').write_text(json.dumps(settings))
    (agent / 'models.json').write_text(json.dumps({'providers': {'workbench-offline': {
        'baseUrl': 'http://127.0.0.1:9/v1', 'api': 'openai-completions', 'apiKey': 'test-only-not-a-credential',
        'models': [{'id': 'dummy', 'name': 'Offline Dummy', 'reasoning': False, 'input': ['text'],
                    'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0},
                    'contextWindow': 32768, 'maxTokens': 1024}],
    }}}))
    launch = ['env', '-i', *[f'{key}={value}' for key, value in env.items()], pi, '--offline', '--no-session',
              '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-mcp', '--no-approve',
              '--title-off', '--tui-mode', args.mode]
    try:
        tmux('new-session', '-d', '-s', 'qa', '-x', '120', '-y', '65', '-c', str(cwd), shlex.join(launch))
        first = wait_for(lambda text: collapsed(text) and 'ready' in text, '01-collapsed')
        for entry in ('clear.ts', 'model-overrides.ts', 'pi-provider-model-picker', 'pi-block-editor', 'auto-session-name.ts'):
            assert entry not in first, first
        tmux('send-keys', '-t', 'qa', 'C-o')
        wait_for(lambda text: '[Extensions]' in text and all(path in text for path in expected), '02-expanded')
        tmux('send-keys', '-t', 'qa', 'C-o')
        wait_for(collapsed, '03-collapsed')
        tmux('send-keys', '-t', 'qa', '-l', '/reload')
        tmux('send-keys', '-t', 'qa', 'Escape', 'Enter')
        time.sleep(.8)
        wait_for(collapsed, '04-reload')
        tmux('resize-window', '-t', 'qa', '-x', '36', '-y', '45')
        wait_for(collapsed, '05-narrow')
        print(json.dumps({'mode': args.mode, 'source': source, 'collapsedGroups': 1,
                          'nativeDetailEntries': len(expected), 'modelPromptsSent': 0,
                          'checks': ['startup', 'expanded-details', 'collapse', 'reload', 'narrow']}, ensure_ascii=False))
        print('Evidence:', out)
    finally:
        subprocess.run(['tmux', '-L', socket, 'kill-server'], capture_output=True)
