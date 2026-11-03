import os
from pathlib import Path

import pytest

import repo_observability._connection as connection
from repo_observability import describe_langfuse_config, get_langfuse_config, load_env


def test_disabled_without_keys_with_defaults() -> None:
    config = get_langfuse_config({})
    assert not config.enabled
    assert config.base_url == "https://cloud.langfuse.com"
    assert config.environment == "development"
    assert "disabled" in describe_langfuse_config(config)


@pytest.mark.parametrize(
    "public_key,secret_key",
    [("<your-langfuse-public-key>", "<your-langfuse-secret-key>"), ("pk-lf-...", "sk-lf-...")],
)
def test_placeholders_count_as_missing(public_key: str, secret_key: str) -> None:
    config = get_langfuse_config({"LANGFUSE_PUBLIC_KEY": public_key, "LANGFUSE_SECRET_KEY": secret_key})
    assert not config.enabled
    assert config.public_key is None


def test_enabled_with_real_looking_keys_never_prints_secret() -> None:
    config = get_langfuse_config(
        {
            "LANGFUSE_PUBLIC_KEY": "pk-lf-1234567890",
            "LANGFUSE_SECRET_KEY": "sk-lf-supersecret",
            "LANGFUSE_BASE_URL": "https://us.cloud.langfuse.com",
            "LANGFUSE_TRACING_ENVIRONMENT": "staging",
        }
    )
    assert config.enabled
    assert config.environment == "staging"
    description = describe_langfuse_config(config)
    assert "us.cloud.langfuse.com" in description
    assert "supersecret" not in description


def test_load_env_walks_up_to_the_repo_root_and_never_overwrites(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(connection, "_env_loaded", False)
    (tmp_path / "turbo.json").write_text("{}")
    (tmp_path / ".env").write_text(
        '# comment\nREPO_OBS_A="quoted value"\nexport REPO_OBS_B=plain # trailing\nREPO_OBS_C=from-file\n'
    )
    app = tmp_path / "apps" / "api"
    app.mkdir(parents=True)
    monkeypatch.setenv("REPO_OBS_C", "from-env")
    for key in ("REPO_OBS_A", "REPO_OBS_B"):
        monkeypatch.delenv(key, raising=False)

    assert load_env(app) == tmp_path / ".env"
    assert os.environ["REPO_OBS_A"] == "quoted value"
    assert os.environ["REPO_OBS_B"] == "plain"
    assert os.environ["REPO_OBS_C"] == "from-env"
    monkeypatch.setattr(connection, "_env_loaded", False)


def test_load_env_stops_at_the_repo_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(connection, "_env_loaded", False)
    (tmp_path / ".env").write_text("REPO_OBS_OUTSIDE=1\n")
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "pnpm-workspace.yaml").write_text("packages: []\n")
    assert load_env(repo) is None
    monkeypatch.setattr(connection, "_env_loaded", False)
