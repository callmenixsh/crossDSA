import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

SCRAPERS = {
    'leetcode': 'scrapers/leetcode_scraper.py',
    'geeksforgeeks': 'scrapers/geeksforgeeks_scraper.py',
    'codeforces': 'scrapers/codeforces_scraper.py',
    'codechef': 'scrapers/codechef_scraper.py',
    'code360': 'scrapers/code360_scraper.py',
    'atcoder': 'scrapers/atcoder_scraper.py',
}

NAMES = list(SCRAPERS)

def run(target, extra):
    script = SCRAPERS[target]
    cmd = [sys.executable, script] + extra
    print(f'\n==> {target}: python {script} {" ".join(extra)}')
    return subprocess.call(cmd, cwd=ROOT)


def check_normalization_audit():
    print('\nChecking LeetCode review coverage against the scraped snapshots...', flush=True)
    try:
        result = subprocess.call(['node', 'normalization/audit.mjs'], cwd=ROOT)
    except FileNotFoundError:
        print('Audit could not run: install Node.js 22 or newer, then run node normalization/audit.mjs.')
        return 1
    if result:
        print('Normalization review needs attention. Inspect the audit output before rebuilding; do not regenerate review pins automatically.')
    print('Rebuild the catalog after source changes: node normalization/build.mjs')
    return result

def pick_interactively():
    print('Pick scrapers to run (comma-separated numbers, or 0 for all):')
    for i, name in enumerate(NAMES, 1):
        print(f'  {i}. {name}')
    try:
        raw = input('> ').strip()
    except EOFError:
        return list(SCRAPERS)
    if not raw or raw == '0':
        return list(SCRAPERS)
    picked = []
    for part in raw.split(','):
        part = part.strip()
        if not part:
            continue
        try:
            idx = int(part)
        except ValueError:
            if part in SCRAPERS:
                picked.append(part)
                continue
            print(f'Unknown: {part}')
            continue
        if 1 <= idx <= len(NAMES):
            picked.append(NAMES[idx - 1])
        else:
            print(f'Out of range: {idx}')
    return picked or list(SCRAPERS)

def main():
    chosen = [a for a in sys.argv[1:] if a in SCRAPERS]
    passthrough = [a for a in sys.argv[1:] if a not in SCRAPERS]

    targets = chosen if chosen else pick_interactively()

    failures = 0
    for t in targets:
        extra = passthrough if t in ('codechef', 'code360', 'atcoder') else []
        if run(t, extra) != 0:
            failures += 1
            print(f'==> {t} FAILED')

    print(f'\nDone: {len(targets) - failures}/{len(targets)} scrapers finished')
    audit_status = check_normalization_audit()
    sys.exit(1 if failures or audit_status else 0)

if __name__ == '__main__':
    main()
