<p align="center">
  <img src="mir/docs/images/logo.png" alt="Mir.cpp logo" width="220">
</p>

# Mir.cpp

Chat with local GGUF models in a desktop app. Mir.cpp manages llama.cpp,
your model settings and conversations on your computer.

Mir.cpp is written for humans to read, maintain, and improve.

[<img src="mir/docs/screenshots/desktop-chat.png" alt="Mir.cpp desktop conversation screen before configuring a model" width="640">](mir/docs/screenshots/desktop-chat.png)

*First-launch screen, before loading a model.*

## Installation

The desktop is intended for distribution as precompiled packages: a macOS disk
image and an Ubuntu Debian package, each including a pinned llama.cpp backend.
**No desktop release has been published yet.** The older v1.0.0 terminal edition
is separate from this development branch.

When desktop packages are released, open the macOS disk image and drag Mir.cpp to
Applications, or install the Ubuntu `.deb` with your package manager. Launch
**Mir.cpp** from Applications or the desktop application menu.

Requirements:

- macOS 13.5+ or a graphical Ubuntu 24.04+ session, on a supported architecture.
- A local GGUF supported by the selected llama.cpp backend and enough memory.
- Any GPU drivers required by an external backend.

Packaged startup needs no Bash, Python, Node.js or Rust toolchain. Model weights
are supplied separately. The regular desktop also accepts an existing external
llama.cpp build; capabilities are discovered from that build.

## First launch

1. In **Settings → Folders**, choose your models folder. Subfolders are searched too.
2. Choose a model in **Model settings**, review its settings and launch the server.
3. Start chatting. Optionally save your settings in **Saved configurations**.

**Modified** marks changes to a saved configuration. **Restart required** marks
changes to the running server. Stop response preserves partial text; closing the
app confirms shutdown of its server.

[<img src="mir/docs/screenshots/desktop-settings.png" alt="Mir.cpp model settings before choosing a GGUF" width="640">](mir/docs/screenshots/desktop-settings.png)

## Try the source locally

Install Node.js 22.13+, 24 or 26+, Rust 1.92+ and the platform's
[Tauri development prerequisites](https://v2.tauri.app/start/prerequisites/), then
run from the repository root:

```bash
npm --prefix mir/desktop ci
npm --prefix mir/desktop run desktop
```

After setup, only the second command is needed. A source development session has
no bundled backend: select an existing llama.cpp folder in **Settings → llama.cpp**.
You can open the app without model weights or an inference service.

See the [user and developer guide](mir/docs/guide.md) for settings, projects,
data locations, development checks, packaging and troubleshooting.
