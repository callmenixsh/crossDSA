import json
import os
import requests
import time
import re
import sys
from bs4 import BeautifulSoup
from typing import Tuple

OUTPUT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'geeksforgeeks-data.json')
LIST_API = "https://practiceapi.geeksforgeeks.org/api/vr/problems/"
DETAIL_API = "https://practiceapi.geeksforgeeks.org/api/vr/problems/{slug}"
PAGE_SIZE = 30

def make_session():
    session = requests.Session()
    session.headers.update({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
    })
    return session

def fetch_problem_list(session, page):
    params = {
        'pageMode': 'explore',
        'page': page,
        'sortBy': 'submissions'
    }
    response = session.get(LIST_API, params=params, timeout=15)
    response.raise_for_status()
    return response.json()

def get_all_problems(session):
    all_problems = []
    page = 1
    total = None

    while True:
        try:
            data = fetch_problem_list(session, page)
        except Exception as e:
            print(f"  Failed to fetch list page {page}: {e}")
            break

        results = data.get('results', [])
        if total is None:
            total = data.get('total', 0)
            print(f"Total problems to process: {total}")

        all_problems.extend(results)

        next_page = data.get('next')
        if not next_page or not results:
            break
        page += 1
        time.sleep(1)

    return all_problems, total

def fetch_problem_detail(session, slug, retries=3):
    url = DETAIL_API.format(slug=slug)

    for attempt in range(retries):
        try:
            response = session.get(url, timeout=15)
            if response.status_code == 200:
                data = response.json()
                if data.get('status') and data.get('results'):
                    return data['results']
                print(f"  API returned no results for {slug}")
            elif response.status_code == 429:
                print(f"  Rate limited on {slug}, backing off...")
                time.sleep(10)
            else:
                print(f"  HTTP {response.status_code} for {slug}")
        except requests.RequestException as e:
            print(f"  Request failed (attempt {attempt + 1}/{retries}) for {slug}: {e}")

        if attempt < retries - 1:
            time.sleep(2 ** attempt)

    return None

def extract_description_and_constraints(html_desc):
    if not html_desc:
        return "", "", False

    soup = BeautifulSoup(html_desc, 'html.parser')

    for tag in soup.find_all(['img', 'style', 'script']):
        tag.decompose()

    for li in soup.find_all('li'):
        li.insert_before('\n  ')

    for p in soup.find_all('p'):
        p.insert_after('\n')
    for div in soup.find_all('div'):
        div.insert_after('\n')

    for pre in soup.find_all('pre'):
        pre.insert_before('\nExample:\n')

    text = soup.get_text(separator=' ', strip=True)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n\s*\n', '\n', text)
    text = text.strip()

    example_match = re.search(r'Examples?:', text)
    constraints_match = re.search(r'Constraints?:', text, re.IGNORECASE)

    if example_match:
        description = text[:example_match.start()].strip()
    elif constraints_match:
        description = text[:constraints_match.start()].strip()
    else:
        description = text

    description = re.sub(r'\s+', ' ', description)

    constraints = ""
    if constraints_match:
        constraints_start = constraints_match.end()
        constraints_text = text[constraints_start:]
        constraints = constraints_text.strip()

    is_sql = bool(re.search(r'(?i)create table|insert into|select .* from|varchar\s*\(|schema|sql\x20query', description + " " + constraints))

    return description, constraints, is_sql

def load_existing_data():
    try:
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []

def save_data(data):
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def fetch_all_questions():
    print(f"Fetching all GeeksforGeeks questions -> {OUTPUT_FILE}")
    print("-" * 60)

    session = make_session()

    existing_data = load_existing_data()
    existing_ids = {p['id'] for p in existing_data}
    print(f"Loaded {len(existing_data)} existing problems")

    print("Fetching problem list...")
    all_problems, total = get_all_problems(session)

    if not all_problems:
        print("Failed to fetch problems list")
        return

    print(f"Retrieved {len(all_problems)} problems from list")

    success_count = 0
    failed_count = 0
    skipped_count = 0
    failed_entries = []
    batch_count = 0

    for i, problem in enumerate(all_problems):
        problem_id = str(problem['id'])
        title = problem.get('problem_name', '')
        difficulty = problem.get('difficulty', '')
        slug = problem.get('slug', '')
        problem_url = problem.get('problem_url', '')
        if not problem_url:
            problem_url = f"https://www.geeksforgeeks.org/problems/{slug}/1"

        tags = problem.get('tags', {})
        topics = tags.get('topic_tags', [])

        print(f"[{i+1:4d}/{len(all_problems)}] ID {problem_id}: {title[:50]:<50}")

        if problem_id in existing_ids:
            print(f"          (exists, skipping)")
            skipped_count += 1
            continue

        detail = fetch_problem_detail(session, slug)
        if not detail:
            print(f"          Failed to fetch detail")
            failed_count += 1
            failed_entries.append(problem_id)
            time.sleep(1)
            continue

        html_desc = detail.get('problem_question', '')
        description, constraints, is_sql = extract_description_and_constraints(html_desc)

        entry = {
            'id': problem_id,
            'title': title,
            'url': problem_url,
            'difficulty': difficulty,
            'isPremium': False,
            'topics': topics,
            'description': description,
            'constraints': constraints,
            'is_sql': is_sql,
            'source': 'geeksforgeeks'
        }

        existing_data.append(entry)
        existing_ids.add(problem_id)
        success_count += 1
        print(f"          OK - {len(description)} chars, diff={difficulty}")

        batch_count += 1
        if batch_count % 50 == 0:
            save_data(existing_data)
            print(f"          [checkpoint] Saved {len(existing_data)} problems (batch {batch_count // 50})")

        time.sleep(1)

    existing_data.sort(key=lambda x: int(x['id']))
    save_data(existing_data)

    print(f"\n{'='*60}")
    print(f"COMPLETE! Total problems in {OUTPUT_FILE}: {len(existing_data)}")
    print(f"   New:             {success_count}")
    print(f"   Skipped:         {skipped_count}")
    print(f"   Failed:          {failed_count}")
    if failed_entries:
        print(f"   Failed IDs:      {failed_entries}")
    print(f"{'='*60}")

if __name__ == "__main__":
    fetch_all_questions()