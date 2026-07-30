# Subsyncarr Plus (CyberDeck 3.0)

<div align="center">

![Subsyncarr Banner](https://img.shields.io/badge/Subsyncarr-CyberDeck%203.0-00f0ff?style=for-the-badge&logo=docker&logoColor=white)
![Node Version](https://img.shields.io/badge/Node.js-v24%2B-00ff9d?style=for-the-badge&logo=node.js&logoColor=white)
![Architecture](https://img.shields.io/badge/Platform-linux%2Famd64-7000ff?style=for-the-badge)
![License](https://img.shields.io/github/license/RDLN7/subsyncarr?color=ff0055&style=for-the-badge)
![Docker Pulls](https://img.shields.io/docker/pulls/mrorbitman/subsyncarr?color=ffab00&style=for-the-badge)

**Automated Speech-to-Text Subtitle Synchronization & AI Translation for Arr / Plex / Jellyfin / Emby / Synology / Unraid**

[Quick Start](#quick-start) • [CyberDeck 3.0 UI](#cyberdeck-ui) • [Configuration](#configuration) • [AI Translation](#ai-translation) • [Troubleshooting](#troubleshooting)

</div>

---

## 🌟 Features Overview

<a id="cyberdeck-ui"></a>
### 🎛️ CyberDeck 3.0 Dashboard & UI
* **Sci-Fi Control Center**: Responsive dual-pane UI with dark obsidian backdrop, neon glassmorphism, and high-contrast light theme modes.
* **Live Audio Equalizer Visualizer**: 5-bar animated audio waveform equalizer dancing in real-time during active subtitle synchronization runs.
* **Embedded Terminal Stream**: View live processing logs directly in the browser with dark hacker terminal styling, autoscroll, line numbers, and 1-click clipboard copy.
* **Interactive Directory Tree Picker**: Browse your server's filesystem graphically inside the Web UI to target specific folders without typing paths.
* **Global Search & Outcomes Filter**: Instant fuzzy search across processed media files, subtitle language tags, and sync outcomes (`SYNCED`, `TRANSLATED`, `NO_MATCH`, `FAILED`).

### 🎙️ Multi-Engine Speech-to-Text Synchronization
* **Triple Sync Engines**: Combines `FFsubsync`, `Alass`, and `Autosubsync` for maximum audio-to-subtitle alignment accuracy.
* **Automatic WAV Audio Fallback**: Intelligent fallback extraction converts complex 4K Remux / Hybrid MKVs into 16kHz mono `.wav` audio references on the fly, preventing child-process crashes on 50GB+ video files.
* **Embedded Subtitle Extraction**: Automatically extracts embedded English/Chinese reference subtitles from MKV containers when external reference files are missing.
* **Non-Destructive Processing**: Generates sidecar SRT files (e.g., `Movie.alass.srt`, `Movie.ffsubsync.srt`) so original subtitles remain intact. Optional `OVERWRITE_ORIGINAL=true` mode supported.
* **Auto-Skip Protection**: Intelligently skips files after 3 consecutive failures to conserve CPU resources. Reset skip states with 1 click in the UI.

### 🤖 AI Subtitle Translation Engine
* **OpenAI API Compatible**: Works out of the box with OpenAI (`gpt-4o`, `gpt-4o-mini`), Claude, DeepSeek, Grok, Ollama, or local LM Studio / vLLM endpoints.
* **Portable Sidecar Output**: Automatically translates external subtitles and generates standard BCP-47 sidecar files (e.g., `Movie.AI.zh-TW.srt`).
* **Telegram Bot Notifications**: Receives instant rich alert notifications on Telegram after each successful synchronization or AI translation run.

---

<a id="quick-start"></a>
## ⚡ Quick Start

### Using Docker Compose (Recommended)

Create a `docker-compose.yml` file:

```yaml
name: subsyncarr

services:
  subsyncarr:
    image: ghcr.io/rdln7/subsyncarr:latest
    container_name: subsyncarr
    ports:
      - '3000:3000' # Web UI
    volumes:
      - /path/to/movies:/movies
      - /path/to/tv:/tv
      - ./data:/app/data # Persist SQLite database & logs
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 768M
        reservations:
          memory: 128M
    environment:
      - TZ=Etc/UTC
      - PUID=1000
      - PGID=1000
      - CRON_SCHEDULE=0 0 * * * # Daily at midnight
      - SCAN_PATHS=/movies,/tv
      - INCLUDE_ENGINES=ffsubsync,autosubsync,alass
      - MAX_CONCURRENT_SYNC_TASKS=1
```

Start the container:

```bash
docker compose up -d
```

Open your browser to **`http://localhost:3000`** (or `http://<your-server-ip>:3000`).

---

### Using Docker Run

```bash
docker run -d \
  --name subsyncarr \
  -p 3000:3000 \
  -v /path/to/movies:/movies \
  -v /path/to/tv:/tv \
  -v ./data:/app/data \
  -e TZ=America/New_York \
  -e PUID=1000 \
  -e PGID=1000 \
  -e CRON_SCHEDULE="0 0 * * *" \
  -e SCAN_PATHS=/movies,/tv \
  -e INCLUDE_ENGINES=ffsubsync,autosubsync,alass \
  ghcr.io/rdln7/subsyncarr:latest
```

---

<a id="configuration"></a>
## ⚙️ Configuration Reference

### Core Application Settings

| Variable | Default | Description |
| :--- | :--- | :--- |
| `SCAN_PATHS` | `/movies, /tv` | Comma-separated paths to scan for video & subtitle files |
| `EXCLUDE_PATHS` | *(none)* | Comma-separated directory paths to exclude |
| `INCLUDE_ENGINES` | `ffsubsync,autosubsync,alass` | Enabled sync engines (e.g. `ffsubsync,autosubsync,alass,ai-translate`) |
| `SYNC_LANGUAGES` | *(none)* | Comma-separated language tags to sync (e.g. `en,zh-TW`). If empty, syncs all SRTs |
| `CRON_SCHEDULE` | `0 0 * * *` | Cron schedule for automated scanning (`disabled` to turn off) |
| `MAX_CONCURRENT_SYNC_TASKS` | `1` | Number of subtitle files to process in parallel |
| `OVERWRITE_ORIGINAL` | `false` | Overwrite original `.srt` file instead of creating `.alass.srt` sidecars |
| `SYNC_ENGINE_TIMEOUT_MS` | `1800000` | Timeout per sync operation in milliseconds (30 min default) |
| `WEB_PORT` | `3000` | Port for the Web UI |
| `WEB_HOST` | `0.0.0.0` | Host interface binding (`0.0.0.0` for Docker) |
| `PUID` / `PGID` | `1000` / `1000` | User/Group ID for file permissions |

---

<a id="ai-translation"></a>
### 🤖 AI Translation Settings

Add `ai-translate` to `INCLUDE_ENGINES` to enable AI translation:

```yaml
environment:
  - INCLUDE_ENGINES=ffsubsync,autosubsync,alass,ai-translate
  - AI_BASE_URL=https://api.openai.com/v1
  - AI_API_KEY=your-secret-api-key
  - AI_MODEL=gpt-4o-mini
  - AI_TARGET_LANGUAGE=Traditional Chinese (Taiwan)
  - AI_OUTPUT_LANGUAGE=zh-TW
  - AI_REQUIRED_SUBTITLE_LANGUAGES=zh-TW,zh-CN,chi
  - TELEGRAM_BOT_TOKEN=your-bot-token
  - TELEGRAM_CHAT_ID=your-chat-id
```

| Variable | Default | Description |
| :--- | :--- | :--- |
| `AI_BASE_URL` | *(required)* | OpenAI-compatible endpoint URL (e.g. `https://api.openai.com/v1`) |
| `AI_API_KEY` | *(required)* | API key for authentication (never exposed in UI) |
| `AI_MODEL` | *(required)* | LLM model name (e.g. `gpt-4o-mini`, `claude-3-5-sonnet`, `deepseek-chat`) |
| `AI_TARGET_LANGUAGE` | `Traditional Chinese (Taiwan)` | Translation target language prompt |
| `AI_OUTPUT_LANGUAGE` | `zh-TW` | Sidecar filename suffix (`<subtitle>.AI.zh-TW.srt`) |
| `AI_REQUIRED_SUBTITLE_LANGUAGES` | *(none)* | Skip translation if any matching language subtitle already exists |
| `AI_BATCH_CUES` | `350` | Maximum subtitle cues per API batch request |
| `AI_TIMEOUT_MS` | `300000` | Translation API request timeout (5 minutes) |

---

## 🗂️ Media Directory Structure

Subsyncarr Plus automatically handles standard Plex, Jellyfin, and Arr directory layouts:

```txt
/movies
├── The Furious (2026)/
│   ├── The Furious (2026).mkv
│   ├── The Furious (2026).zh-TW.srt          # Source subtitle
│   ├── The Furious (2026).zh-TW.alass.srt    # Synchronized sidecar
│   └── The Furious (2026).AI.zh-TW.srt       # AI translated sidecar

/tv
├── Fallout (2024)/
│   └── Season 01/
│       ├── Fallout.S01E01.mkv
│       ├── Fallout.S01E01.en.srt
│       └── Fallout.S01E01.en.ffsubsync.srt
```

---

<a id="troubleshooting"></a>
## 🔧 Troubleshooting & Support

### View Container Logs
```bash
docker logs -f subsyncarr
```

### File Permission Issues
Ensure `PUID` and `PGID` match the owner of your media files on host:
```bash
id -u  # Returns your PUID
id -g  # Returns your PGID
```

### Reset Auto-Skipped Files
Files that fail 3 consecutive times are marked as auto-skipped. You can reset auto-skip statuses directly inside the CyberDeck 3.0 Web UI under **Settings** or via HTTP POST to `/api/skip-status/reset`.

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for details.
