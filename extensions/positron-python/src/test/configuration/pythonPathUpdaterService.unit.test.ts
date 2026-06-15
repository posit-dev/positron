/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import * as TypeMoq from 'typemoq';
import { ConfigurationTarget } from 'vscode';
import { InterpreterPathUpdateOptions } from '../../client/common/types';
import { PythonPathUpdaterService } from '../../client/interpreter/configuration/pythonPathUpdaterService';
import {
    IPythonPathUpdaterService,
    IPythonPathUpdaterServiceFactory,
    IRecommendedEnvironmentService,
} from '../../client/interpreter/configuration/types';
import { IComponentAdapter } from '../../client/interpreter/contracts';

suite('Python Path Updater Service', () => {
    const pythonPath = 'path/to/python';

    let factory: TypeMoq.IMock<IPythonPathUpdaterServiceFactory>;
    let pyenvs: TypeMoq.IMock<IComponentAdapter>;
    let preferredEnvService: TypeMoq.IMock<IRecommendedEnvironmentService>;
    let updater: TypeMoq.IMock<IPythonPathUpdaterService>;
    let receivedCalls: { pythonPath: string | undefined; options: InterpreterPathUpdateOptions | undefined }[];
    let updaterServiceManager: PythonPathUpdaterService;

    setup(() => {
        factory = TypeMoq.Mock.ofType<IPythonPathUpdaterServiceFactory>();
        pyenvs = TypeMoq.Mock.ofType<IComponentAdapter>();
        preferredEnvService = TypeMoq.Mock.ofType<IRecommendedEnvironmentService>();
        updater = TypeMoq.Mock.ofType<IPythonPathUpdaterService>();
        receivedCalls = [];
        updater
            .setup((u) => u.updatePythonPath(TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .callback((updatedPath, options) => receivedCalls.push({ pythonPath: updatedPath, options }))
            .returns(() => Promise.resolve());
        factory.setup((f) => f.getGlobalPythonPathConfigurationService()).returns(() => updater.object);
        pyenvs.setup((p) => p.getInterpreterInformation(TypeMoq.It.isAny())).returns(() => Promise.resolve(undefined));
        updaterServiceManager = new PythonPathUpdaterService(factory.object, pyenvs.object, preferredEnvService.object);
    });

    const triggerDefaults: { trigger: 'ui' | 'shebang' | 'load'; startSession: boolean }[] = [
        { trigger: 'load', startSession: false },
        { trigger: 'ui', startSession: true },
        { trigger: 'shebang', startSession: true },
    ];
    triggerDefaults.forEach(({ trigger, startSession }) => {
        test(`Trigger '${trigger}' defaults to startSession: ${startSession} with a trigger-derived source`, async () => {
            await updaterServiceManager.updatePythonPath(pythonPath, ConfigurationTarget.Global, trigger);

            expect(receivedCalls).to.deep.equal([
                { pythonPath, options: { startSession, source: `path-updater-${trigger}` } },
            ]);
        });
    });

    test('Explicit options override the trigger-derived defaults', async () => {
        await updaterServiceManager.updatePythonPath(pythonPath, ConfigurationTarget.Global, 'load', undefined, {
            startSession: true,
            source: 'custom-source',
        });

        expect(receivedCalls).to.deep.equal([{ pythonPath, options: { startSession: true, source: 'custom-source' } }]);
    });

    test('Partial options override only the provided field; the rest derive from the trigger', async () => {
        await updaterServiceManager.updatePythonPath(pythonPath, ConfigurationTarget.Global, 'ui', undefined, {
            startSession: false,
        });

        expect(receivedCalls).to.deep.equal([
            { pythonPath, options: { startSession: false, source: 'path-updater-ui' } },
        ]);
    });
});
