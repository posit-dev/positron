#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#


import nox


@nox.session(venv_backend="uv")
@nox.parametrize("pandas", ["1.5.3"])
@nox.parametrize("numpy", ["1.24.4"])
@nox.parametrize("torch", ["1.12.1"])
@nox.parametrize("lightning", ["2.1.4"])
def test_minimum_reqs(session, pandas, numpy, torch, lightning):
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

    session.install("--force-reinstall", f"pandas=={pandas}")
    session.install("--force-reinstall", f"numpy=={numpy}")
    session.install("--force-reinstall", f"torch=={torch}")

    if session.posargs:
        test_args = session.posargs
    else:
        test_args = []

    session.run("pytest", *test_args)
