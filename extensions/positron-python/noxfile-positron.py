#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#


import nox


@nox.session()
@nox.parametrize('pandas', ['1.5.3'])
@nox.parametrize('torch', ['1.12.1'])
def test_minimum_reqs(session, pandas, torch):
    session.install("-r", "python_files/positron/pinned-test-requirements.txt")
    session.install('--force-reinstall', f'pandas=={pandas}')
    session.install('--force-reinstall', f'torch=={torch}')

    if session.posargs:
        test_args = session.posargs
    else:
        test_args = []

    session.run('pytest', *test_args)
