from collections.abc import Iterator

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import pytest


@pytest.fixture(autouse=True)
def close_matplotlib_figures() -> Iterator[None]:
    """Keep tests isolated from pyplot's process-global figure registry."""
    try:
        yield
    finally:
        plt.close("all")
