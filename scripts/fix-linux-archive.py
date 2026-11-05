"""Repair Unix executable modes for tar.gz packages cross-built on Windows."""
from pathlib import Path
import os
import sys
import tarfile

archive = Path(sys.argv[1]).resolve()
release = Path('release').resolve()
if archive.parent != release or not archive.name.endswith('.tar.gz'):
    raise SystemExit('Expected a tar.gz directly inside release/')
temporary = archive.with_name(archive.name + '.tmp')
executables = {'trae-forum-client', 'chrome-sandbox', 'chrome_crashpad_handler'}
try:
    with tarfile.open(archive, 'r:gz') as source, tarfile.open(temporary, 'w:gz', compresslevel=6) as target:
        members = source.getmembers()
        root = Path(members[0].name).parts[0]
        for member in members:
            if member.name in {f'{root}/check-linux.sh', f'{root}/DESKTOP.md'}:
                continue
            member.uid = member.gid = 0
            member.uname = member.gname = 'root'
            if member.isdir() or Path(member.name).name in executables:
                member.mode = 0o755
            target.addfile(member, source.extractfile(member) if member.isfile() else None)
        def document_mode(info):
            info.mode = 0o644
            info.uid = info.gid = 0
            info.uname = info.gname = 'root'
            return info
        target.add('scripts/check-linux.sh', arcname=f'{root}/check-linux.sh', filter=document_mode)
        target.add('doc/05-桌面打包.md', arcname=f'{root}/DESKTOP.md', filter=document_mode)
    os.replace(temporary, archive)
finally:
    if temporary.exists():
        temporary.unlink()
print(archive)
