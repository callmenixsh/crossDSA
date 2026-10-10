"""Retry only missing statements using LeetCode's unauthenticated public API."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

import requests

try:
    from .leetcode_scraper import extract_description_and_constraints
except ImportError:
    from leetcode_scraper import extract_description_and_constraints

ROOT = Path(__file__).resolve().parents[1]
ENDPOINT = 'https://leetcode.com/graphql/'


def recover_batch(session, rows):
    variables = {f's{i}': row['url'].rstrip('/').split('/')[-1] for i, row in enumerate(rows)}
    arguments = ', '.join(f'${name}: String!' for name in variables)
    fields = '\n'.join(f'q{i}: question(titleSlug: $s{i}) {{ questionFrontendId titleSlug isPaidOnly content topicTags {{ name }} }}' for i in range(len(rows)))
    response = session.post(ENDPOINT, json={'query': f'query MissingStatements({arguments}) {{ {fields} }}', 'variables': variables}, timeout=30)
    response.raise_for_status()
    payload = response.json()
    results = []
    for i, row in enumerate(rows):
        item = (payload.get('data') or {}).get(f'q{i}')
        result = {'leetcodeId': f"leetcode:{row['id']}", 'url': row['url']}
        if not item:
            result['outcome'] = 'api-error' if payload.get('errors') else 'not-found'
        elif str(item.get('questionFrontendId')) != str(row['id']) or item.get('titleSlug') != variables[f's{i}']:
            result['outcome'] = 'identity-mismatch'
        elif not item.get('content'):
            result.update(outcome='premium-locked' if item.get('isPaidOnly') else 'empty-content', premium=item.get('isPaidOnly'))
        else:
            description, constraints, is_sql = extract_description_and_constraints(item['content'])
            if len(description) < 80:
                result['outcome'] = 'insufficient-statement'
            else:
                row.update(description=description, constraints=constraints, is_sql=is_sql)
                if isinstance(item.get('isPaidOnly'), bool):
                    row['isPremium'] = item['isPaidOnly']
                topics = [tag['name'] for tag in item.get('topicTags') or [] if isinstance(tag.get('name'), str)]
                if topics:
                    row['topics'] = topics
                result.update(outcome='recovered', contentHash=hashlib.sha256(item['content'].encode()).hexdigest())
        results.append(result)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batch-size', type=int, default=15, choices=range(1, 21), metavar='1..20')
    parser.add_argument('--limit', type=int, default=0, help='Maximum missing statements to retry; 0 means all.')
    args = parser.parse_args()
    if args.limit < 0:
        parser.error('--limit must be nonnegative')
    source = ROOT / 'data/leetcode-data.json'
    original = source.read_bytes()
    rows = json.loads(original)
    missing = [row for row in rows if not row.get('description', '').strip()]
    if args.limit:
        missing = missing[:args.limit]
    session = requests.Session()
    session.headers.update({'User-Agent': 'crossDSA statement recovery', 'Content-Type': 'application/json'})
    results = []
    for offset in range(0, len(missing), args.batch_size):
        batch = missing[offset:offset + args.batch_size]
        try:
            results.extend(recover_batch(session, batch))
        except (requests.RequestException, ValueError) as error:
            results.extend({'leetcodeId': f"leetcode:{row['id']}", 'url': row['url'], 'outcome': 'request-failed', 'error': type(error).__name__} for row in batch)
            # A shared authentication/rate-limit/network failure will affect later batches too.
            results.extend({'leetcodeId': f"leetcode:{row['id']}", 'url': row['url'], 'outcome': 'not-attempted-after-request-failure'} for row in missing[offset + len(batch):])
            break
        print(f'Retried {min(offset + len(batch), len(missing))}/{len(missing)} missing statements', flush=True)
        if offset + len(batch) < len(missing):
            time.sleep(1)
    recovered = sum(result['outcome'] == 'recovered' for result in results)
    if recovered:
        source.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    counts = {outcome: sum(result['outcome'] == outcome for result in results) for outcome in sorted({result['outcome'] for result in results})}
    report = {'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(), 'endpoint': ENDPOINT,
              'access': 'Unauthenticated public API; no account cookies or Premium credentials used.',
              'sourceHashBefore': hashlib.sha256(original).hexdigest(), 'sourceHashAfter': hashlib.sha256(source.read_bytes()).hexdigest(),
              'counts': counts, 'entries': results}
    (ROOT / 'normalization/leetcode-statement-recovery.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(counts, indent=2))
    if any(result['outcome'] in ('request-failed', 'api-error', 'identity-mismatch', 'not-attempted-after-request-failure') for result in results):
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
