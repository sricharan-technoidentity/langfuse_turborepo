import os, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ["KIROCREW_HOME"] = tempfile.mkdtemp(prefix="dfhome-")
os.environ["DECK_FORGE_APP_ROOT"] = str(HERE.parents[1])  # apps/deck-forge (app.json, agents/)
os.environ["DECK_FORGE_KIRO_CLI"] = str(HERE / "fake-kiro-cli")
os.environ.pop("KIROCREW_PROXY_SECRET", None)

import pytest  # noqa: E402

from repo_observability.testing import TestTracing, create_test_tracing  # noqa: E402


@pytest.fixture(scope="session")
def session_tracing():
    t = create_test_tracing()
    yield t
    t.shutdown()


@pytest.fixture
def tracing_on(session_tracing: TestTracing):
    from deck_forge_backend import tracing
    session_tracing.reset()
    tracing.enable_for_tests()
    yield session_tracing
    tracing.disable()
