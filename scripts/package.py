"""Package source and deployment templates while excluding local credentials."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
output = root.parent / f'discord-game-roster-bot-v{version}.zip'
names = ('README.md', 'CHANGELOG.md', 'START.cmd', 'DEV.cmd', 'DEMO.cmd',
         'SETTINGS.cmd', 'REVIEW_REPORT.md', 'package.json', 'package-lock.json',
         '.env.example', '.gitignore', '.dockerignore', 'Dockerfile')
files = [root / name for name in names]
files.extend(root.glob('FEATURE_REVIEW_V*.md'))
blocked = {'node_modules', '.git', '__pycache__', '.env', 'config.local.json', 'config.json'}
for folder in ('src', 'public', 'scripts', 'test', 'deploy'):
    for file in (root / folder).rglob('*'):
        relative = file.relative_to(root)
        if any(part in blocked for part in relative.parts) or file.suffix in {'.pem', '.key', '.pyc'}:
            continue
        if file.is_symlink():
            raise ValueError('Refusing to package a symbolic link')
        if file.is_file():
            files.append(file)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for file in sorted(set(files)):
        if file.is_symlink():
            raise ValueError('Refusing to package a symbolic link')
        archive.write(file, file.relative_to(root).as_posix())
    archive.writestr('data/.gitkeep', '')
print(f'{output}: {len(set(files))+1} files')
