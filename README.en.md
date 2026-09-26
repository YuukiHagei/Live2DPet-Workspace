# Live2DPet Workspace — AI Desktop Pet Companion
> Note: The marketing name of this project is **Live2DPet Workspace**. The executable file and user data directory still use the original names `Live2DPet` / `live2dpet`. This does not affect usage.
**[中文](README.md)** | **[日本語](README.ja.md)** | **English**

> This project is a fork of [x380kkm/Live2DPet](https://github.com/x380kkm/Live2DPet), licensed under MIT.

An open-source desktop app that packs AI chat, schedule management, flashcards, and a task agent into a Live2D desktop pet.

---

## Core Features

### 1. A Pet That Chats and Remembers
- **Natural dialogue** — Works with any OpenAI-compatible API (DeepSeek, OpenRouter, Grok, Ollama, etc.)
- **Role-play** — Character cards define name, identity, personality, address terms, scenario, and hard rules
- **Remembers you** — Auto-extracts a "user profile" (name, occupation, goals, preferences) across conversations
- **Observes environment** — Reads active window titles and screenshots so AI knows what you're doing
- **Voice synthesis** — VOICEVOX integration for Japanese voice (Chinese auto-translated to Japanese)
- **Days together** — Counts from first launch; AI can naturally mention "how long we've known each other"

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

**Sensitive tools (ask by default)**
- Write file, open URL

Per-tool permissions can be set in **Settings → Agent Tool Permissions** to `allow` / `ask` / `deny`.

### 4. MCP Tool Extension
Connect any MCP Server in addition to built-in tools:
- **Settings → MCP → Click "+ Add Server"**
- Common examples: `@modelcontextprotocol/server-filesystem`, `mcp-server-git`
- Multiple servers supported; name conflicts auto-prefixed

### 5. Calendar + Todo Visualization
Right-click the pet → "Calendar":
- Month view with markers on days that have schedules
- Click a day to see its schedules and todos
- Create / edit / delete schedules directly in the calendar

### 6. Flashcards (SM-2 Algorithm)
Right-click the pet → "Review Cards":
- Cards have front (question) and back (answer), with subject and tags
- Uses the same SM-2 spaced repetition algorithm as Anki
- Four ratings: Again / Hard / Good / Easy
- Auto-schedules next review (higher EF = longer interval)
- "📋 All Cards" lets you browse, search, edit, delete, create
- Standalone window with keyboard shortcuts: Space to flip, 1/2/3/4 to rate, ESC to close

### 7. Daily Brief + Weekly/Monthly Reports
**Morning brief (triggers at 7:30 by default)**
- Weather, temperature, UV index
- Clothing advice based on temperature, sun protection based on UV
- Today's schedules, reminders, due todos summary

**Evening brief (triggers at 22:00 by default)**
- What you completed today
- What's still pending
- Tomorrow's schedules and reminders

**Weekly / Monthly reports**
- Weekly at Sun 21:00; monthly at the last day 21:00
- Todo completion rate, schedule count, review count, per-subject error rate

All briefs are generated in the character's voice, not mechanical data reading.

### 8. Observation Data Visualization
Right-click the pet → "View Observation Data":
- Frequent contacts (sorted by count, with topic tags)
- Recent chat log (only window titles, never chat content)

---

## Usage Guide

### 1. Configure API
Open the settings panel and fill in the "API Settings" tab with your API URL, key, and model name. Compatible with any OpenAI-format API endpoint.

Vision-capable models are recommended for screenshot awareness:
- Budget: Grok series / DeepSeek
- Mid-range: GPT-o3 / GPT-5.1
- High quality: Gemini 3 Pro Preview

Translation API (for TTS Japanese translation):
- OpenRouter `x-ai/grok-4-fast`

### 2. Import Live2D Model
In the "Model" tab, click "Select Model Folder" and choose a directory containing `.model.json` or `.model3.json`. The system will auto-scan model parameters, expressions, and motion groups.

Image folders are also supported as character visuals.

Don't have a Live2D model? Download free samples from the Live2D official gallery.

### 3. Configure VOICEVOX (Optional)
1. In the "TTS" tab, install VOICEVOX components (Core + ONNX Runtime + Open JTalk dictionary)
2. Select and download VVM voice models
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
In the "Character" tab, create a new character card. Template variables `{{petName}}` and `{{userIdentity}}` are supported.

### 5. Launch Pet
Click "Launch Pet" at the bottom of settings. The character appears as a transparent window at the bottom-right of your desktop.
- Drag to reposition
- Eyes follow mouse cursor (Live2D mode)
- AI periodically screenshots and chats via speech bubbles
- Right-click the pet for the menu: resize/position, start chat, view history, review cards, calendar, settings, etc.

---

## Common Dialogue Examples

**Daily chat**
```text
I'm a bit tired today
Help me pick a research topic
Who have I been chatting with most recently?
```

**Todo & schedule**
```text
Remind me to buy milk tomorrow
Meeting with my advisor at 3pm tomorrow
What's on my schedule this week
Milk is bought
Change "buy milk" to the day after tomorrow
```

**Reminders**
```text
Remind me to go to bed at 23:30 every day
Remind me to check the pot in 10 minutes
```

**Flashcards**
```text
Add a card for "Kant's three Critiques", subject: Western Philosophy
What's due for review today?
Start reviewing
(After AI asks) ...forgot
How many cards do I have?
```

**Agent tasks (🤖 mode)**
```text
List all files in the src directory
Search the project for "TODO"
Read package.json
```

**Plan mode (📋)**
```text
Refactor the logging system of this project
(AI gives a plan first; only executes after you click "Approve")
```

---

## Data Storage

All data is local, never uploaded:

```text
C:\Users\YourUsername\AppData\Roaming\live2dpet\
├── config.json         Config (API key, TTS params, etc.)
├── data/               Structured data
│   ├── todos.json       Todos
│   ├── schedules.json   Schedules
│   ├── reminders.json   Reminders
│   ├── flashcards.json  Flashcards
│   ├── companion.json   Days together
│   ├── daily-brief.json Brief state
│   ├── report-state.json Report state
│   └── reports/         History of weekly/monthly reports
└── voicevox_core/      VOICEVOX components and models
```

You can open these with any text editor.

---

## Features

- **Live2D desktop character** — Transparent frameless window, always on top, eyes follow cursor
- **Image model** — Use an image folder as character, tagged by idle/talking/emotion
- **AI visual awareness** — Periodic screenshots + active window detection
- **Interaction system** — Click/touch/drag/swipe/resize, injected into AI context
- **Keyframe visual memory** — VLM picks representative keyframes
- **VOICEVOX voice** — Local Japanese TTS, auto translation, one-click setup
- **Emotion system** — AI-driven expression/motion selection
- **Agent mode** — Three chat modes + 20+ built-in tools + MCP extension
- **Calendar & todos** — Natural language management + calendar view
- **Flashcards** — SM-2 algorithm + standalone review window
- **Daily brief** — Weather, clothing, sun protection advice
- **Weekly/monthly reports** — Study progress summary
- **Multi-character** — JSON template, switchable

---

## Notes

- **Privacy**: Screenshots are only sent to your configured API, never saved to disk
- **API costs**: Vision model calls incur costs — set a reasonable detection interval
- **VOICEVOX**: Credit `VOICEVOX:CharacterName` when using voice
- **Don't run multiple instances**: They compete for file locks, causing data corruption

---

## Third-Party Licenses & Compliance

### Live2D Cubism Core
Due to Live2D's licensing restrictions, this project **does not include** `live2dcubismcore.min.js` or `cubism4.min.js`.
After cloning or running from source for the first time, please download the SDK from the [Live2D official website](https://www.live2d.com/) and place `live2dcubismcore.min.js` into the `libs/` directory.

### VOICEVOX
This project integrates VOICEVOX. Please comply with the [VOICEVOX Terms of Use](https://voicevox.hiroshiba.jp/term/) and credit `VOICEVOX: CharacterName`.

### Other Dependencies
See `THIRD_PARTY_LICENSES.md` for details.

---

## Troubleshooting

To enable console logging for debugging:

```bash
"path\to\Live2DPet.exe" --enable-logging 2>&1
```

Record the log output when the issue occurs and include it when submitting an Issue.

---

## Known Issues

- Screenshot-related warnings can be safely ignored
- VVM voice model read errors: go to `voicevox_core`, delete the corrupted files, and re-download
- Enabling GPU acceleration causes TTS read failure — use CPU only
- Long text (>60 chars) skips TTS: VOICEVOX is unstable with long text in CPU mode — bubble only, no voice

---

## Requirements

- Windows 10/11
- Node.js >= 18 (when running from source)
- OpenAI-compatible API key
- VOICEVOX Core (optional, for TTS)
**Note**: For license compliance reasons, this repository does not include the precompiled binary files of VOICEVOX Core.
Please obtain them yourself by following these steps:
1. Go to the [VOICEVOX official website](https://voicevox.hiroshiba.jp/) to download the Core components.
2. Extract the files and place them into the `voicevox_core/` folder in the project root.
3. For the specific file list, please refer to the `README.md` in that folder.
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
