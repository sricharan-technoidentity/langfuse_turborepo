from collections.abc import Iterator

import pytest

from repo_observability.testing import TestTracing, create_test_tracing


@pytest.fixture(scope="session")
def session_tracing() -> Iterator[TestTracing]:
    tracing = create_test_tracing()
    yield tracing
    tracing.shutdown()


@pytest.fixture
def tracing(session_tracing: TestTracing) -> TestTracing:
    session_tracing.reset()
    return session_tracing
