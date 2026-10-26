/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { assert } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
import * as typemoq from 'typemoq';
import { Terminal, Uri } from 'vscode';
import { ITerminalManager } from '../../../client/common/application/types';
import * as fsPaths from '../../../client/common/platform/fs-paths';
import { _SCRIPTS_DIR } from '../../../client/common/process/internal/scripts/constants';
import { ITerminalHelper } from '../../../client/common/terminal/types';
import { IExtensionContext } from '../../../client/common/types';
import { IInterpreterService } from '../../../client/interpreter/contracts';
import { PythonEnvType } from '../../../client/pythonEnvironments/base/info';
import { PythonEnvironment } from '../../../client/pythonEnvironments/info';
import { TerminalDeactivateService } from '../../../client/terminals/envCollectionActivation/deactivateService';

suite('Terminal deactivate service', () => {
    const storageDir = path.join('global', 'storage');
    let copyFileStub: sinon.SinonStub;
    let terminalManager: typemoq.IMock<ITerminalManager>;
    let interpreterService: typemoq.IMock<IInterpreterService>;
    let service: TerminalDeactivateService;

    setup(() => {
        copyFileStub = sinon.stub(fsPaths, 'copyFile').resolves();
        sinon.stub(fsPaths, 'pathExists').resolves(true);

        terminalManager = typemoq.Mock.ofType<ITerminalManager>();
        const terminal = typemoq.Mock.ofType<Terminal>();
        terminalManager.setup((t) => t.createTerminal(typemoq.It.isAny())).returns(() => terminal.object);

        interpreterService = typemoq.Mock.ofType<IInterpreterService>();
        interpreterService.setup((i) => i.getInterpreters()).returns(() => []);
        interpreterService
            .setup((i) => i.getActiveInterpreter(typemoq.It.isAny()))
            .returns(() => Promise.resolve({ type: PythonEnvType.Virtual } as PythonEnvironment));

        const terminalHelper = typemoq.Mock.ofType<ITerminalHelper>();
        terminalHelper
            .setup((t) => t.buildCommandForTerminal(typemoq.It.isAny(), typemoq.It.isAny(), typemoq.It.isAny()))
            .returns(() => 'command');

        const context = typemoq.Mock.ofType<IExtensionContext>();
        context.setup((c) => c.globalStorageUri).returns(() => Uri.file(storageDir));

        service = new TerminalDeactivateService(
            terminalManager.object,
            interpreterService.object,
            terminalHelper.object,
            context.object,
        );
    });

    teardown(() => {
        sinon.restore();
    });

    test('Script location is in global storage, not the extension folder', async () => {
        const location = await service.getScriptLocation('/bin/zsh', undefined);

        assert.deepStrictEqual(location, path.join(Uri.file(storageDir).fsPath, 'deactivate', 'zsh'));
    });

    [
        ['/bin/zsh', 'zsh', 'deactivate'],
        ['pwsh', 'powershell', 'deactivate.ps1'],
    ].forEach(([shell, folder, script]) => {
        test(`Copies the ${folder} script to global storage and runs the terminal there`, async () => {
            await service.initializeScriptParams(shell);

            const location = path.join(Uri.file(storageDir).fsPath, 'deactivate', folder);
            assert.deepStrictEqual(copyFileStub.args, [
                [path.join(_SCRIPTS_DIR, 'deactivate', folder, script), path.join(location, script)],
            ]);
            terminalManager.verify(
                (t) => t.createTerminal(typemoq.It.is((options) => options.cwd === location)),
                typemoq.Times.once(),
            );
        });
    });
});
