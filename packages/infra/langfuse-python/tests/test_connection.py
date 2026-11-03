import os
from pathlib import Path

import pytest

import repo_langfuse._connection as connection
from repo_langfuse import INFRA_ENV_FILE, describe_langfuse_config, get_langfuse_config, load_env


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


@pytest.fixture
def fresh_env(monkeypatch: pytest.MonkeyPatch) -> pytest.MonkeyPatch:
    monkeypatch.setattr(connection, "_loaded", None)
    for key in ("REPO_ENV_APP", "REPO_ENV_INFRA", "REPO_ENV_BOTH", "REPO_ENV_REAL", "REPO_ENV_OUTSIDE"):
        monkeypatch.delenv(key, raising=False)
    return monkeypatch


def test_load_env_reads_app_env_then_infra_env_and_never_overwrites(tmp_path: Path, fresh_env: pytest.MonkeyPatch) -> None:
    (tmp_path / "turbo.json").write_text("{}")
    (tmp_path / ".env").write_text(
        '# comment\nREPO_ENV_APP="quoted value"\nexport REPO_ENV_BOTH=root # trailing\nREPO_ENV_REAL=file\n'
    )
    infra_env = tmp_path / "packages" / "infra" / ".env"
    infra_env.parent.mkdir(parents=True)
    infra_env.write_text("REPO_ENV_INFRA=infra\nREPO_ENV_BOTH=infra\n")
    app = tmp_path / "apps" / "api"
    app.mkdir(parents=True)
    fresh_env.setenv("REPO_ENV_REAL", "real")

    assert load_env(app, infra_env) == [tmp_path / ".env", infra_env]
    assert os.environ["REPO_ENV_APP"] == "quoted value"
    assert os.environ["REPO_ENV_INFRA"] == "infra"
    assert os.environ["REPO_ENV_BOTH"] == "root"
    assert os.environ["REPO_ENV_REAL"] == "real"


def test_load_env_stops_at_the_repo_root_and_skips_missing_files(tmp_path: Path, fresh_env: pytest.MonkeyPatch) -> None:
    (tmp_path / ".env").write_text("REPO_ENV_OUTSIDE=1\n")
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "pnpm-workspace.yaml").write_text("packages: []\n")
    assert load_env(repo, repo / "packages" / "infra" / ".env") == []
    assert "REPO_ENV_OUTSIDE" not in os.environ


def test_infra_env_file_points_at_packages_infra() -> None:
    assert INFRA_ENV_FILE.parts[-3:] == ("packages", "infra", ".env")
