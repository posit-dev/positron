/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as typemoq from 'typemoq';
import * as vscode from 'vscode';
import { IInterpreterSelector } from '../../client/interpreter/configuration/types';
import { IInterpreterService } from '../../client/interpreter/contracts';
import { IServiceContainer } from '../../client/ioc/types';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { IWorkspaceService } from '../../client/common/application/types';
import { recommendInterpreter } from '../../client/positron/discoverer';

suite('Python Runtime Discoverer - recommendInterpreter', () => {
    let serviceContainer: typemoq.IMock<IServiceContainer>;
    let interpreterService: typemoq.IMock<IInterpreterService>;
    let interpreterSelector: typemoq.IMock<IInterpreterSelector>;
    let workspaceConfig: typemoq.IMock<vscode.WorkspaceConfiguration>;
    let workspaceService: typemoq.IMock<IWorkspaceService>;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        serviceContainer = typemoq.Mock.ofType<IServiceContainer>();
        interpreterService = typemoq.Mock.ofType<IInterpreterService>();
        interpreterSelector = typemoq.Mock.ofType<IInterpreterSelector>();
        workspaceConfig = typemoq.Mock.ofType<vscode.WorkspaceConfiguration>();
        workspaceService = typemoq.Mock.ofType<IWorkspaceService>();

        const suggestions = [
            {
                interpreter: { path: '/path/to/env1' } as PythonEnvironment,
                label: '',
                path: '/path/to/env1',
            },
            {
                interpreter: { path: '/path/to/env2' } as PythonEnvironment,
                label: '',
                path: '/path/to/env2',
            },
            {
                interpreter: { path: '/path/to/env3' } as PythonEnvironment,
                label: '',
                path: '/path/to/env3',
            },
        ];

        serviceContainer.setup((c) => c.get(IInterpreterService)).returns(() => interpreterService.object);
        serviceContainer.setup((c) => c.get(IInterpreterSelector)).returns(() => interpreterSelector.object);
        serviceContainer.setup((c) => c.get(IWorkspaceService)).returns(() => workspaceService.object);
        interpreterSelector.setup((s) => s.getSuggestions(typemoq.It.isAny())).returns(() => suggestions);
        // interpreterSelector
        //     .setup((s) => s.getRecommendedSuggestion(typemoq.It.isAny(), typemoq.It.isAny()))
        //     .returns(() => suggestions[0]);
        workspaceService
            .setup((w) => w.getConfiguration('python', typemoq.It.isAny()))
            .returns(() => workspaceConfig.object);

        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            get: () => undefined,
            configurable: true,
        });
    });

    teardown(() => {
        sinon.restore();
        sandbox.restore();
    });

    test('Select defaultInterpreterPath when no workspace and defaultInterpreterPath is set', async () => {
        const expectedPath = '/path/to/py/config_default';
        const expectedInterpreter = { path: expectedPath } as PythonEnvironment;
        sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);

        workspaceConfig.setup((p) => p.get(typemoq.It.isValue('defaultInterpreterPath'))).returns(() => expectedPath);

        interpreterService
            .setup((s) => s.getInterpreterDetails(expectedPath))
            .returns(() => Promise.resolve(expectedInterpreter));

        const recommendedInterpreter = await recommendInterpreter(serviceContainer.object);

        expect(vscode.workspace.workspaceFolders?.[0]?.uri).to.equal(undefined);
        expect(
            vscode.workspace
                .getConfiguration('python', vscode.workspace.workspaceFolders?.[0]?.uri)
                .get<string>('defaultInterpreterPath'),
        ).to.equal(expectedPath);
        expect(recommendedInterpreter).to.equal(expectedInterpreter);
    });

    // test('Returns recommended suggestion when workspace exists', async () => {
    //     const workspacePath = 'workspace';
    //     const workspaceFolder = {
    //         name: 'workspace',
    //         uri: vscode.Uri.file(workspacePath),
    //         index: 0,
    //     };
    //     const expectedInterpreter = { path: '/recommended/python' } as PythonEnvironment;

    //     sandbox.stub(vscode.workspace, 'workspaceFolders').value([workspaceFolder]);

    //     interpreterSelector
    //         .setup((s) => s.getRecommendedSuggestion(suggestions, workspaceFolder.uri))
    //         .returns(() => suggestions[0]);

    //     const recommendedInterpreter = await recommendInterpreter(serviceContainer.object);

    //     expect(recommendedInterpreter).to.equal(expectedInterpreter);
    // });

    test('Falls back to active interpreter when no other options available', async () => {
        const workspaceUri = vscode.Uri.file('/workspace');
        const activeInterpreter = { path: '/active/python' } as PythonEnvironment;
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: workspaceUri, name: 'workspace', index: 0 }]);

        interpreterSelector.setup((s) => s.getSuggestions(workspaceUri)).returns(() => []);
        interpreterSelector.setup((s) => s.getRecommendedSuggestion([], workspaceUri)).returns(() => undefined);

        interpreterService
            .setup((s) => s.getActiveInterpreter(workspaceUri))
            .returns(() => Promise.resolve(activeInterpreter));

        const recommendedInterpreter = await recommendInterpreter(serviceContainer.object);

        expect(recommendedInterpreter).to.equal(activeInterpreter);
    });

    // test('Ignores defaultInterpreterPath when set to "python"', async () => {
    //     const workspaceUri = vscode.Uri.file('/workspace');
    //     const activeInterpreter = { path: '/active/python' } as PythonEnvironment;

    //     workspaceService
    //         .setup((w) => w.workspaceFolders)
    //         .returns(() => [{ uri: workspaceUri, name: 'workspace', index: 0 }]);
    //     workspaceConfig.setup((c) => c.get('defaultInterpreterPath')).returns(() => 'python');

    //     interpreterSelector.setup((s) => s.getSuggestions(workspaceUri)).returns(() => []);

    //     interpreterSelector.setup((s) => s.getRecommendedSuggestion([], workspaceUri)).returns(() => undefined);

    //     interpreterService
    //         .setup((s) => s.getActiveInterpreter(workspaceUri))
    //         .returns(() => Promise.resolve(activeInterpreter));

    //     const recommendedInterpreter = await recommendInterpreter(serviceContainer.object);

    //     expect(recommendedInterpreter).to.equal(activeInterpreter);
    // });
});
