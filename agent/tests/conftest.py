import pytest
from fastapi.testclient import TestClient

from agent import main
from backend.main import app
from backend.seed import seed


@pytest.fixture(autouse=True)
def backend(tmp_path, monkeypatch):
    """Point the agent at a test backend with its own freshly seeded database."""
    monkeypatch.setenv("UNDERCOVER_DB", str(tmp_path / "undercover.db"))
    seed()
    monkeypatch.setattr(main, "backend", lambda: TestClient(app))
