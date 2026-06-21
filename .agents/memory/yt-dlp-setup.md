---
name: yt-dlp Python3 and dump-json flags
description: Key lessons about running yt-dlp in this Replit environment
---

## Rules

1. **Python3 must be installed as a module.** The `.replit` file only has `modules = ["nodejs-24"]` by default. yt-dlp is a Python3 script (`#!/usr/bin/env python3`) — without python-3.11, every yt-dlp call fails with "No such file or directory". Install via `installProgrammingLanguage({ language: "python-3.11" })`.

2. **Do NOT use `--extractor-args "youtube:player_client=ios,web"` with `--dump-json`.** This combination causes "Requested format is not available" even though `--dump-json` doesn't download anything. Remove this flag from info/metadata calls. It is safe to keep for actual download calls (`--get-url`, `-o -`, muxed downloads).

**Why:** The ios,web player_client restricts available formats at the metadata level, causing the format validator to fail before JSON is emitted.

**How to apply:** In `fetchYouTubeInfo`, use plain `--dump-json` without extractor-args. In `getYouTubeCdnUrl`, `downloadYouTubeMuxed`, and `spawnYouTubeAudioChain`, the extractor-args can remain.
