/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import { assert } from 'chai';
import * as fsPaths from '../../client/common/platform/fs-paths';
import * as platform from '../../client/common/utils/platform';
import {
    ExternallyManagedSignals,
    isExternallyManagedEnvironment,
} from '../../client/positron/externallyManagedEnvironment';
import { NativePythonEnvironmentKind } from '../../client/pythonEnvironments/base/locators/common/nativePythonUtils';
import { EnvironmentType, PythonEnvironment } from '../../client/pythonEnvironments/info';

suite('Externally managed environment detection', () => {
    let pathExistsStub: sinon.SinonStub;
    let getOSTypeStub: sinon.SinonStub;

    function makeEnvironment(overrides: Partial<PythonEnvironment> = {}): PythonEnvironment {
        return {
            path: '/usr/bin/python3',
            architecture: platform.Architecture.x64,
            sysPrefix: '/usr',
            version: { major: 3, minor: 12, patch: 3, raw: '3.12.3' },
            envType: EnvironmentType.System,
            ...overrides,
        } as PythonEnvironment;
    }

    function makeSignals(overrides: Partial<ExternallyManagedSignals> = {}): ExternallyManagedSignals {
        return {
            interpreterPath: '/opt/python/bin/python3',
            nativeKind: undefined,
            environment: makeEnvironment({ path: '/opt/python/bin/python3', sysPrefix: '/opt/python' }),
            ...overrides,
        };
    }

    setup(() => {
        pathExistsStub = sinon.stub(fsPaths, 'pathExists').resolves(false);
        getOSTypeStub = sinon.stub(platform, 'getOSType').returns(platform.OSType.Linux);
    });

    teardown(() => {
        sinon.restore();
    });

    test('flags OS and package-manager PET kinds', async () => {
        const kinds = [
            NativePythonEnvironmentKind.Homebrew,
            NativePythonEnvironmentKind.MacCommandLineTools,
            NativePythonEnvironmentKind.MacXCode,
            NativePythonEnvironmentKind.LinuxGlobal,
        ];

        const results = await Promise.all(
            kinds.map((nativeKind) => isExternallyManagedEnvironment(makeSignals({ nativeKind }))),
        );

        assert.deepStrictEqual(results, [true, true, true, true]);
    });

    test('does not flag python.org, Windows Store, or Windows registry installs', async () => {
        const kinds = [
            NativePythonEnvironmentKind.MacPythonOrg,
            NativePythonEnvironmentKind.WindowsStore,
            NativePythonEnvironmentKind.WindowsRegistry,
        ];

        const results = await Promise.all(
            kinds.map((nativeKind) => isExternallyManagedEnvironment(makeSignals({ nativeKind }))),
        );

        assert.deepStrictEqual(results, [false, false, false]);
    });

    test('flags a base conda environment but not a named one', async () => {
        const base = await isExternallyManagedEnvironment(
            makeSignals({
                environment: makeEnvironment({ envType: EnvironmentType.Conda, envName: 'base' }),
            }),
        );
        const named = await isExternallyManagedEnvironment(
            makeSignals({
                environment: makeEnvironment({ envType: EnvironmentType.Conda, envName: 'project' }),
            }),
        );

        assert.deepStrictEqual({ base, named }, { base: true, named: false });
    });

    test('fast-paths virtual environment types to false even with a marker present', async () => {
        pathExistsStub.resolves(true);
        const envTypes = [
            EnvironmentType.Venv,
            EnvironmentType.VirtualEnv,
            EnvironmentType.VirtualEnvWrapper,
            EnvironmentType.Pipenv,
            EnvironmentType.Poetry,
        ];

        const results = await Promise.all(
            envTypes.map((envType) =>
                isExternallyManagedEnvironment(makeSignals({ environment: makeEnvironment({ envType }) })),
            ),
        );

        assert.deepStrictEqual(results, [false, false, false, false, false]);
    });

    test('flags a uv base install by its marker but not a uv virtual environment', async () => {
        // Both carry PET kind Uv; only the base install has the PEP 668 marker.
        pathExistsStub
            .withArgs('/home/user/.local/share/uv/python/cpython-3.12.3/lib/python3.12/EXTERNALLY-MANAGED')
            .resolves(true);

        const uvBase = await isExternallyManagedEnvironment(
            makeSignals({
                nativeKind: NativePythonEnvironmentKind.Uv,
                environment: makeEnvironment({
                    envType: EnvironmentType.Uv,
                    path: '/home/user/.local/share/uv/python/cpython-3.12.3/bin/python3',
                    sysPrefix: '/home/user/.local/share/uv/python/cpython-3.12.3',
                }),
            }),
        );
        const uvVenv = await isExternallyManagedEnvironment(
            makeSignals({
                nativeKind: NativePythonEnvironmentKind.Uv,
                environment: makeEnvironment({
                    envType: EnvironmentType.Uv,
                    path: '/work/project/.venv/bin/python',
                    sysPrefix: '/work/project/.venv',
                }),
            }),
        );

        assert.deepStrictEqual({ uvBase, uvVenv }, { uvBase: true, uvVenv: false });
    });

    test('looks for the marker in the Windows layout on Windows', async () => {
        getOSTypeStub.returns(platform.OSType.Windows);
        pathExistsStub.resolves(true);

        const flagged = await isExternallyManagedEnvironment(
            makeSignals({
                environment: makeEnvironment({ path: 'C:\\Python312\\python.exe', sysPrefix: 'C:\\Python312' }),
            }),
        );

        assert.deepStrictEqual(
            { flagged, checked: pathExistsStub.firstCall.args[0] },
            { flagged: true, checked: 'C:\\Python312\\Lib\\EXTERNALLY-MANAGED' },
        );
    });

    test('flags an unmarked interpreter that lives in a system bin directory', async () => {
        const usrBin = await isExternallyManagedEnvironment(
            makeSignals({ interpreterPath: '/usr/bin/python3', environment: makeEnvironment() }),
        );
        const bin = await isExternallyManagedEnvironment(
            makeSignals({ interpreterPath: '/bin/python3', environment: makeEnvironment({ path: '/bin/python3' }) }),
        );
        const usrLocalBin = await isExternallyManagedEnvironment(
            makeSignals({
                interpreterPath: '/usr/local/bin/python3',
                environment: makeEnvironment({ path: '/usr/local/bin/python3', sysPrefix: '/usr/local' }),
            }),
        );

        assert.deepStrictEqual({ usrBin, bin, usrLocalBin }, { usrBin: true, bin: true, usrLocalBin: false });
    });

    test('does not flag when there is no environment and no other signal', async () => {
        const flagged = await isExternallyManagedEnvironment(
            makeSignals({ environment: undefined, interpreterPath: '/opt/python/bin/python3' }),
        );

        assert.strictEqual(flagged, false);
    });

    test('does not flag when the marker check throws', async () => {
        pathExistsStub.rejects(new Error('EACCES'));

        const flagged = await isExternallyManagedEnvironment(makeSignals());

        assert.strictEqual(flagged, false);
    });
});
