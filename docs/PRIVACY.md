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

Any optional web connection must be explicitly paired and authenticated. Its
published privacy details must describe its transport and temporary storage before
that feature is offered publicly. The current local release has no public relay.

Support: https://github.com/mikkel32/fast-desktop-command/issues
