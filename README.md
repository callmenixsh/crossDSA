# crossDSA

Chrome extension that finds the same or similar DSA problems across different platforms. If you're grinding a problem on Codeforces and want the LeetCode equivalent (or the GfG one, or the CodeChef one), this saves you the manual hunt.

Backs onto a local index of ~18,000 problems pulled from all five platforms, so matching works offline-ish and fast.

## What it does

- Adds a search button next to the problem title on any supported page. One click, done.
- Matches against LeetCode, GeeksforGeeks, Codeforces, CodeChef, and Code 360.
- Compares titles *and* descriptions, not just keywords — tokenizes, strips stopwords, stems, and weighs rare words higher, so "find the shortest path in a grid" actually finds shortest-path-grid problems instead of everything containing the word "grid".
- Ranks results and flags them exact vs similar, with a confidence percentage.
- Groups results by platform with tabs, and shows difficulty and topic tags on each one.
- Built-in YouTube search that uses the right key for each platform (contest ID + index for Codeforces, problem code for CodeChef, etc.).
- Works on platforms with messy/mutating DOMs via a floating fallback button.
- Dark-mode friendly.

## Supported platforms

There's a difference worth spelling out: platforms the extension **has data for** (you get full similar-matching both ways, targeted by problem title/description), versus platforms it **just runs on**.

### Indexed — full matching available

| Platform | Site | How it reads the problem |
| --- | --- | --- |
| LeetCode | leetcode.com/problems/* | DOM + title link |
| GeeksforGeeks | geeksforgeeks.org/problems/* | `__NEXT_DATA__` JSON |
| Codeforces | codeforces.com/problemset/problem/* | Problem statement DOM |
| CodeChef | codechef.com/problems/* | Public API, DOM fallback |
| Code 360 | naukri.com/code360/problems/* | Public API, DOM fallback |

### Runs on, but not indexed yet

| Platform | Site | Note |
| --- | --- | --- |
| TakeUForward | takeuforward.org/* | The button works and you can search for a TUF problem's equivalent among the five indexed platforms — but TUF problems aren't scraped yet, so no platform will ever suggest a *TUF* problem as a match. |

To bring TakeUForward into the full set, a `tuf_scraper.py` plus a `tuf-data.json` (and registering it in `manifest.json` + `content.js`) is what's missing.

## Install

1. Clone/download this repo.
2. Open `chrome://extensions/`, flip on **Developer mode**.
3. Click **Load unpacked** and pick the project folder.
4. Open any supported problem page, click the search button, done.

## Usage

- Search button next to the title opens the results panel.
- Tabs at the top of the panel switch between platforms.
- Each result shows difficulty, match %, and tags — click to open in a new tab.
- The panel header has a YouTube button that pre-builds the search query for the current problem.
- The popup (extension icon) lets you hide/show the button and pick which platforms to search against. There's also a match-threshold slider — Lenient/Moderate/Strict presets if you don't want to fiddle with it.

## Development

### Layout

```
content.js                 # matching engine + UI (content script)
popup.html / popup.js      # popup: settings, platform toggles, stats
background.js              # service worker, routes storage between popup and content script
styles.css                 # panel + button + popup styles
manifest.json              # MV3 manifest
data/                      # scraped problem data, injected into pages
  leetcode-data.json
  geeksforgeeks-data.json
  codeforces-data.json
  codechef-data.json
  code360-data.json
scrapers/
  leetcode_scraper.py      # pulls LeetCode data -> data/leetcode-data.json
  geeksforgeeks_scraper.py # pulls GfG data -> data/geeksforgeeks-data.json
  codeforces_scraper.py    # pulls Codeforces data -> data/codeforces-data.json
  codechef_scraper.py      # pulls CodeChef data -> data/codechef-data.json
  code360_scraper.py       # pulls Code 360 data -> data/code360-data.json
requirements.txt           # python deps for the scrapers
run_scrapers.py            # runs one or all scrapers back to back
```

### Refreshing the data

```bash
pip install -r requirements.txt
python scrapers/leetcode_scraper.py        # -> data/leetcode-data.json
python scrapers/geeksforgeeks_scraper.py   # -> data/geeksforgeeks-data.json
python scrapers/codeforces_scraper.py      # -> data/codeforces-data.json
python scrapers/codechef_scraper.py        # -> data/codechef-data.json
python scrapers/code360_scraper.py         # -> data/code360-data.json
```

Or just run them all at once:

```bash
python run_scrapers.py                     # prompts to pick, defaults to all
python run_scrapers.py codechef leetcode   # run by name
python run_scrapers.py codechef --limit 20 # scraper args pass through (codechef/code360)
```

Each scraper skips problem IDs already present in its output file, so re-running just tops up what's missing. Partial runs don't lose work — it checkpoints every 50 problems.

The CodeChef scraper takes a couple of args useful for a quick test:

```bash
python scrapers/codechef_scraper.py --limit 20     # first 20 rated problems only
python scrapers/codechef_scraper.py --pages 5      # first 5 list pages only
```

The Code 360 scraper supports the same `--limit` flag:

```bash
python scrapers/code360_scraper.py --limit 50      # first 50 problems only
```

## Contributing

Bugs, ideas, or a scraper for yet another platform — open an issue or send a PR.

## License

MIT License