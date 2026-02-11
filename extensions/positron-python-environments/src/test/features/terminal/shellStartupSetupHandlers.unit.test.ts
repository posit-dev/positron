import * as assert from 'assert';
import * as sinon from 'sinon';
import { Disposable, Progress } from 'vscode';

import * as commandApi from '../../../common/command.api';
import { Common } from '../../../common/localize';
import * as windowApis from '../../../common/window.apis';
import {
    cleanupStartupScripts,
    handleSettingUpShellProfile,
} from '../../../features/terminal/shellStartupSetupHandlers';
import { ShellScriptEditState, ShellStartupScriptProvider } from '../../../features/terminal/shells/startupProvider';
import * as terminalUtils from '../../../features/terminal/utils';

class TestStartupProvider implements ShellStartupScriptProvider {
    public readonly name: string;
    public readonly shellType: string;

    public setupResult: ShellScriptEditState = ShellScriptEditState.Edited;
    public teardownResult: ShellScriptEditState = ShellScriptEditState.Edited;

    public setupCalls = 0;
    public teardownCalls = 0;

    constructor(name: string, shellType: string) {
        this.name = name;
        this.shellType = shellType;
    }

    async isSetup(): Promise<never> {
        throw new Error('Not used in these unit tests');
    }

    async setupScripts(): Promise<ShellScriptEditState> {
        this.setupCalls += 1;
        return this.setupResult;
    }

    async teardownScripts(): Promise<ShellScriptEditState> {
        this.teardownCalls += 1;
        return this.teardownResult;
    }

    async clearCache(): Promise<void> {
        // Not needed
    }
}

suite('Shell Startup Setup Handlers', () => {
    teardown(() => sinon.restore());

    test('handleSettingUpShellProfile: when user accepts and all providers edit, callback(true) is reported', async () => {
        sinon.stub(windowApis, 'showInformationMessage').resolves(Common.yes);
        sinon.stub(windowApis, 'withProgress').callsFake(async (_opts, task) => {
            const progress: Progress<{ message?: string; increment?: number }> = { report: () => undefined };
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: () => new Disposable(() => undefined),
            };
            return task(progress, token);
        });

        const showError = sinon.stub(windowApis, 'showErrorMessage');
        const callback = sinon.stub();

        const p1 = new TestStartupProvider('bash', 'bash');
        const p2 = new TestStartupProvider('zsh', 'zsh');

        await handleSettingUpShellProfile([p1, p2], callback);

        // allow setImmediate prompt scheduling to run
        await new Promise<void>((resolve) => setImmediate(resolve));

        assert.strictEqual(showError.called, false);
        assert.strictEqual(callback.callCount, 2);
        assert.deepStrictEqual(
            callback.args.map((a) => a[1]),
            [true, true],
        );
    });

    test('handleSettingUpShellProfile: when user accepts but a provider fails, callback(false) and error prompt shown', async () => {
        sinon.stub(windowApis, 'showInformationMessage').resolves(Common.yes);
        sinon.stub(windowApis, 'withProgress').callsFake(async (_opts, task) => {
            const progress: Progress<{ message?: string; increment?: number }> = { report: () => undefined };
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: () => new Disposable(() => undefined),
            };
            return task(progress, token);
        });

        const showError = sinon.stub(windowApis, 'showErrorMessage').resolves(undefined);
        const callback = sinon.stub();

        const p1 = new TestStartupProvider('bash', 'bash');
        const p2 = new TestStartupProvider('zsh', 'zsh');
        p2.setupResult = ShellScriptEditState.NotEdited;

        await handleSettingUpShellProfile([p1, p2], callback);

        await new Promise<void>((resolve) => setImmediate(resolve));

        assert.strictEqual(showError.called, true);
        assert.strictEqual(callback.callCount, 2);
        assert.deepStrictEqual(
            callback.args.map((a) => a[1]),
            [false, false],
        );
    });

    test('handleSettingUpShellProfile: if user clicks "View Logs" on error, executes command', async () => {
        sinon.stub(windowApis, 'showInformationMessage').resolves(Common.yes);
        sinon.stub(windowApis, 'withProgress').callsFake(async (_opts, task) => {
            const progress: Progress<{ message?: string; increment?: number }> = { report: () => undefined };
            const token = {
                isCancellationRequested: false,
                onCancellationRequested: () => new Disposable(() => undefined),
            };
            return task(progress, token);
        });

        sinon.stub(windowApis, 'showErrorMessage').resolves(Common.viewLogs);
        const exec = sinon.stub(commandApi, 'executeCommand').resolves();

        const p1 = new TestStartupProvider('bash', 'bash');
        p1.setupResult = ShellScriptEditState.NotEdited;

        await handleSettingUpShellProfile([p1], () => undefined);

        await new Promise<void>((resolve) => setImmediate(resolve));

        assert.strictEqual(exec.calledWith('python-envs.viewLogs'), true);
    });

    test('handleSettingUpShellProfile: when user declines, does not run setup and switches to command', async () => {
        sinon.stub(windowApis, 'showInformationMessage').resolves(undefined);
        const setAuto = sinon.stub(terminalUtils, 'setAutoActivationType').resolves();

        const p1 = new TestStartupProvider('bash', 'bash');
        const p2 = new TestStartupProvider('zsh', 'zsh');

        await handleSettingUpShellProfile([p1, p2], () => undefined);

        assert.strictEqual(p1.setupCalls, 0);
        assert.strictEqual(p2.setupCalls, 0);
        // When user declines, it switches to command activation
        assert.strictEqual(setAuto.calledWith(terminalUtils.ACT_TYPE_COMMAND), true);
    });

    test('cleanupStartupScripts: always calls teardown on all providers', async () => {
        sinon.stub(windowApis, 'showInformationMessage').resolves(undefined);
        sinon.stub(terminalUtils, 'getAutoActivationType').returns(terminalUtils.ACT_TYPE_COMMAND);

        const setAuto = sinon.stub(terminalUtils, 'setAutoActivationType').resolves();

        const p1 = new TestStartupProvider('bash', 'bash');
        const p2 = new TestStartupProvider('zsh', 'zsh');

        await cleanupStartupScripts([p1, p2]);

        assert.strictEqual(p1.teardownCalls, 1);
        assert.strictEqual(p2.teardownCalls, 1);
        assert.strictEqual(setAuto.called, false);
    });

    test('cleanupStartupScripts: switches to command when current activation type is shellStartup', async () => {
        sinon.stub(windowApis, 'showInformationMessage').resolves(undefined);
        sinon.stub(terminalUtils, 'getAutoActivationType').returns(terminalUtils.ACT_TYPE_SHELL);

        const setAuto = sinon.stub(terminalUtils, 'setAutoActivationType').resolves();

        const p1 = new TestStartupProvider('bash', 'bash');

        await cleanupStartupScripts([p1]);

        await new Promise<void>((resolve) => setImmediate(resolve));

        assert.strictEqual(setAuto.calledWith(terminalUtils.ACT_TYPE_COMMAND), true);
    });
});
