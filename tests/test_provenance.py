from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from bfplot.provenance import processing_metadata


def git(directory: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(directory), *arguments],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def test_processing_metadata_records_script_repository_commit(tmp_path, monkeypatch) -> None:
    repository = tmp_path / "repository"
    repository.mkdir()
    git(repository, "init")
    git(repository, "config", "user.email", "bfplot@example.test")
    git(repository, "config", "user.name", "BFPlot Test")
    script = repository / "analysis.py"
    script.write_text("print('plot')\n")
    git(repository, "add", "analysis.py")
    git(repository, "commit", "-m", "add analysis")
    expected = git(repository, "rev-parse", "HEAD")

    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)
    monkeypatch.setattr(sys, "argv", [str(script)])

    assert processing_metadata()["git_commit"] == expected


def test_processing_metadata_omits_git_commit_outside_repository(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(sys, "argv", ["python"])

    assert "git_commit" not in processing_metadata()
