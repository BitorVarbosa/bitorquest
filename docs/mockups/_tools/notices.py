"""Write THIRD-PARTY-NOTICES.md: every package whose code is in the built site, with its licence.

    npm run build
    python docs/mockups/_tools/notices.py

The list is read from the source maps of the build (dist/assets/*.map), so it names what is really
shipped, not what is merely installed. Each package's own licence file is copied in below its entry.
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
os.chdir(ROOT)

shipped = {}
for path in glob.glob('dist/assets/*.map'):
    for source in json.load(open(path, encoding='utf-8')).get('sources', []):
        hit = re.search(r'node_modules/((?:@[^/]+/)?[^/]+)/', source.replace('\\', '/'))
        if hit:
            shipped[hit.group(1)] = True
if not shipped:
    sys.exit('No packages found: run "npm run build" first.')

out = [
    '# Third-party notices',
    '',
    'Bitor Quest is built with the open-source packages below. Their code is part of the built site.',
    'Each is used under its own licence, reproduced here. This file is written by',
    '`docs/mockups/_tools/notices.py` from the build itself.',
    '',
    '| Package | Version | Licence |',
    '|---|---|---|',
]
entries = []
for name in sorted(shipped):
    folder = os.path.join('node_modules', name)
    meta = json.load(open(os.path.join(folder, 'package.json'), encoding='utf-8'))
    repo = meta.get('repository')
    repo = repo.get('url') if isinstance(repo, dict) else repo
    repo = re.sub(r'^git\+', '', repo or '').replace('github:', 'https://github.com/')
    repo = re.sub(r'\.git$', '', repo)
    texts = sorted(f for f in os.listdir(folder) if re.match(r'(?i)^(licen[cs]e|notice|copying)', f))
    out.append('| %s | %s | %s |' % (name, meta.get('version', ''), meta.get('license', 'see below')))
    entries.append((name, meta, repo, [(f, open(os.path.join(folder, f), encoding='utf-8', errors='replace').read().strip()) for f in texts]))

for name, meta, repo, texts in entries:
    out += ['', '## %s %s' % (name, meta.get('version', '')), '']
    if repo:
        out += ['Source: %s' % repo, '']
    if not texts:
        out += ['Licence: %s (the package ships no licence file of its own).' % meta.get('license', 'not stated'), '']
    for fname, text in texts:
        out += ['### %s' % fname, '', '```', text, '```', '']

open('THIRD-PARTY-NOTICES.md', 'w', encoding='utf-8', newline='\n').write('\n'.join(out).rstrip() + '\n')
print('wrote THIRD-PARTY-NOTICES.md with', len(entries), 'packages:', ', '.join('%s (%s)' % (n, m.get('license')) for n, m, _, _ in entries))
