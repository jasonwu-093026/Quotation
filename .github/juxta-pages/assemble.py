#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath

MARKER = '__juxta_preview.json'
BASE_MARKER = '__juxta_base.json'
VERSION = 1
SHA = re.compile(r'[0-9a-f]{40}')


class PreviewError(RuntimeError):
    pass


def git(repo, *args, data=None, env=None):
    clean = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    clean.update(env or {})
    cp = subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', '-C', str(repo), *args],
                        input=data, capture_output=True, env=clean, timeout=90)
    if cp.returncode:
        raise PreviewError(f'git {args[0]} failed: {cp.stderr.decode(errors="replace")[-400:]}')
    return cp.stdout.decode().strip() if data is None else cp.stdout


def archive(repo, sha, root):
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise PreviewError('source must be a full commit SHA')
    if not isinstance(root, str) or not root:
        raise PreviewError('static site root must be a relative path')
    prefix = PurePosixPath(root)
    if prefix.is_absolute() or '..' in prefix.parts:
        raise PreviewError('static site root must be a relative path')
    cp = subprocess.run(['git', '-C', str(repo), 'archive', '--format=tar', sha],
                        capture_output=True, timeout=90)
    if cp.returncode:
        raise PreviewError('cannot archive remote commit')
    inventory = subprocess.run(['git', '-C', str(repo), 'ls-tree', '-r', '-z', sha],
                               capture_output=True, check=True, timeout=30).stdout
    expected = {}
    for record in inventory.split(b'\0'):
        if not record:
            continue
        metadata, name = record.split(b'\t', 1)
        mode, kind, oid = metadata.decode().split()
        path = PurePosixPath(name.decode('utf-8'))
        if root != '.' and not path.is_relative_to(prefix):
            continue
        if mode not in ('100644', '100755') or kind != 'blob':
            raise PreviewError('static previews refuse symlinks and submodules')
        expected[(path if root == '.' else path.relative_to(prefix)).as_posix()] = oid
    files = {}
    with tarfile.open(fileobj=io.BytesIO(cp.stdout)) as tar:
        for entry in tar:
            path = PurePosixPath(entry.name)
            if path.is_absolute() or '..' in path.parts:
                raise PreviewError('unsafe archive path')
            if root != '.' and not path.is_relative_to(prefix):
                continue
            relative = path if root == '.' else path.relative_to(prefix)
            if entry.isdir():
                continue
            if not entry.isfile():
                raise PreviewError('static previews refuse symlinks and nonregular entries')
            name = relative.as_posix()
            if name.split('/')[0] in ('pr-preview', MARKER, BASE_MARKER, '.git'):
                raise PreviewError('site uses a reserved preview path')
            files[name] = (tar.extractfile(entry).read(), entry.mode & 0o777)
    if set(expected) != set(files):
        raise PreviewError('archive attributes omitted committed site files')
    for name, (data, _) in files.items():
        if git(repo, 'hash-object', '--stdin', data=data).decode().strip() != expected[name]:
            raise PreviewError('archive attributes changed committed site bytes')
    if not any(p.lower().endswith(('.html', '.htm')) for p in files):
        raise PreviewError('preview root has no static HTML pages')
    return files


def snippet(cfg, number, sha):
    namespace = hashlib.sha256(cfg['slug'].casefold().encode()).hexdigest()[:16]
    payload = dict(namespace=f'juxta-preview:{namespace}:pr-{number}:', number=number, sha=sha)
    asset = Path(__file__).with_name('preview_storage.js').read_text()
    return ('<script data-juxta-preview>const JUXTA_PREVIEW = '
            + json.dumps(payload) + ';\n' + asset + '\n</script>')


def inject(html, script):
    try:
        text = html.decode('utf-8-sig')
    except UnicodeError as exc:
        raise PreviewError('preview HTML must be UTF-8') from exc
    if re.search(r'<meta\b[^>]*http-equiv\s*=\s*[\"\']?content-security-policy', text, re.I):
        raise PreviewError('preview HTML CSP would prevent guaranteed early storage isolation')
    if 'data-juxta-preview' in text:
        raise PreviewError('site already uses the reserved preview injection marker')
    doctype = re.match(r'\s*<!doctype[^>]*>', text, re.I)
    offset = doctype.end() if doctype else 0
    return (text[:offset] + script + text[offset:]).encode()


def build_tree(repo, cfg, base_sha, heads):
    files = archive(repo, base_sha, cfg['preview']['root'])
    files[BASE_MARKER] = (json.dumps(dict(sha=base_sha, version=VERSION)).encode(), 0o644)
    files.setdefault('.nojekyll', (b'', 0o644))
    for number, sha in sorted(heads.items()):
        if type(number) is not int or number <= 0:
            raise PreviewError('invalid PR number')
        site = archive(repo, sha, cfg['preview']['root'])
        script = snippet(cfg, number, sha)
        for path, (data, mode) in site.items():
            if path.lower().endswith(('.html', '.htm')):
                data = inject(data, script)
            files[f'pr-preview/pr-{number}/{path}'] = (data, mode)
        marker = dict(sha=sha, pr=number, slug=cfg['slug'], version=VERSION,
                      isolation=hashlib.sha256(script.encode()).hexdigest())
        files[f'pr-preview/pr-{number}/{MARKER}'] = (json.dumps(marker).encode(), 0o644)
    return files


