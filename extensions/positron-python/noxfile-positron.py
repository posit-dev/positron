#
# Copyright (C) 2024 Posit Software, PBC. All rights reserved.
#


import nox


@nox.session()
@nox.parametrize('pandas', ['1.5.3'])
@nox.parametrize('torch', ['1.12.1'])
def tests(session, pandas, torch):
    session.install("-r", "python_files/positron/pinned-test-requirements.txt")
    session.install('--force-reinstall', f'pandas=={pandas}')
    session.install('--force-reinstall', f'torch=={torch}')

    session.run('pytest', 'python_files/positron/positron_ipykernel/tests')
