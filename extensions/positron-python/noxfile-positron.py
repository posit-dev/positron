#
# Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#


import nox


@nox.session(venv_backend="uv", python="3.10")
# ibis 12 reads pandas options that only exist in pandas 2, although it allows pandas 1.
@nox.parametrize(
    ["pandas", "numpy", "ibis"], [("1.*", "1.*", "11.*"), ("2.*", "2.*", "12.*")]
)
@nox.parametrize("torch", ["1.*"])
@nox.parametrize("lightning", ["2.1.*"])
def test_minimum_reqs(session, pandas, numpy, ibis, torch, lightning):
    session.run(
        "uv",
        "sync",
        "--active",
        "--inexact",
        "--frozen",
        "--project",
        "python_files/posit",
    )

    # Install lightning first, since it may override numpy/torch.
    session.install("--force-reinstall", f"lightning=={lightning}")

    # Install ibis before pandas and numpy, since it may override them.
    session.install("--force-reinstall", f"ibis-framework[duckdb]=={ibis}")

    session.install("--force-reinstall", f"pandas=={pandas}")
    session.install("--force-reinstall", f"numpy=={numpy}")
    session.install("--force-reinstall", f"torch=={torch}")

    if session.posargs:
        test_args = session.posargs
    else:
        test_args = []

    session.run("pytest", *test_args)
