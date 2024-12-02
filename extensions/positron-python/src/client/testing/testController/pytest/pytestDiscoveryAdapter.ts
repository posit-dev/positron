// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import * as path from 'path';
import { Uri } from 'vscode';
import * as fs from 'fs';
import {
    ExecutionFactoryCreateWithEnvironmentOptions,
    IPythonExecutionFactory,
    SpawnOptions,
} from '../../../common/process/types';
import { IConfigurationService, ITestOutputChannel } from '../../../common/types';
import { Deferred } from '../../../common/utils/async';
import { EXTENSION_ROOT_DIR } from '../../../constants';
import { traceError, traceInfo, traceVerbose, traceWarn } from '../../../logging';
import { DiscoveredTestPayload, ITestDiscoveryAdapter, ITestResultResolver } from '../common/types';
import {
    MESSAGE_ON_TESTING_OUTPUT_MOVE,
    createDiscoveryErrorPayload,
    createTestingDeferred,
    fixLogLinesNoTrailing,
    startDiscoveryNamedPipe,
    addValueIfKeyNotExist,
    hasSymlinkParent,
} from '../common/utils';
import { IEnvironmentVariablesProvider } from '../../../common/variables/types';
import { PythonEnvironment } from '../../../pythonEnvironments/info';

/**
 * Wrapper class for unittest test discovery. This is where we call `runTestCommand`. #this seems incorrectly copied
 */
export class PytestTestDiscoveryAdapter implements ITestDiscoveryAdapter {
    constructor(
        public configSettings: IConfigurationService,
        private readonly outputChannel: ITestOutputChannel,
        private readonly resultResolver?: ITestResultResolver,
        private readonly envVarsService?: IEnvironmentVariablesProvider,
    ) {}

    async discoverTests(
        uri: Uri,
        executionFactory?: IPythonExecutionFactory,
        interpreter?: PythonEnvironment,
    ): Promise<DiscoveredTestPayload> {
        const { name, dispose } = await startDiscoveryNamedPipe((data: DiscoveredTestPayload) => {
            this.resultResolver?.resolveDiscovery(data);
        });

        try {
            await this.runPytestDiscovery(uri, name, executionFactory, interpreter);
        } finally {
            dispose();
        }
        // this is only a placeholder to handle function overloading until rewrite is finished
        const discoveryPayload: DiscoveredTestPayload = { cwd: uri.fsPath, status: 'success' };
        return discoveryPayload;
    }

    async runPytestDiscovery(
        uri: Uri,
        discoveryPipeName: string,
        executionFactory?: IPythonExecutionFactory,
        interpreter?: PythonEnvironment,
    ): Promise<void> {
        const relativePathToPytest = 'python_files';
        const fullPluginPath = path.join(EXTENSION_ROOT_DIR, relativePathToPytest);
        const settings = this.configSettings.getSettings(uri);
        let { pytestArgs } = settings.testing;
        const cwd = settings.testing.cwd && settings.testing.cwd.length > 0 ? settings.testing.cwd : uri.fsPath;

        // check for symbolic path
        const stats = await fs.promises.lstat(cwd);
        const resolvedPath = await fs.promises.realpath(cwd);
        let isSymbolicLink = false;
        if (stats.isSymbolicLink()) {
            isSymbolicLink = true;
            traceWarn('The cwd is a symbolic link.');
        } else if (resolvedPath !== cwd) {
            traceWarn(
                'The cwd resolves to a different path, checking if it has a symbolic link somewhere in its path.',
            );
            isSymbolicLink = await hasSymlinkParent(cwd);
        }
        if (isSymbolicLink) {
            traceWarn("Symlink found, adding '--rootdir' to pytestArgs only if it doesn't already exist. cwd: ", cwd);
            pytestArgs = addValueIfKeyNotExist(pytestArgs, '--rootdir', cwd);
        }

        // get and edit env vars
        const mutableEnv = {
            ...(await this.envVarsService?.getEnvironmentVariables(uri)),
        };
        // get python path from mutable env, it contains process.env as well
        const pythonPathParts: string[] = mutableEnv.PYTHONPATH?.split(path.delimiter) ?? [];
        const pythonPathCommand = [fullPluginPath, ...pythonPathParts].join(path.delimiter);
        mutableEnv.PYTHONPATH = pythonPathCommand;
        mutableEnv.TEST_RUN_PIPE = discoveryPipeName;
        traceInfo(`All environment variables set for pytest discovery: ${JSON.stringify(mutableEnv)}`);
        const spawnOptions: SpawnOptions = {
            cwd,
            throwOnStdErr: true,
            outputChannel: this.outputChannel,
            env: mutableEnv,
        };

        // Create the Python environment in which to execute the command.
        const creationOptions: ExecutionFactoryCreateWithEnvironmentOptions = {
            allowEnvironmentFetchExceptions: false,
            resource: uri,
            interpreter,
        };
        const execService = await executionFactory?.createActivatedEnvironment(creationOptions);
        // delete UUID following entire discovery finishing.
        const execArgs = ['-m', 'pytest', '-p', 'vscode_pytest', '--collect-only'].concat(pytestArgs);
        traceVerbose(`Running pytest discovery with command: ${execArgs.join(' ')} for workspace ${uri.fsPath}.`);

        const deferredTillExecClose: Deferred<void> = createTestingDeferred();
        const result = execService?.execObservable(execArgs, spawnOptions);

        // Take all output from the subprocess and add it to the test output channel. This will be the pytest output.
        // Displays output to user and ensure the subprocess doesn't run into buffer overflow.
        // TODO: after a release, remove discovery output from the "Python Test Log" channel and send it to the "Python" channel instead.

        result?.proc?.stdout?.on('data', (data) => {
            const out = fixLogLinesNoTrailing(data.toString());
            traceInfo(out);
            spawnOptions?.outputChannel?.append(`${out}`);
        });
        result?.proc?.stderr?.on('data', (data) => {
            const out = fixLogLinesNoTrailing(data.toString());
            traceError(out);
            spawnOptions?.outputChannel?.append(`${out}`);
        });
        result?.proc?.on('exit', (code, signal) => {
            this.outputChannel?.append(MESSAGE_ON_TESTING_OUTPUT_MOVE);
            if (code !== 0) {
                traceError(
                    `Subprocess exited unsuccessfully with exit code ${code} and signal ${signal} on workspace ${uri.fsPath}.`,
                );
            }
        });
        result?.proc?.on('close', (code, signal) => {
            // pytest exits with code of 5 when 0 tests are found- this is not a failure for discovery.
            if (code !== 0 && code !== 5) {
                traceError(
                    `Subprocess exited unsuccessfully with exit code ${code} and signal ${signal} on workspace ${uri.fsPath}. Creating and sending error discovery payload`,
                );
                this.resultResolver?.resolveDiscovery(createDiscoveryErrorPayload(code, signal, cwd));
            }
            // due to the sync reading of the output.
            deferredTillExecClose?.resolve();
        });
        await deferredTillExecClose.promise;
    }
}
