// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import * as sinon from 'sinon';
import * as TypeMoq from 'typemoq';
import { GlobalEnvironmentVariableCollection, Uri, WorkspaceConfiguration } from 'vscode';
import * as workspaceApis from '../../../client/common/vscodeApis/workspaceApis';
import { registerPythonStartup } from '../../../client/terminals/pythonStartup';
import { IExtensionContext } from '../../../client/common/types';

suite('Terminal - Shell Integration with PYTHONSTARTUP', () => {
    let getConfigurationStub: sinon.SinonStub;
    let pythonConfig: TypeMoq.IMock<WorkspaceConfiguration>;
    let editorConfig: TypeMoq.IMock<WorkspaceConfiguration>;
    let context: TypeMoq.IMock<IExtensionContext>;
    let createDirectoryStub: sinon.SinonStub;
    let copyStub: sinon.SinonStub;
    let globalEnvironmentVariableCollection: TypeMoq.IMock<GlobalEnvironmentVariableCollection>;

    setup(() => {
        context = TypeMoq.Mock.ofType<IExtensionContext>();
        globalEnvironmentVariableCollection = TypeMoq.Mock.ofType<GlobalEnvironmentVariableCollection>();

        // Question: Why do we have to set up environmentVariableCollection and globalEnvironmentVariableCollection in this flip-flop way?
        // Reference: /vscode-python/src/test/interpreters/activation/terminalEnvVarCollectionService.unit.test.ts
        context.setup((c) => c.environmentVariableCollection).returns(() => globalEnvironmentVariableCollection.object);
        context.setup((c) => c.storageUri).returns(() => Uri.parse('a'));

        globalEnvironmentVariableCollection
            .setup((c) => c.replace(TypeMoq.It.isAny(), TypeMoq.It.isAny(), TypeMoq.It.isAny()))
            .returns(() => Promise.resolve());

        globalEnvironmentVariableCollection.setup((c) => c.delete(TypeMoq.It.isAny())).returns(() => Promise.resolve());

        getConfigurationStub = sinon.stub(workspaceApis, 'getConfiguration');
        createDirectoryStub = sinon.stub(workspaceApis, 'createDirectory');
        copyStub = sinon.stub(workspaceApis, 'copy');

        pythonConfig = TypeMoq.Mock.ofType<WorkspaceConfiguration>();
        editorConfig = TypeMoq.Mock.ofType<WorkspaceConfiguration>();
        getConfigurationStub.callsFake((section: string) => {
            if (section === 'python') {
                return pythonConfig.object;
            }
            return editorConfig.object;
        });

        createDirectoryStub.callsFake((_) => Promise.resolve());
        copyStub.callsFake((_, __, ___) => Promise.resolve());
    });

    teardown(() => {
        sinon.restore();
    });

    test('Verify createDirectory is called when shell integration is enabled', async () => {
        pythonConfig.setup((p) => p.get('terminal.shellIntegration.enabled')).returns(() => true);

        await registerPythonStartup(context.object);

        sinon.assert.calledOnce(createDirectoryStub);
    });

    test('Verify createDirectory is not called when shell integration is disabled', async () => {
        pythonConfig.setup((p) => p.get('terminal.shellIntegration.enabled')).returns(() => false);

        await registerPythonStartup(context.object);

        sinon.assert.notCalled(createDirectoryStub);
    });

    test('Verify copy is called when shell integration is enabled', async () => {
        pythonConfig.setup((p) => p.get('terminal.shellIntegration.enabled')).returns(() => true);

        await registerPythonStartup(context.object);

        sinon.assert.calledOnce(copyStub);
    });

    test('Verify copy is not called when shell integration is disabled', async () => {
        pythonConfig.setup((p) => p.get('terminal.shellIntegration.enabled')).returns(() => false);

        await registerPythonStartup(context.object);

        sinon.assert.notCalled(copyStub);
    });

    test('PYTHONSTARTUP is set when enableShellIntegration setting is true', async () => {
        pythonConfig.setup((p) => p.get('terminal.shellIntegration.enabled')).returns(() => true);

        await registerPythonStartup(context.object);

        globalEnvironmentVariableCollection.verify(
            (c) => c.replace('PYTHONSTARTUP', TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.once(),
        );
    });

    test('environmentCollection should not remove PYTHONSTARTUP when enableShellIntegration setting is true', async () => {
        pythonConfig.setup((p) => p.get('terminal.shellIntegration.enabled')).returns(() => true);

        await registerPythonStartup(context.object);

        globalEnvironmentVariableCollection.verify((c) => c.delete('PYTHONSTARTUP'), TypeMoq.Times.never());
    });

    test('PYTHONSTARTUP is not set when enableShellIntegration setting is false', async () => {
        pythonConfig.setup((p) => p.get('terminal.shellIntegration.enabled')).returns(() => false);

        await registerPythonStartup(context.object);

        globalEnvironmentVariableCollection.verify(
            (c) => c.replace('PYTHONSTARTUP', TypeMoq.It.isAny(), TypeMoq.It.isAny()),
            TypeMoq.Times.never(),
        );
    });

    test('PYTHONSTARTUP is deleted when enableShellIntegration setting is false', async () => {
        pythonConfig.setup((p) => p.get('terminal.shellIntegration.enabled')).returns(() => false);

        await registerPythonStartup(context.object);

        globalEnvironmentVariableCollection.verify((c) => c.delete('PYTHONSTARTUP'), TypeMoq.Times.once());
    });
});
