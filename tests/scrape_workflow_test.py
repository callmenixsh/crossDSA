import unittest
from unittest.mock import patch

import scrape


class ScrapeWorkflowTests(unittest.TestCase):
    def test_audit_runs_after_scrapers_and_pending_reviews_fail_the_workflow(self):
        with patch('sys.argv', ['scrape.py', 'leetcode']), patch.object(scrape, 'run', return_value=0) as run, patch.object(scrape.subprocess, 'call', return_value=1) as call:
            with self.assertRaises(SystemExit) as result:
                scrape.main()
            self.assertEqual(result.exception.code, 1)
            run.assert_called_once_with('leetcode', [])
            call.assert_called_once_with(['node', 'normalization/audit.mjs'], cwd=scrape.ROOT)

    def test_failed_scraper_still_audits_any_partially_written_snapshot(self):
        with patch('sys.argv', ['scrape.py', 'leetcode']), patch.object(scrape, 'run', return_value=1), patch.object(scrape, 'check_normalization_audit', return_value=0) as audit:
            with self.assertRaises(SystemExit) as result:
                scrape.main()
            self.assertEqual(result.exception.code, 1)
            audit.assert_called_once()

    def test_clean_workflow_and_missing_node(self):
        with patch('sys.argv', ['scrape.py', 'leetcode']), patch.object(scrape, 'run', return_value=0), patch.object(scrape, 'check_normalization_audit', return_value=0):
            with self.assertRaises(SystemExit) as result:
                scrape.main()
            self.assertEqual(result.exception.code, 0)
        with patch.object(scrape.subprocess, 'call', side_effect=FileNotFoundError):
            self.assertEqual(scrape.check_normalization_audit(), 1)


if __name__ == '__main__':
    unittest.main()
