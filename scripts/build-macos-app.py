#!/usr/bin/env python3
"""Build and sign the native app against this local development checkout."""
import json
import pathlib
import plistlib
import shutil
import subprocess

root = pathlib.Path(__file__).resolve().parent.parent
package = root / 'macos'
subprocess.run(['swift', 'build', '--package-path', str(package), '-c', 'release'], check=True)
binary_dir = pathlib.Path(subprocess.check_output(['swift', 'build', '--package-path', str(package), '-c', 'release', '--show-bin-path'], text=True).strip())
node = subprocess.check_output(['node', '-p', 'process.execPath'], text=True).strip()
app = root / 'Fast Desktop Command.app'
contents = app / 'Contents'
resources = contents / 'Resources'
macos = contents / 'MacOS'
resources.mkdir(parents=True, exist_ok=True)
macos.mkdir(parents=True, exist_ok=True)
shutil.copy2(binary_dir / 'FastDesktopCommand', macos / 'FastDesktopCommand')
(resources / 'Runtime.json').write_text(json.dumps({'node': node, 'project': str(root)}, indent=2) + '\n')
info = {
    'CFBundleName': 'Fast Desktop Command', 'CFBundleDisplayName': 'Fast Desktop Command',
    'CFBundleIdentifier': 'dk.mikkel.fast-desktop-command', 'CFBundleExecutable': 'FastDesktopCommand',
    'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': '1.0', 'CFBundleVersion': '1',
    'CFBundleIconFile': 'AppIcon', 'LSMinimumSystemVersion': '14.0',
    'NSHighResolutionCapable': True, 'NSPrincipalClass': 'NSApplication',
    'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True},
}
with (contents / 'Info.plist').open('wb') as handle:
    plistlib.dump(info, handle)
icon_root = package / '.build' / 'AppIcon.iconset'
icon_root.mkdir(exist_ok=True)
source = package / '.build' / 'AppIcon.png'
subprocess.run(['swift', str(package / 'DrawIcon.swift'), str(source)], check=True)
for size in [16, 32, 128, 256, 512]:
    for scale in [1, 2]:
        filename = f'icon_{size}x{size}{"@2x" if scale == 2 else ""}.png'
        subprocess.run(['/usr/bin/sips', '-z', str(size * scale), str(size * scale), str(source), '--out', str(icon_root / filename)], check=True, stdout=subprocess.DEVNULL)
subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(icon_root), '-o', str(resources / 'AppIcon.icns')], check=True)
subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(app)], check=True)
print(f'Built app: {app}')
