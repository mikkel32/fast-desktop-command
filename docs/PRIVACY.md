# Privacy

FAST Desktop Command runs requested file, command, and image operations on the
computer running its engine. The local Swift app uses private local connections.
It does not provide public or anonymous access to your computer.

The local entrypoint disables upstream telemetry, including analytics collection.
Configuration, tool history, and diagnostic logs are stored locally. Requested tool
results are returned to the connected AI client; its data-handling terms also apply.
Diagnostics can contain file paths or command output. Review them before sharing.

The app's health checks run a small local command and read the bundled test image.
They do not inspect unrelated documents. Local health authentication tokens are
not included in the Copy diagnostics output.

Web access is optional. Sign in with ChatGPT on the FAST site, approve a short-lived
pairing code, and connect the OAuth plugin. The service records the account ID,
device name, pairing time, and last connection time. Device and OAuth credentials
are stored as hashes on the service; the Mac keeps its device credential in its
private runtime directory. Every execution checks account and device ownership.

The Sites relay temporarily stores requested commands and tool results, including
file or screenshot bytes requested through the web plugin. Results are available
for three minutes, then expire and are removed during subsequent service activity.
Provider operational logs and backups can have their own retention. Local tool
history remains on the Mac. Do not use the relay for data you do not want processed
by the hosting service and connected AI client.

Disconnect in the app to stop web delivery. Revoke a Mac on the website to reject
its device credential. Disconnect the plugin in ChatGPT to remove its account link.
The public website and public tool schemas never grant anonymous Mac access.
Native screenshots require Screen Recording; mouse and keyboard input require
both the app's explicit toggle and macOS Accessibility permission.

Support: https://github.com/mikkel32/fast-desktop-command/issues
