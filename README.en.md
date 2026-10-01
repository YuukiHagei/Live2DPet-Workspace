# Live2DPet Workspace — AI Desktop Pet Companion

**[中文](README.md)** | **[日本語](README.ja.md)** | **English**

> The marketing name of this project is **Live2DPet Workspace**. The executable file and user data directory still use the original names `Live2DPet` / `live2dpet`. This does not affect usage.

> This project is a fork of [x380kkm/Live2DPet](https://github.com/x380kkm/Live2DPet), licensed under MIT.

An open-source desktop app that packs **AI chat, schedule management, flashcards, a Pomodoro timer, countdown timers, a task Agent, and cloud sync** into a Live2D desktop pet.

---

## Table of Contents

- [Core Features](#core-features)
  - [Chat and Memory](#1-chat-and-memory)
  - [Three Chat Modes](#2-three-chat-modes)
  - [Agent Built-in Tools](#3-agent-built-in-tools)
  - [MCP Tool Extension](#4-mcp-tool-extension)
  - [Calendar / Schedule / Reminder / Todo](#5-calendar--schedule--reminder--todo)
  - [Flashcards (SM-2)](#6-flashcards-sm-2)
  - [Timers / Pomodoro / Floating Bubble](#7-timers--pomodoro--floating-bubble)
  - [Daily Brief / Weekly / Monthly Reports](#8-daily-brief--weekly--monthly-reports)
  - [User Profile and Observation Data](#9-user-profile-and-observation-data)
  - [Cloud Sync](#10-cloud-sync)
  - [Mobile PWA](#11-mobile-pwa)
- [Quick Start](#quick-start)
- [Right-Click Menu Structure](#right-click-menu-structure)
- [Common Dialogue Examples](#common-dialogue-examples)
- [Data Storage](#data-storage)
- [Third-Party Licenses & Compliance](#third-party-licenses--compliance)
- [Troubleshooting](#troubleshooting)
- [Known Issues](#known-issues)
- [Requirements](#requirements)

---

## Core Features

### 1. Chat and Memory

- **Natural dialogue** — Works with any OpenAI-compatible API (DeepSeek, OpenRouter, Grok, Ollama, etc.)
- **Role-play** — Character cards define name, identity, personality, address terms, scenario, and hard rules
- **Remembers you** — Auto-extracts a "user profile" (name, occupation, goals, preferences, background) across conversations
- **Observes environment** — Reads active window titles and screenshots so the AI knows what you're doing
- **Voice synthesis** — VOICEVOX integration for Japanese voice (Chinese auto-translated to Japanese)
- **Days together** — Counts from first launch; AI can naturally mention "how long we've known each other"
- **Chat memory** — Keeps the last 12 chat messages, inserts date markers when the day changes
- **Agent history summary** — Sliding window of 20 messages + old messages compressed into a summary

### 2. Three Chat Modes

The toggle button on the left of the chat box cycles through icons:

| Icon | Mode | Behavior |
| :--- | :--- | :--- |
| 💬 | Chat | Casual conversation; AI proactively speaks |
| 🤖 | Agent | Calls tools to complete tasks (file ops, todos, flashcards, etc.) |
| 📋 | Plan | AI lists a step plan first; only executes after you approve |

### 3. Agent Built-in Tools

Just speak in natural language:

**File tools (allowed by default)**
- Read file, list dir, list dir tree
- Search by filename (supports `*.js` wildcards)
- Search by content (supports regex)

**Task tools (allowed by default)**
- Todo: add, list, complete, update, delete
- Schedule: add, list, update, delete
- Reminder: add, list, delete (supports daily/weekly repeat)
- Flashcard: add, update, list, review, delete, stats
- Timer: create countdown/count-up, list, pause, resume, delete
- Pomodoro: start multi-round work/break cycles

**Sensitive tools (ask by default)**
- Write file, open URL

Per-tool permissions can be set in **Settings → Agent Tool Permissions** to `allow` / `ask` / `deny`.

### 4. MCP Tool Extension

Connect any MCP Server in addition to built-in tools:
- **Settings → MCP → Click "+ Add Server"**
- Common examples: `@modelcontextprotocol/server-filesystem`, `mcp-server-git`
- Multiple servers supported; name conflicts auto-prefixed

### 5. Calendar / Schedule / Reminder / Todo

Right-click the pet → **Tools → Calendar**:

- **Month view**, days with schedules show markers
- **Multi-day schedules** span as a colored band
- Click a day to see **schedules, todos, reminders, flashcards**
- Create / edit / delete schedules, todos, reminders directly in the calendar
- **Reminder states**:
  - After firing: shows "✓ Triggered" (struck through)
  - Missed by >30 min: shows "⚠️ Missed"
- Toggle the **next review date** of flashcards

### 6. Flashcards (SM-2)

Right-click the pet → **Tools → Review Cards**:

- Front (question) and back (answer), with subject and tags
- Same **SM-2 spaced repetition algorithm** as Anki
- Four ratings: Again / Hard / Good / Easy
- Standalone window with shortcuts: Space to flip, 1/2/3/4 to rate, ESC to close
- Edit, delete, create, search, filter by subject/tag

### 7. Timers / Pomodoro / Floating Bubble

Right-click the pet → **Tools → Countdown / Timer**:

**Countdown**
- Custom name and duration (h/m/s)
- Quick presets: 1 min / 3 min / 5 min / 25 min
- Fires a custom notification (default editable in **Settings → Default Timer Notification**)
- Writes to calendar on completion

**Count-up**
- No target duration; user stops manually
- Reports "Total: X min Y sec" after stop
- Writes to calendar on completion

**Common actions**
- Pause / resume
- "🔄 Restart" after completion — change only the duration, keep the name
- Multiple timers run in parallel
- Supports `{name}`-like character card templates

**Pomodoro**
- One-click classic 25/5 cycle
- Quick presets: 25/5, 50/10, 90/20
- Customize work / break / long break / rounds-before-long-break / total rounds
- Auto-announces phase transitions, no manual intervention
- Writes only one summary event to calendar at the **end of the entire Pomodoro**

**Timer floating bubble**
- Independent transparent window, draggable to any screen position (position persisted)
- Shows remaining time of the first 3 running timers
- Hover to reveal **⏸ pause / ▶ resume / × stop** buttons
- **Auto-hides** when no timers, **auto-shows** when there are timers
- If user manually closes, it won't auto-reopen (until all timers are deleted)

### 8. Daily Brief / Weekly / Monthly Reports

**Morning brief (7:30 by default)**
- Weather, temperature, UV index
- Clothing advice based on temperature, sun protection based on UV
- Today's schedules, reminders, due todos

**Evening brief (22:00 by default)**
- What you completed today, what's still pending, tomorrow's schedules and reminders

**Weekly / Monthly reports**
- Weekly at Sun 21:00; monthly at the last day 21:00
- Todo completion rate, schedule count, review count, per-subject error rate

All briefs are generated in the character's voice, not mechanical data reading.

### 9. User Profile and Observation Data

Right-click the pet → **Memory**:

- **View Agent History** — Sliding window + summary of all Agent mode conversations
- **View Observation Data** — Frequent contacts (sorted by count, with topic tags), recent chat log (**window titles only**)
- **User Profile** — Long-term info the AI extracted about you (name, occupation, goals, preferences, background), can be reset

### 10. Cloud Sync

Settings → **Cloud Sync**:

Two providers, pick one:

**GitHub Gist** (recommended)
- Completely free
- Requires a **private Gist** and a **Personal Access Token** (only `gist` scope)
- Uses `https://api.github.com/gists`

**Nutstore WebDAV**
- Requires a Nutstore account + **App Password** (not login password)
- Uses `https://dav.jianguoyun.com/dav/`

**Features**
- **Auto-sync**: uploads 5 seconds after data changes
- **Flush on exit**: ensures sync completes before quitting
- **Silent startup sync**: runs 8 seconds after launch
- **Conflict detection**: pops up when both local and cloud have changed; choose **Keep Local / Keep Cloud / Merge**
- **Smart merge**: merges arrays by `id` + `updatedAt`, dedups chat by timestamp
- **Dangerous overwrite protection**: skips when local empty but cloud non-empty (or vice versa), preventing accidental wipes
- **Manual reset**: fixes false conflicts

Synced data: todos, schedules, reminders, flashcards, chat memory, agent history, user profile, observations, timers, companion stats, etc.

### 11. Mobile PWA

Open the deployment URL in iPhone/Android browser as a standalone app:

- **Data source** — Reads from the same Gist
- **Features** — View todos, schedules, flashcards; create/edit/delete; flashcard review
- **AI chat** — Independent API Key configuration; injects user profile and observations
- **Add to Home Screen** — iOS Safari Share → Add to Home Screen for fullscreen

See PWA deployment section (optional, one-time setup).

---

## Quick Start

### 1. Configure API

Settings panel → **Settings** tab → fill API URL, key, model name. Compatible with any OpenAI-format API.

Vision-capable models are recommended for screenshot awareness:
- Budget: Grok series / DeepSeek
- Mid-range: GPT-o3 / GPT-5.1
- High quality: Gemini 3 Pro Preview

Translation API (for TTS Japanese translation): OpenRouter `x-ai/grok-4-fast`

### 2. Import Live2D Model

**Model** tab → Select model folder (containing `.model.json` or `.model3.json`). Auto-scans parameters, expressions, motions.

Image folders also supported as character visuals.

No model? Download free samples from Live2D official gallery.

### 3. Configure VOICEVOX (Optional)

1. **TTS** tab → Install VOICEVOX components (Core + ONNX Runtime + Open JTalk dictionary)
2. Download VVM voice models
3. Click "Save & Restart"
4. Configure speaker, style, and other parameters

<details>
<summary>Manual VOICEVOX Installation</summary>

Install location: `C:\Users\YourUsername\AppData\Roaming\live2dpet\voicevox_core`

| Component | Required | Download |
| :--- | :--- | :--- |
| VOICEVOX Core | Yes | `voicevox_core-windows-x64-0.16.3.zip` |
| ONNX Runtime (CPU) | Yes | `voicevox_onnxruntime-win-x64-1.17.3.tgz` |
| ONNX Runtime (GPU) | No | `voicevox_onnxruntime-win-x64-dml-1.17.3.tgz` |
| Open JTalk Dictionary | Yes | `open_jtalk_dic_utf_8-1.11.tar.gz` |
| Default Voice Model | Yes | `0.vvm` |
| Other Voice Models | No | `*.vvm` |

</details>

### 4. Customize Character

**Prompt** tab → Add a character card. Edit name, personality, rules. Template variables `{{petName}}`, `{{userIdentity}}` supported.

### 5. Launch Pet

Click **"Launch Pet"** at the bottom of settings.

- Drag to reposition
- Eyes follow cursor (Live2D mode)
- AI periodically screenshots and chats via bubbles
- Right-click the pet for the menu

---

## Right-Click Menu Structure

```
Size           ▶
Window Position ▶
──────────────
Start Chat
Proactive Speak ✓
──────────────
Memory         ▶
  ├─ View Agent History
  ├─ View Observation Data
  └─ User Profile
Tools          ▶
  ├─ Review Cards
  ├─ Calendar
  ├─ Countdown / Timer
  └─ Show / Hide Timer Bubble
──────────────
Settings
Quit
```

---

## Common Dialogue Examples

**Daily chat**
```
I'm a bit tired today
Help me pick a research topic
Who have I been chatting with most recently?
```

**Todo & schedule**
```
Remind me to buy milk tomorrow
Meeting with my advisor at 3pm tomorrow
What's on my schedule this week
Milk is bought
Change "buy milk" to the day after tomorrow
```

**Reminders**
```
Remind me to go to bed at 23:30 every day
Remind me to check the pot in 10 minutes
```

**Flashcards**
```
Add a card for "Kant's three Critiques", subject: Western Philosophy
What's due for review today?
Start reviewing
(After AI asks) ...forgot
How many cards do I have?
```

**Timers**
```
Remind me to drink water in 5 minutes
Countdown 30 seconds for boiling eggs
Start a count-up timer called Reading
What timers do I have
Pause the noodle countdown
```

**Pomodoro**
```
Start a Pomodoro
Pomodoro for 25 minutes
Start a 50/10 Pomodoro
```

**Agent tasks (🤖 mode)**
```
List all files in the src directory
Search the project for "TODO"
Read package.json
```

**Plan mode (📋)**
```
Refactor the logging system of this project
(AI gives a plan first; only executes after you click "Approve")
```

---

## Data Storage

All data stored locally, optionally synced to Gist / Nutstore:

```text
C:\Users\YourUsername\AppData\Roaming\live2dpet\
├── config.json              Config (API key, TTS params, cloud sync settings, etc.)
├── data/
│   ├── todos.json             Todos
│   ├── schedules.json         Schedules
│   ├── reminders.json         Reminders
│   ├── flashcards.json        Flashcards
│   ├── timers.json            Timers / Pomodoro
│   ├── chat-memory.json       Chat memory
│   ├── agent-history.json     Agent history
│   ├── user-profile.json      User profile
│   ├── observations.json      Observations
│   ├── companion.json         Days together
│   ├── daily-brief.json       Brief state
│   ├── report-state.json      Report state
│   ├── reports/               History of weekly/monthly reports
│   └── .backup/               Auto backup during cloud sync
├── prompts/                 Custom character cards
├── models/                  Imported Live2D models
├── voicevox_core/           VOICEVOX components and models
└── default-audio/           Default audio clips
```

You can open these with any text editor.

---

## Third-Party Licenses & Compliance

### Live2D Cubism Core

Due to Live2D's licensing restrictions, this project **does not include** `live2dcubismcore.min.js` or `cubism4.min.js`.
After cloning or running from source for the first time, download the SDK from the [Live2D official website](https://www.live2d.com/) and place `live2dcubismcore.min.js` into the `libs/` directory.

### VOICEVOX

This project integrates VOICEVOX. Please comply with the [VOICEVOX Terms of Use](https://voicevox.hiroshiba.jp/term/) and credit `VOICEVOX: CharacterName`.

**Note**: For license compliance, this repository does not include precompiled VOICEVOX Core binaries.
Download the Core components from the [VOICEVOX official website](https://voicevox.hiroshiba.jp/), extract them, and place them into the `voicevox_core/` folder.

### Other Dependencies

See `THIRD_PARTY_LICENSES.md` for details.

---

## Troubleshooting

To enable console logging:

```bash
"path\to\Live2DPet.exe" --enable-logging 2>&1
```

Or run from source:

```bash
node launch.js
```

Record the log output and include it when submitting an Issue.

**Common issues**:

- **Data "disappeared"** — Check `data/.backup/` first; cloud sync backs up before overwriting
- **Cloud sync conflicts** — Settings → Cloud Sync → click "Reset Sync State"
- **MCP tool fails to start** — Ensure the built-in tool command is `{electron}` and args are `{mcpServer}/mcp-server.js`
- **TTS silent** — Check `voicevox_core/` and VVM models are complete

---

## Known Issues

- Screenshot warnings can be safely ignored
- VVM voice model errors: delete corrupted files under `voicevox_core` and re-download
- Enabling GPU acceleration causes TTS to fail — use CPU only
- Long text (>60 chars) is truncated: VOICEVOX is unstable with long text in CPU mode
- Reminders missed by >30 min are marked "Missed" (edit time to reset)
- Editing the same record on desktop and mobile may trigger a conflict dialog

---

## Requirements

- **Windows 10/11**
- **Node.js >= 18** (when running from source)
- **OpenAI-compatible API key**
- **VOICEVOX Core** (optional, for TTS)
- **GitHub Gist or Nutstore** (optional, for cloud sync)

---

## Testing

```bash
npm test
```

---

## License

MIT — See [LICENSE](LICENSE).

---

## Contributors

<a href="https://github.com/x380kkm/Live2DPet/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=x380kkm/Live2DPet" />
</a>

## Star History

https://api.star-history.com/svg?repos=x380kkm/Live2DPet&type=Date