def github(path, token):
    request = urllib.request.Request('https://api.github.com/' + path,
                                    headers={'Accept': 'application/vnd.github+json',
                                             'Authorization': 'token ' + token,
                                             'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except (urllib.error.URLError, ValueError) as exc:
        raise PreviewError(f'GitHub inventory unavailable: {type(exc).__name__}') from exc


def public_inventory(slug, token):
    repository = github(f'repos/{slug}', token)
    pulls = []
    page = 1
    while True:
        batch = github(f'repos/{slug}/pulls?state=open&per_page=100&page={page}', token)
        if not isinstance(batch, list):
            raise PreviewError('open PR inventory is unreadable')
        pulls.extend(batch)
        if len(batch) < 100:
            return {'repository': repository, 'pulls': pulls}
        page += 1


def heads_from_inventory(slug, inventory):
    if not isinstance(inventory, dict):
        raise PreviewError('repository inventory is unreadable')
    repository = inventory.get('repository')
    if (not isinstance(repository, dict) or repository.get('private') is not False
            or str(repository.get('full_name', '')).casefold() != slug.casefold()):
        raise PreviewError('publication refused: repository must be confirmed public')
    pulls = inventory.get('pulls')
    if not isinstance(pulls, list):
        raise PreviewError('open PR inventory is unreadable')
    heads = {}
    for pr in pulls:
        if not isinstance(pr, dict):
            raise PreviewError('incomplete open PR inventory')
        if pr.get('state', 'open') != 'open':
            continue
        head = pr.get('head') or {}
        if not isinstance(head, dict):
            raise PreviewError('incomplete PR head inventory')
        source = head.get('repo') or {}
        if not isinstance(source, dict):
            raise PreviewError('incomplete PR repository inventory')
        if str(source.get('full_name', '')).casefold() != slug.casefold():
            continue
        number, sha = pr.get('number'), head.get('sha')
        if type(number) is not int or number <= 0 or not isinstance(sha, str) or not SHA.fullmatch(sha):
            raise PreviewError('incomplete same-repository PR inventory')
        if number in heads:
            raise PreviewError('duplicate PR identity in inventory')
        heads[number] = sha
    return heads


def assemble(remote, cfg, inventory, output, token=''):
    heads = heads_from_inventory(cfg['slug'], inventory)
    base = cfg['base_branch']
    if (not isinstance(base, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_./-]*', base)
            or '..' in base or '//' in base or base.endswith(('/', '.', '.lock'))):
        raise PreviewError('invalid base branch')
    output = Path(output)
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise PreviewError('assembly output must be an empty dedicated directory')
    authentication = {}
    if token:
        authorization = base64.b64encode(('x-access-token:' + token).encode()).decode()
        authentication = {'GIT_CONFIG_COUNT': '1',
                          'GIT_CONFIG_KEY_0': 'http.https://github.com/.extraheader',
                          'GIT_CONFIG_VALUE_0': 'AUTHORIZATION: basic ' + authorization}
    with tempfile.TemporaryDirectory(prefix='juxta-pages-objects-') as temporary:
        repo = Path(temporary)
        git(repo, 'init', '--bare', '-q')
        specs = [f'+refs/heads/{base}:refs/juxta/base']
        specs += [f'+refs/pull/{n}/head:refs/juxta/pr/{n}' for n in heads]
        git(repo, 'fetch', '--no-tags', remote, *specs, env=authentication)
        base_sha = git(repo, 'rev-parse', 'refs/juxta/base^{commit}')
        for number, sha in heads.items():
            if git(repo, 'rev-parse', f'refs/juxta/pr/{number}^{{commit}}') != sha:
                raise PreviewError(f'PR #{number} changed during assembly; retry fresh inventory')
        files = build_tree(repo, cfg, base_sha, heads)
        current = git(repo, 'ls-remote', remote, f'refs/heads/{base}', env=authentication).split()
        if not current or current[0] != base_sha:
            raise PreviewError('base changed during assembly; retry fresh inventory')
        output.mkdir(parents=True, exist_ok=True)
        for name, (data, mode) in files.items():
            destination = output / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            destination.chmod(mode)
    return {'base': base_sha, 'heads': heads, 'files': len(files), 'output': str(output)}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--slug', default=os.environ.get('GITHUB_REPOSITORY'))
    parser.add_argument('--base', default='main')
    parser.add_argument('--root', default='.')
    parser.add_argument('--output', required=True)
    parser.add_argument('--inventory', type=Path)
    parser.add_argument('--remote')
    args = parser.parse_args(argv)
    try:
        if not args.slug or not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.slug):
            raise PreviewError('a repository slug is required')
        token = os.environ.get('GITHUB_TOKEN', '')
        if args.inventory:
            inventory = json.loads(args.inventory.read_text())
            remote = args.remote or 'https://github.com/' + args.slug + '.git'
        else:
            if args.remote:
                raise PreviewError('custom remotes are only available with recorded fixture inventory')
            if not token:
                raise PreviewError('GITHUB_TOKEN is required for live inventory')
            inventory = public_inventory(args.slug, token)
            remote = 'https://github.com/' + args.slug + '.git'
        cfg = {'slug': args.slug, 'base_branch': args.base, 'preview': {'kind': 'pages', 'root': args.root}}
        result = assemble(remote, cfg, inventory, args.output, token=token)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (PreviewError, OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f'Pages assembly refused: {exc}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
