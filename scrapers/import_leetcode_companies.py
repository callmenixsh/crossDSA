"""Import company metadata from a pinned public CSV snapshot; keep question content local."""
import csv
import io
import json
import re
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = 'snehasishroy/leetcode-companywise-interview-questions'
REVISION = 'e095c259cfd036e3ddb6886e84d7075c2faac477'
WINDOWS = {'all.csv': 'all', 'thirty-days.csv': '30d', 'three-months.csv': '3m', 'six-months.csv': '6m', 'more-than-six-months.csv': 'older'}
NAMES = {'facebook': 'Meta', 'linkedin': 'LinkedIn', 'ibm': 'IBM', 'tcs': 'TCS', 'vmware': 'VMware', 'nvidia': 'NVIDIA', 'paypal': 'PayPal', 'paytm': 'Paytm', 'phonepe': 'PhonePe', 'bytedance': 'ByteDance', 'jpmorgan': 'JPMorgan', 'ebay': 'eBay', 'servicenow': 'ServiceNow', 'sap': 'SAP', 'docusign': 'DocuSign', 'walmart-global-tech': 'Walmart Global Tech'}


def main():
    raw = urllib.request.urlopen(f'https://codeload.github.com/{REPO}/zip/{REVISION}', timeout=90).read()
    archive = zipfile.ZipFile(io.BytesIO(raw))
    companies = {}
    for path in sorted(archive.namelist()):
        parts = path.split('/')
        if len(parts) != 3 or parts[-1] not in WINDOWS:
            continue
        slug, window = parts[1], WINDOWS[parts[-1]]
        if not re.fullmatch(r'[a-z0-9-]+', slug):
            continue
        company = companies.setdefault(slug, {'id': slug, 'name': NAMES.get(slug, slug.replace('-', ' ').title()), 'aliases': ['Facebook'] if slug in ('facebook', 'meta') else [], 'windows': {}})
        questions = {}
        text = archive.read(path).decode('utf-8-sig')
        for row in csv.DictReader(io.StringIO(text)):
            match = re.fullmatch(r'https://leetcode.com/problems/([a-z0-9-]+)/?', row.get('URL', ''))
            if not match:
                raise ValueError(f'Invalid problem URL in {path}')
            frequency = float(row['Frequency %'].rstrip('%'))
            if not 0 <= frequency <= 100:
                raise ValueError(f'Invalid frequency in {path}')
            questions[match[1]] = frequency
        company['windows'][window] = questions
    if not companies:
        raise ValueError('No company CSVs found; existing data was preserved')
    result = {'version': 1, 'source': {'name': REPO, 'url': f'https://github.com/{REPO}', 'revision': REVISION, 'snapshotDate': '2026-07-12'}, 'companies': list(companies.values())}
    output = ROOT / 'data' / 'leetcode-companies.json'
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Imported {len(companies)} companies into {output}')


if __name__ == '__main__':
    main()
