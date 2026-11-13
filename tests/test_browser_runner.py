from types import SimpleNamespace

import pytest

from scripts import verify_browser


@pytest.mark.parametrize(
    "platform,failures,expected_attempts",
    [("win32", 1, 2), ("win32", 10, 5), ("linux", 1, 1)],
)
def test_isolated_store_cleanup_retries_only_bounded_windows_locks(
    monkeypatch, tmp_path, platform, failures, expected_attempts
):
    attempts, waits = [], []

    def cleanup():
        attempts.append(True)
        if len(attempts) <= failures:
            raise PermissionError("Test-store file is temporarily locked")

    directory = SimpleNamespace(name=str(tmp_path), cleanup=cleanup)
    monkeypatch.setattr(verify_browser.tempfile, "TemporaryDirectory", lambda **_: directory)
    monkeypatch.setattr(verify_browser.sys, "platform", platform)
    monkeypatch.setattr(verify_browser.time, "sleep", waits.append)
    if failures >= expected_attempts:
        with pytest.raises(PermissionError, match="temporarily locked"):
            with verify_browser.isolated_store(tmp_path):
                pass
    else:
        with verify_browser.isolated_store(tmp_path) as selected:
            assert selected == str(tmp_path)
    assert len(attempts) == expected_attempts
    assert waits == [1] * (expected_attempts - 1)
