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
        workspaceService.setup((w) => w.getConfiguration('python')).returns(() => workspaceConfig.object);

        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            get: () => undefined,
            configurable: true,
        });
    });

    teardown(() => {
        sinon.restore();
        sandbox.restore();
    });

    test('Returns recommended suggestion when workspace exists', async () => {
        const workspaceUri = vscode.Uri.file('/workspace');
        const activeInterpreter = {
            interpreter: { path: '/recommended/' } as PythonEnvironment,
            label: '',
            path: '/recommended/',
        };
        sandbox.stub(vscode.workspace, 'workspaceFolders').value([{ uri: workspaceUri, name: 'workspace', index: 0 }]);
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
        interpreterSelector.setup((s) => s.getSuggestions(typemoq.It.isAny())).returns(() => suggestions);
        interpreterSelector
            .setup((s) => s.getRecommendedSuggestion(suggestions, workspaceUri))
            .returns(() => activeInterpreter);

        interpreterService
            .setup((s) => s.getActiveInterpreter(workspaceUri))
            .returns(() => Promise.resolve(suggestions[0].interpreter));

        const recommendedInterpreter = await recommendInterpreter(serviceContainer.object);

        expect(recommendedInterpreter).to.equal(activeInterpreter.interpreter);
    });

    test('Falls back to active interpreter when no recommendation available', async () => {
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
});
