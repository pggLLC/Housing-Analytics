"""Pytest configuration for Housing Analytics test suite.

Adds a WCAG compliance score summary line to terminal output so the
contrast-audit.yml workflow can extract it with:
    grep -o "WCAG COMPLIANCE SCORE: [0-9]*%" wcag-test-output.txt
"""


def pytest_terminal_summary(terminalreporter, exitstatus, config):  # noqa: ARG001
    """Print WCAG COMPLIANCE SCORE at end of test run.

    Parameters
    ----------
    terminalreporter : _pytest.terminal.TerminalReporter
        Provides access to collected test stats and the write_line helper.
    exitstatus : int
        Overall exit code (unused; score is computed from individual counts).
    config : pytest.Config
        Pytest configuration object (unused here).
    """
    passed = len(terminalreporter.stats.get('passed', []))
    failed = len(terminalreporter.stats.get('failed', []))
    error = len(terminalreporter.stats.get('error', []))
    total = passed + failed + error
    score = round(100 * passed / total) if total > 0 else 0
    terminalreporter.write_line(f'WCAG COMPLIANCE SCORE: {score}%')
