"""Create a handoff ZIP from tracked source plus the Apps Script install bundle."""
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
output = root.parent / 'checking-takbaischool-ready.zip'
excluded = {'.git', 'node_modules', 'dist', 'artifacts', '__pycache__'}
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(root.rglob('*')):
        relative = file.relative_to(root)
        if file.is_file() and not any(part in excluded for part in relative.parts) and file.name not in {'.clasp.json','.clasprc.json'} and not file.name.startswith('.env'):
            archive.write(file, Path('checking-takbaischool') / relative)
    for name in ['Code.gs','Bridge.html','appsscript.json']:
        file=root/'artifacts'/name
        if file.is_file():archive.write(file,Path('checking-takbaischool')/'install'/name)
print(f'ZIP prepared: {output.name} ({output.stat().st_size:,} bytes)')
