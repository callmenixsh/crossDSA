import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scrapers.atcoder_scraper import extract_statement, normalize_problems, save_data


class AtCoderScraperTests(unittest.TestCase):
    def test_selects_english_statement_and_keeps_constraints_separate(self):
        html = '''<div id="task-statement"><span class="lang-ja"><section>
          <h3>問題文</h3><p>Japanese text</p></section></span><span class="lang-en">
          <section><h3>Problem Statement</h3><p>A frog jumps <var>N</var> stones.</p><script>noise</script></section>
          <section><h3>Constraints</h3><ul><li>2 ≤ N ≤ 100</li></ul></section>
          <section><h3>Sample Input 1</h3><pre>4 10 30 40 20</pre></section></span></div>'''
        description, constraints = extract_statement(html)
        self.assertEqual(description, 'A frog jumps N stones.')
        self.assertEqual(constraints, '2 ≤ N ≤ 100')
        self.assertNotIn('Japanese', description)
        self.assertNotIn('noise', description)
        self.assertNotIn('30', description)

    def test_legacy_english_and_unavailable_english(self):
        self.assertEqual(extract_statement('<div id="task-statement"><h3>Problem Statement</h3><p>English only.</p><h3>Constraints</h3><p>N &lt; 10</p></div>'), ('English only.', 'N < 10'))
        self.assertEqual(extract_statement('<div id="task-statement"><h3>問題文</h3><p>Japanese only.</p></div>'), ('', ''))
        self.assertEqual(extract_statement('<html>Sign in</html>'), ('', ''))

    def test_normalization_excludes_active_future_heuristic_and_invalid_tasks(self):
        contests = [{'id': name, 'start_epoch_second': start, 'duration_second': 20} for name, start in
                    [('dp', 10), ('abc001', 10), ('abc002', 90), ('abc003', 200), ('ahc001', 10)]]
        problems = [{'id': task, 'contest_id': contest, 'name': 'Frog 1'} for task, contest in
                    [('dp_a', 'dp'), ('dp_a', 'abc001'), ('abc001_a', 'abc001'), ('abc002_a', 'abc002'), ('abc003_a', 'abc003'), ('ahc001_a', 'ahc001'), ('../evil', 'abc001')]]
        previous = [{'id': 'dp_a', 'description': 'Preserved statement', 'constraints': 'N >= 2', 'statementFetchedAt': '2026-10-09'}]
        records = normalize_problems(problems, contests, {'dp_a': {'difficulty': 123.5}, 'abc001_a': {'difficulty': float('nan')}}, previous, now=100)
        self.assertEqual([p['id'] for p in records], ['dp_a', 'abc001_a'])
        self.assertEqual(records[0]['url'], 'https://atcoder.jp/contests/dp/tasks/dp_a')
        self.assertEqual(records[0]['description'], 'Preserved statement')
        self.assertEqual(records[0]['estimatedDifficulty'], 124)
        self.assertEqual(records[0]['difficulty'], 'Unknown')
        self.assertNotIn('estimatedDifficulty', records[1])
        self.assertEqual(records[0]['topics'], [])

    def test_empty_response_does_not_produce_a_replacement_index(self):
        with self.assertRaises(ValueError):
            normalize_problems([], [], {})

    def test_failed_atomic_save_preserves_existing_index(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as directory:
            output = Path(directory) / 'atcoder-data.json'
            save_data([{'id': 'dp_a'}], output)
            with patch.object(Path, 'replace', side_effect=OSError('Disk unavailable')):
                with self.assertRaises(OSError):
                    save_data([{'id': 'dp_b'}], output)
            self.assertEqual(json.loads(output.read_text()), [{'id': 'dp_a'}])
            self.assertFalse(output.with_suffix('.json.tmp').exists())


if __name__ == '__main__':
    unittest.main()
