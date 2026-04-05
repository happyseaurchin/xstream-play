# xstream everywhere — Chrome extension

A browser overlay that turns any webpage into a coordination space. Bring your own intelligence (API key), see who else has been here and why, think with a soft-LLM, commit intentions through a medium-LLM. All behaviour lives in pscale blocks, not code.

## Install

1. Clone or download this `extension/` folder
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select this folder
5. Click the extension icon (puzzle piece) in the toolbar
6. Enter your Anthropic API key and save

## Use

Visit any page. A `#` button appears. Click it to open the compass:

- **Upper-left** — type a thought or question
- **Lower-left** — soft-LLM replies (your private advisor)
- **Lower-right** — liquid: submitted intentions, visible to peers
- **Upper-right** — solid: committed results + beach marks from past visitors

Keyboard shortcuts inside the text area:
- `Cmd/Ctrl + Enter` — query the soft-LLM (vapor, private)
- `Shift + Enter` — submit to liquid (visible to peers)
- `Escape` — close the widget

Drag the button to reposition it on the page.

## How it works

The extension is a thin shell that follows stars.

**BSP walker** (`bsp.js`) reads pscale JSON blocks. Agent blocks (`blocks/visitor-soft-agent.json`, `blocks/visitor-medium-agent.json`) define what the LLM sees and produces. Star references in agent blocks point to dynamic blocks built at runtime from the page content and beach marks.

**Beach** — stigmergy across time. When you open the widget, a "present" mark is left at the URL coordinate (sha256 hash). When you submit liquid, your intention becomes the mark. Other visitors' marks are discoverable — purposes that resonate surface in the solid zone.

**Relay** — live coordination. If someone else has the extension open on the same URL right now, their liquid appears in your liquid zone. Peer count shows on the widget.

**Sovereignty** — your API key stays in `chrome.storage.local`. It never touches any server except `api.anthropic.com`. The relay stores coordination state but never sees your key.

## Architecture

```
content.js          Shadow DOM widget, page snapshot extraction
service-worker.js   Kernel: block loading, BSP walks, LLM calls, relay/beach polling
bsp.js              Pscale BSP walker (all 6 modes + star operator)
blocks-dynamic.js   Converts page snapshots and beach marks into walkable pscale blocks
blocks/             Agent blocks — edit these to change LLM behaviour
beach-agent.js      Standalone client for agents (no Chrome dependency)
```

Adding a face = adding a JSON block. Changing behaviour = editing a block. The kernel doesn't change.

## Links

- Main project: [xstream-play](https://github.com/happyseaurchin/xstream-play)
- Deployed at: [play.onen.ai](https://play.onen.ai)
- Pscale reference: [pscale/starstone/](../pscale/starstone/)
