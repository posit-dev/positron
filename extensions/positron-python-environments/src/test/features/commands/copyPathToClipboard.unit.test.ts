import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { PythonEnvironment } from '../../../api';
import * as envApis from '../../../common/env.apis';
import { copyPathToClipboard } from '../../../features/envCommands';
import {
    EnvManagerTreeItem,
    ProjectEnvironment,
    ProjectItem,
    PythonEnvTreeItem,
} from '../../../features/views/treeViewItems';
import { InternalEnvironmentManager } from '../../../internal.api';

suite('Copy Path To Clipboard', () => {
    let clipboardWriteTextStub: sinon.SinonStub;

    setup(() => {
        clipboardWriteTextStub = sinon.stub(envApis, 'clipboardWriteText');
        clipboardWriteTextStub.resolves();
    });

    teardown(() => {
        sinon.restore();
    });

    test('Copy project path to clipboard', async () => {
        const uri = Uri.file('/test');
        const item = new ProjectItem({ name: 'test', uri });
        await copyPathToClipboard(item);

        sinon.assert.calledOnce(clipboardWriteTextStub);
        sinon.assert.calledWith(clipboardWriteTextStub, uri.fsPath);
    });

    test('Copy env path to clipboard: project view', async () => {
        const uri = Uri.file('/test');
        const item = new ProjectEnvironment(new ProjectItem({ name: 'test', uri }), {
            envId: { managerId: 'test-manager', id: 'env1' },
            name: 'env1',
            displayName: 'Environment 1',
            displayPath: '/test-env',
            execInfo: { run: { executable: '/test-env/bin/test', args: ['-m', 'env'] } },
        } as PythonEnvironment);

        await copyPathToClipboard(item);

        sinon.assert.calledOnce(clipboardWriteTextStub);
        sinon.assert.calledWith(clipboardWriteTextStub, '/test-env/bin/test');
    });

    test('Copy env path to clipboard: env manager view', async () => {
        const item = new PythonEnvTreeItem(
            {
                envId: { managerId: 'test-manager', id: 'env1' },
                name: 'env1',
                displayName: 'Environment 1',
                displayPath: '/test-env',
                execInfo: { run: { executable: '/test-env/bin/test', args: ['-m', 'env'] } },
            } as PythonEnvironment,
            new EnvManagerTreeItem({ name: 'test-manager', id: 'test-manager' } as InternalEnvironmentManager),
        );

        await copyPathToClipboard(item);

        sinon.assert.calledOnce(clipboardWriteTextStub);
        sinon.assert.calledWith(clipboardWriteTextStub, '/test-env/bin/test');
    });

    test('Copy conda env path to clipboard: should copy interpreter path not conda run command', async () => {
        const item = new PythonEnvTreeItem(
            {
                envId: { managerId: 'conda', id: 'base' },
                name: 'base',
                displayName: 'base (3.12.2)',
                displayPath: '/opt/conda/envs/base',
                execInfo: {
                    run: { executable: '/opt/conda/envs/base/bin/python' },
                    activatedRun: {
                        executable: 'conda',
                        args: ['run', '--name', 'base', 'python'],
                    },
                },
            } as PythonEnvironment,
            new EnvManagerTreeItem({ name: 'conda', id: 'conda' } as InternalEnvironmentManager),
        );

        await copyPathToClipboard(item);

        sinon.assert.calledOnce(clipboardWriteTextStub);
        // Should copy the actual interpreter path, not the conda run command
        sinon.assert.calledWith(clipboardWriteTextStub, '/opt/conda/envs/base/bin/python');
    });

    test('Copy conda prefix env path to clipboard: should copy interpreter path not conda run command', async () => {
        const item = new PythonEnvTreeItem(
            {
                envId: { managerId: 'conda', id: 'myenv' },
                name: 'myenv',
                displayName: 'myenv (3.11.5)',
                displayPath: '/opt/conda/envs/myenv',
                execInfo: {
                    run: { executable: '/opt/conda/envs/myenv/bin/python' },
                    activatedRun: {
                        executable: 'conda',
                        args: ['run', '--prefix', '/opt/conda/envs/myenv', 'python'],
                    },
                },
            } as PythonEnvironment,
            new EnvManagerTreeItem({ name: 'conda', id: 'conda' } as InternalEnvironmentManager),
        );

        await copyPathToClipboard(item);

        sinon.assert.calledOnce(clipboardWriteTextStub);
        // Should copy the actual interpreter path, not the conda run command
        sinon.assert.calledWith(clipboardWriteTextStub, '/opt/conda/envs/myenv/bin/python');
    });
});
