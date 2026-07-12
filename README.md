# Conference Timeline

**English** | [한국어](README.ko.md)

A desktop app for researchers to track conference deadlines and manage journal submissions — with an MCP server so AI assistants (Claude, Codex/GPT) can research conferences on the web and push them straight into the app.

Built with [Tauri 2](https://tauri.app) + React + TypeScript. Runs on **Windows, macOS, and Linux**. All data stays local — no account, no server.

## Demo

![App walkthrough — tracking a conference, adding one manually, map view, journal kanban](docs/demo-mcp.gif)
![App walkthrough — tracking a conference, adding one manually, map view, journal kanban](docs/demo.gif)
## Features

### 📅 Timeline
- Conferences sorted by their next upcoming milestone, with a **D-day countdown** and urgency coloring (red ≤ 7 days, yellow ≤ 30 days).
- Full *Important Dates* schedule per conference (abstract deadline, paper deadline, notification, camera-ready, event dates), with past items dimmed and the next milestone highlighted.
- **Timezone-aware deadlines** — shown in the timezone the conference announced (AoE, UTC-8, KST, …).
- Track (★) the conferences you care about and filter to them.
- One-click cleanup of past-year records.

### 🗺 Map
- World map of all conference venues with zoom/pan.
- Conferences in the same city cluster into a numbered marker; click for details, next deadline, and site link.
- Filter by year.

### 📋 Journal Kanban
- Paper pipeline: **Idea → Drafting → Submitted → Under Review → Revision → Accepted / Rejected** (drag & drop).
- Journal list with publisher, SJR quartile (Q1–Q4), and impact factor; one click to look a journal up on [SCImago](https://www.scimagojr.com).
- Per-card notes with `- [ ]` checkboxes and `~~strikethrough~~`, rendered as a clickable preview.

### Three ways to add conferences
1. **Manual form** — name, place, dates, deadline, link.
2. **AI research prompt → JSON import** — the *📋 Claude prompt* button builds a research request you paste into any AI chat with web search (Claude, ChatGPT, …); it returns JSON you import with *⬆ Import JSON*.
3. **MCP** — connect the bundled MCP server and just ask your assistant: *"Add ICRA 2027 to my timeline and track it."* See [MCP integration](#mcp-integration).

## Installation

### Prerequisites (all platforms)

- [Node.js](https://nodejs.org) 18+ (LTS recommended)
- [Rust](https://rustup.rs) (stable, via rustup)

### Platform-specific dependencies

**Windows**
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the *"Desktop development with C++"* workload
- WebView2 runtime (preinstalled on Windows 10/11)

**macOS**
```sh
xcode-select --install
```

**Ubuntu / Debian**
```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Run in development

```sh
npm install
npm run tauri dev
```

`npm run dev` alone runs the UI in a plain browser (localStorage fallback; MCP inbox is desktop-only).

### Build installers

#### On your own machine

```sh
npm run tauri build
```

The installers land in `src-tauri/target/release/bundle/`:

| OS you build on | Artifacts produced | How the user installs |
|---|---|---|
| Windows | `.msi`, `.exe` (NSIS) | double-click |
| macOS | `.app`, `.dmg` | drag into Applications |
| Linux | `.deb`, `.rpm`, `.AppImage` | `sudo apt install ./*.deb`, or `chmod +x *.AppImage && ./*.AppImage` |

> ⚠️ **Tauri does not cross-compile.** `npm run tauri build` only produces installers for the OS you run it on (each platform uses a different webview engine — WebView2 on Windows, WebKit on macOS, webkit2gtk on Linux). To ship a Windows `.exe` you need a Windows machine; for a Linux build you need Linux; and so on. To cover all three without owning all three machines, use the GitHub Actions workflow below.
>
> On macOS you can build one universal binary for both Intel and Apple Silicon:
> ```sh
> rustup target add aarch64-apple-darwin x86_64-apple-darwin
> npm run tauri build -- --target universal-apple-darwin
> ```

#### All three OSes automatically (GitHub Actions)

[`.github/workflows/release.yml`](.github/workflows/release.yml) builds Windows, macOS (universal), and Linux installers in the cloud and attaches them to a **draft** GitHub Release. Trigger it by pushing a version tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

Then open the repo's **Releases** page, review the draft with all the installers attached, and publish it. (You can also run it manually from the **Actions** tab via *workflow_dispatch*.)

> The binaries are **unsigned**, so first-launch shows a Gatekeeper prompt on macOS (right-click → Open) and a SmartScreen prompt on Windows (More info → Run anyway). Proper code signing needs paid certificates and is out of scope here.

## Usage

- **Timeline** — the toolbar filters (*All* / *★ Tracked*), searches by name or city, and holds the add/import buttons. Each row shows the schedule, D-day, and site link; custom conferences get *Edit*/*Delete*.
- **Map** — scroll to zoom, drag to pan; click a marker for details or a city list.
- **Journal Kanban** — type a title and press *+ Add* to create a card; drag cards between stages or use the ◀ ▶ buttons. Click a card to open the detail modal (target journal, stage, planned submission date, notes). The side panel manages your journal list.
- Re-importing JSON (or re-adding via MCP) with an existing conference name **updates** it instead of duplicating.

## MCP integration

The bundled MCP server (`mcp-server/server.mjs`) lets MCP clients — **Claude Desktop, Claude Code, and Codex CLI (GPT)** — read the app's state and queue changes. The assistant researches conferences on the web, then calls tools like `add_conferences`; the app picks the changes up within seconds (it polls an inbox file — the server never writes app data directly, so there are no conflicts).

![MCP demo — left: Claude issuing MCP tool calls; right: the desktop app scrolling to each change and flashing it](docs/demo-mcp.gif)

*Live capture, in sync. **Left:** the actual MCP tool calls Claude makes. **Right:** the real desktop app reacting within seconds — it scrolls the changed conference into view and flashes it, so you can see exactly what changed. `add_conferences` drops **ICRA 2027** in at the top of the Timeline (sorted by deadline, starred), then **IROS 2027** further down (the app scrolls to it); `track_conferences` stars IROS. Each change is also confirmed by the app's update banner.*

### Setup

The server uses this repository's `node_modules`, so first:

```sh
git clone <this-repo> && cd conference-timeline
npm install
```

Then register it with your client, using the **absolute path** to `mcp-server/server.mjs`:

**Claude Desktop** — add to `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "conference-timeline": {
      "command": "node",
      "args": ["/absolute/path/to/conference-timeline/mcp-server/server.mjs"]
    }
  }
}
```

**Claude Code**

```sh
claude mcp add conference-timeline -- node /absolute/path/to/conference-timeline/mcp-server/server.mjs
```

**Codex CLI (GPT)** — add to `~/.codex/config.toml`:

```toml
[mcp_servers.conference-timeline]
command = "node"
args = ["/absolute/path/to/conference-timeline/mcp-server/server.mjs"]
```

or:

```sh
codex mcp add conference-timeline -- node /absolute/path/to/conference-timeline/mcp-server/server.mjs
```

Restart the client, launch the app at least once (this creates the data directory), and try:

> Add ICRA 2027 and IROS 2027 to my conference timeline and track them.
> Look up the official Important Dates on the web first.

### Tools

| Tool | What it does |
|---|---|
| `add_conferences` | Add/update conferences with the full Important Dates schedule (asks the model to research the web first) |
| `track_conferences` | Track / untrack conferences by name |
| `add_journals` | Add or update journals (publisher, SJR quartile, IF, link) |
| `add_submission` | Create a kanban paper card (stage, target journal, notes, planned date) |
| `append_note` | Append to a card's notes (checkboxes / strikethrough supported) |
| `list_state` | Summarize current app state — call first to avoid duplicates |

### Data locations

Everything lives in Tauri's app-data directory (`store.json` = your data, `mcp-inbox.json` = pending MCP operations):

| OS | Path |
|---|---|
| Windows | `%APPDATA%\com.yjkim.conference-timeline\` |
| macOS | `~/Library/Application Support/com.yjkim.conference-timeline/` |
| Linux | `$XDG_DATA_HOME/com.yjkim.conference-timeline/` (default `~/.local/share/...`) |

## License

MIT
