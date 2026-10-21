"""Unit tests for scripts/local_job_worker.py with mocked Ollama."""
import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "scripts"))


class LocalJobWorkerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "app.py").write_text("x = 1\n", encoding="utf-8")
        self.jobs = self.tmp / "jobs"
        self.index = self.jobs / "jobs_index.jsonl"
        os.environ["TEVA_LOCAL_JOBS_DIR"] = str(self.jobs)
        os.environ["TEVA_LOCAL_JOBS_INDEX"] = str(self.index)
        os.environ["TEVA_OLLAMA_CONFIG"] = str(self.tmp / "ollama_config.json")
        os.environ["TEVA_HQ_DIR"] = str(self.tmp)
        for m in ("local_job_store", "local_job_worker", "local_agent_tools", "ollama_provider"):
            sys.modules.pop(m, None)
        self.ljs = importlib.import_module("local_job_store")
        self.op = importlib.import_module("ollama_provider")
        self.lat = importlib.import_module("local_agent_tools")
        self.worker = importlib.import_module("local_job_worker")
        cfg = self.op.default_config(workspace=str(self.tmp))
        cfg["defaults"]["code"] = "mock-model"
        cfg["seat_models"]["le2"] = {"model": "mock-model", "role": "code"}
        cfg["workspace_roots"] = [str(self.tmp)]
        self.op.save_config(cfg)

    def test_react_to_awaiting_approval(self):
        ok, job = self.ljs.create_job(
            "le2", "Update app.py to set x = 2", model="mock-model",
            seat_ids={"le2"}, jobs_dir=self.jobs, index_path=self.index,
        )
        self.assertTrue(ok)
        self.ljs.transition(job["job_id"], "RUNNING", jobs_dir=self.jobs, index_path=self.index)

        calls = {"n": 0}

        def fake_health(fill_defaults=False):
            return {"ok": True, "error_code": None}

        def fake_chat(messages, model, tools=None, base_url=None, temperature=0.2):
            calls["n"] += 1
            if calls["n"] == 1:
                return {
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [{
                            "id": "1",
                            "function": {
                                "name": "propose_edit",
                                "arguments": json.dumps({
                                    "path": "app.py",
                                    "content": "x = 2\n",
                                }),
                            },
                        }],
                    },
                    "tool_calls": [{
                        "id": "1",
                        "function": {
                            "name": "propose_edit",
                            "arguments": json.dumps({"path": "app.py", "content": "x = 2\n"}),
                        },
                    }],
                    "content": None,
                }
            return {
                "message": {"role": "assistant", "content": "Proposed edit to app.py"},
                "tool_calls": [],
                "content": "Proposed edit to app.py",
            }

        provider = SimpleNamespace(
            load_config=self.op.load_config,
            model_for_seat=self.op.model_for_seat,
            health=fake_health,
            chat_completions=fake_chat,
            OllamaError=self.op.OllamaError,
        )
        # Patch get_job/transition to use our dirs — modules already pointed via env
        updated = self.worker.run_job(
            self.ljs.get_job(job["job_id"]),
            provider=provider,
            tools_mod=self.lat,
            job_store=self.ljs,
        )
        self.assertEqual(updated["status"], "AWAITING_APPROVAL")
        self.assertTrue(updated["proposed_patch"])
        # disk unchanged until approve
        self.assertEqual((self.tmp / "app.py").read_text(), "x = 1\n")


if __name__ == "__main__":
    unittest.main()
