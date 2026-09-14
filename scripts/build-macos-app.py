#!/usr/bin/env python3
"""Build and sign the native app against this local development checkout."""
import json
import pathlib
import plistlib
import shutil
import subprocess
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--portable', action='store_true')
parser.add_argument('--output')
options = parser.parse_args()

root = pathlib.Path(__file__).resolve().parent.parent
version = json.loads((root / 'package.json').read_text())['version']
package = root / 'macos'
subprocess.run(['swift', 'build', '--package-path', str(package), '-c', 'release'], check=True)
binary_dir = pathlib.Path(subprocess.check_output(['swift', 'build', '--package-path', str(package), '-c', 'release', '--show-bin-path'], text=True).strip())
node = subprocess.check_output(['node', '-p', 'process.execPath'], text=True).strip()
app = pathlib.Path(options.output).resolve() if options.output else root / 'Fast Desktop Command.app'
contents = app / 'Contents'
resources = contents / 'Resources'
macos = contents / 'MacOS'
resources.mkdir(parents=True, exist_ok=True)
macos.mkdir(parents=True, exist_ok=True)
shutil.copy2(binary_dir / 'FastDesktopCommand', macos / 'FastDesktopCommand')
shutil.copy2(binary_dir / 'NativeControl', macos / 'NativeControl')
runtime_config = {'node': node, 'project': str(root)}
if options.portable:
    runtime = resources / 'Runtime'
    engine = runtime / 'engine'
    (runtime / 'bin').mkdir(parents=True, exist_ok=True)
    engine.mkdir(parents=True, exist_ok=True)
    shutil.copy2(node, runtime / 'bin' / 'node')
    node_license = pathlib.Path(node).parent.parent / 'LICENSE'
    if node_license.exists(): shutil.copy2(node_license, runtime / 'NODE-LICENSE')
    for filename in ['package.json', 'package-lock.json', 'LICENSE', 'icon.png', 'header.png', 'logo.png']:
        shutil.copy2(root / filename, engine / filename)
    for folder in ['dist', 'assets']:
        shutil.copytree(root / folder, engine / folder, dirs_exist_ok=True)
    (engine / 'scripts').mkdir(exist_ok=True)
    for filename in ['app-service.mjs', 'app-connect.mjs', 'web-connection.mjs']:
        shutil.copy2(root / 'scripts' / filename, engine / 'scripts' / filename)
    subprocess.run(['npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', str(engine)], check=True)
    # Install the platform search binary inside the bundle, so search does not
    # depend on Homebrew or any executable in the developer's PATH.
    subprocess.run(['npm', 'rebuild', '@vscode/ripgrep', '--prefix', str(engine)], check=True)
    ripgrep = subprocess.check_output(['node', '--input-type=module', '-e',
        "import {rgPath} from '@vscode/ripgrep'; process.stdout.write(rgPath)"], cwd=engine, text=True).strip()
    subprocess.run([ripgrep, '--version'], check=True, stdout=subprocess.DEVNULL)
    runtime_config = {'node': 'Runtime/bin/node', 'project': 'Runtime/engine'}
(resources / 'Runtime.json').write_text(json.dumps(runtime_config, indent=2) + '\n')
info = {
    'CFBundleName': 'Fast Desktop Command', 'CFBundleDisplayName': 'Fast Desktop Command',
    'CFBundleIdentifier': 'dk.mikkel.fast-desktop-command', 'CFBundleExecutable': 'FastDesktopCommand',
    'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': version, 'CFBundleVersion': version,
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
subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(macos / 'NativeControl')], check=True)
subprocess.run(['/usr/bin/codesign', '--force', '--sign', '-', str(app)], check=True)
print(f'Built app: {app}')
