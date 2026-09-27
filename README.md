# crossDSA

Chrome extension that finds equivalent or closely matching DSA problems across different platforms. If you're solving a problem on Codeforces and want to find the same problem on LeetCode, GeeksforGeeks, CodeChef, or Code 360, this saves you the manual hunt.

Backs onto a local index of ~27,000 problems pulled from all five platforms, so matching works locally and fast.

## What it does

- Adds a draggable floating match button on every supported problem page.
- Matches against LeetCode, GeeksforGeeks, Codeforces, CodeChef, and Code 360.
- Compares titles *and* descriptions, not just keywords — tokenizes, strips stopwords, stems, and weighs rare words higher, so "find the shortest path in a grid" actually finds shortest-path-grid problems instead of everything containing the word "grid".
- Ranks equivalent and closely matching results with a confidence percentage.
- Groups results by platform with tabs, and shows difficulty and topic tags on each one.
- Built-in YouTube search that uses the right key for each platform (contest ID + index for Codeforces, problem code for CodeChef, etc.).
- Remembers the floating button's last position separately for each site.
- Dark-mode friendly.

## Supported platforms

There's a difference worth spelling out: platforms the extension **has data for** (you can find equivalent or closely matching problems in the index), versus platforms it **just runs on**.

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
| TakeUForward | takeuforward.org/practice/dsa/{problem} | The button works on individual DSA problem pages and you can search for a TUF problem's equivalent among the five indexed platforms — but TUF problems aren't scraped yet, so no platform will ever suggest a *TUF* problem as a match. |

To bring TakeUForward into the full set, a `tuf_scraper.py` plus a `tuf-data.json` (and registering it in `manifest.json` + `content.js`) is what's missing.

## Install

1. Clone/download this repo.
2. Open `chrome://extensions/`, flip on **Developer mode**.
3. Click **Load unpacked** and pick the project folder.
4. Open any supported problem page, click the search button, done.

## Usage

- Use **Match** to look for equivalent or closely matching problems on the enabled platforms. Drag the button anywhere on-screen; its position is remembered for that site.
- Drag the results panel by its header to move it out of the way while you work.
- Tabs at the top of the panel switch between platforms.
- Each result shows difficulty, match %, and tags — click to open in a new tab.
- The panel header has a YouTube button that pre-builds the search query for the current problem.
- The compact popup controls button visibility, match strictness, and enabled platforms.
- Use **Random practice** to pick a problem from the currently enabled platforms and open it directly from the popup.

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
