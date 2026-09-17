from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parent.parent
output = root.parent / 'discord-game-roster-bot.zip'
files = [root / name for name in ('README.md','CHANGELOG.md','START.cmd','DEV.cmd','DEMO.cmd','SETTINGS.cmd','REVIEW_REPORT.md','NEW_CHAT_HANDOFF.md','package.json','package-lock.json','.env.example','.gitignore')]
for folder in ('src','public','scripts','test'):
    files.extend(p for p in (root / folder).rglob('*') if p.is_file() and '__pycache__' not in p.parts)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for file in sorted(files):
        archive.write(file, file.relative_to(root).as_posix())
    archive.writestr('data/.gitkeep','')
print(f'{output}: {len(files)+1} files')
