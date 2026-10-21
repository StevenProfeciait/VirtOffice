"""Unit tests for scripts/local_job_store.py."""
import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "scripts"))


class LocalJobStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.jobs = self.tmp / "jobs"
        self.index = self.jobs / "jobs_index.jsonl"
        os.environ["TEVA_LOCAL_JOBS_DIR"] = str(self.jobs)
        os.environ["TEVA_LOCAL_JOBS_INDEX"] = str(self.index)
        sys.modules.pop("local_job_store", None)
        self.ljs = importlib.import_module("local_job_store")

    def test_create_and_transitions(self):
        ok, job = self.ljs.create_job(
            "le2", "fix validation", model="m", seat_ids={"le2"},
            jobs_dir=self.jobs, index_path=self.index,
        )
        self.assertTrue(ok, job)
        self.assertEqual(job["status"], "QUEUED")
        jid = job["job_id"]
        ok, job = self.ljs.transition(jid, "RUNNING", jobs_dir=self.jobs, index_path=self.index)
        self.assertTrue(ok)
        ok, err = self.ljs.transition(jid, "APPLIED", jobs_dir=self.jobs, index_path=self.index)
        self.assertFalse(ok)
        ok, job = self.ljs.transition(
            jid, "AWAITING_APPROVAL",
            {"proposed_patch": [{"path": "/x", "content": "y"}]},
            jobs_dir=self.jobs, index_path=self.index,
        )
        self.assertTrue(ok)
        ok, job = self.ljs.transition(jid, "REJECTED", jobs_dir=self.jobs, index_path=self.index)
        self.assertTrue(ok)
        self.assertEqual(job["status"], "REJECTED")

    def test_pilot_only(self):
        ok, err = self.ljs.create_job(
            "sa", "x", seat_ids={"sa", "le2"}, jobs_dir=self.jobs, index_path=self.index,
        )
        self.assertFalse(ok)

    def test_claim_next(self):
        self.ljs.create_job("le2", "a", seat_ids={"le2"}, jobs_dir=self.jobs, index_path=self.index)
        claimed = self.ljs.claim_next(jobs_dir=self.jobs, index_path=self.index)
        self.assertEqual(claimed["status"], "RUNNING")
        self.assertIsNone(self.ljs.claim_next(jobs_dir=self.jobs, index_path=self.index))

    def test_cancel_from_queued(self):
        ok, job = self.ljs.create_job(
            "le2", "c", seat_ids={"le2"}, jobs_dir=self.jobs, index_path=self.index,
        )
        ok, job = self.ljs.transition(job["job_id"], "CANCELLED",
                                      jobs_dir=self.jobs, index_path=self.index)
        self.assertTrue(ok)


if __name__ == "__main__":
    unittest.main()
