"""Package source and deployment templates while excluding local credentials."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import os

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
output = root.parent / f'discord-game-roster-bot-v{version}.zip'
names = ('README.md', 'CHANGELOG.md', 'START.cmd', 'DEV.cmd', 'DEMO.cmd',
         'SETTINGS.cmd', 'REVIEW_REPORT.md', 'package.json', 'package-lock.json',
         '.env.example', '.gitignore', '.gitattributes', '.dockerignore',
         'Dockerfile', 'Dockerfile.railway', 'railway.json', 'NEW_CHAT_HANDOFF.md')
files = [root / name for name in names]
if (root / '.env.production.example').exists():
    files.append(root / '.env.production.example')
files.extend(root.glob('FEATURE_REVIEW_V*.md'))
blocked = {'node_modules', '.git', '__pycache__', 'data', 'backups', 'logs',
           'config.local.json', 'config.json'}
env_templates = {'.env.example', '.env.production.example', 'production.env.example'}


def excluded(file):
    parts = [part.lower() for part in file.relative_to(root).parts]
    if any(part in blocked for part in parts):
        return True
    name = file.name.lower()
    if name not in env_templates and (name.startswith('.env') or name.endswith('.env') or '.env.' in name):
        return True
    return file.suffix.lower() in {'.pem', '.key', '.pyc', '.log', '.bak', '.tmp'}


def reject_link(file):
    if file.is_symlink() or getattr(file, 'is_junction', lambda: False)():
        raise ValueError('Refusing to package a symbolic link or junction')


for folder in ('src', 'public', 'scripts', 'test', 'deploy', 'docs', '.github'):
    source = root / folder
    reject_link(source)
    for directory, directories, filenames in os.walk(source, followlinks=False):
        for name in directories[:]:
            child = Path(directory) / name
            if excluded(child):
                directories.remove(name)
            else:
                reject_link(child)
        for name in filenames:
            file = Path(directory) / name
            if not excluded(file):
                reject_link(file)
                files.append(file)
files = sorted(set(files))
for file in files:
    reject_link(file)
    if excluded(file) or not file.is_file():
        raise ValueError('Invalid source file in package')
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for file in files:
        archive.write(file, file.relative_to(root).as_posix())
    archive.writestr('data/.gitkeep', '')
print(f'{output}: {len(set(files))+1} files')
