import * as cp from 'child_process';
import assert from 'node:assert';
import path from 'node:path';
import * as sinon from 'sinon';

import { Uri } from 'vscode';
import { PythonBackgroundRunOptions, PythonEnvironment } from '../../../api';
import * as childProcessApis from '../../../common/childProcess.apis';
import * as logging from '../../../common/logging';
import * as execUtils from '../../../features/execution/execUtils';
import { runInBackground } from '../../../features/execution/runInBackground';
import { MockChildProcess } from '../../mocks/mockChildProcess';

/**
 * Creates a mock PythonEnvironment for testing purposes.
 *
 * This helper function generates a complete PythonEnvironment object with sensible defaults
 * while allowing customization of the execInfo property, which is crucial for testing
 * different execution scenarios (activated vs non-activated environments, missing configs, etc.).
 *
 * @param execInfo - Execution information object containing run/activatedRun configs.
 *                   Pass null to create an environment without execInfo (tests fallback behavior).
 *                   Pass undefined or omit to get default execInfo with basic python3 executable.
 *                   Pass custom object to test specific execution configurations.
 * @returns A complete PythonEnvironment object suitable for testing
 *
 * @example
 * // Environment with default execInfo
 * const env = createMockEnvironment();
 *
 * // Environment without execInfo (tests fallback to 'python')
 * const envNoExec = createMockEnvironment(null);
 *
 * // Environment with custom execution config
 * const envCustom = createMockEnvironment({
 *   run: { executable: '/custom/python', args: ['--flag'] },
 *   activatedRun: { executable: '/venv/python', args: [] }
 * });
 */
function createMockEnvironment(execInfo?: object | null): PythonEnvironment {
    const baseEnv = {
        envId: { id: 'test-env', managerId: 'test-manager' },
        name: 'test-env',
        displayName: 'Test Environment',
        displayPath: '/path/to/env',
        version: '3.9.0',
        environmentPath: Uri.file('/path/to/env'),
        sysPrefix: '/path/to/sys/prefix',
    };

    if (execInfo === null) {
        // Return environment without execInfo for testing fallback scenarios
        return baseEnv as PythonEnvironment;
    }

    return {
        ...baseEnv,
        execInfo: (execInfo || {
            run: { executable: path.join('usr', 'bin', 'python3'), args: [] },
        }) as PythonEnvironment['execInfo'],
    };
}

// Store the created mock processes for testing
let _mockProcesses: MockChildProcess[] = [];

// Track spawned processes for testing
interface SpawnCall {
    executable: string;
    args: string[];
    options: cp.SpawnOptions;
}

let _spawnCalls: SpawnCall[] = [];

suite('runInBackground Function Tests', () => {
    let mockTraceInfo: sinon.SinonStub;
    let mockTraceWarn: sinon.SinonStub;
    let mockTraceError: sinon.SinonStub;
    let mockQuoteStringIfNecessary: sinon.SinonStub;
    let mockExistsSync: sinon.SinonStub;
    let mockSpawnProcess: sinon.SinonStub;

    setup(() => {
        // Reset tracking arrays
        _spawnCalls = [];
        _mockProcesses = [];

        // Mock logging functions
        mockTraceInfo = sinon.stub(logging, 'traceInfo');
        mockTraceWarn = sinon.stub(logging, 'traceWarn');
        mockTraceError = sinon.stub(logging, 'traceError');

        // Mock execUtils
        mockQuoteStringIfNecessary = sinon.stub(execUtils, 'quoteStringIfNecessary');
        mockQuoteStringIfNecessary.callsFake((arg: string) => arg);

        // Mock fs.existsSync to avoid file system checks
        mockExistsSync = sinon.stub();
        mockExistsSync.returns(true);
        const fs = require('fs');
        sinon.stub(fs, 'existsSync').callsFake(mockExistsSync);

        // Mock spawnProcess to capture calls and return mock process
        mockSpawnProcess = sinon.stub(childProcessApis, 'spawnProcess');
        mockSpawnProcess.callsFake((command: string, args: string[], options?: cp.SpawnOptions) => {
            // Track the spawn call for assertions
            _spawnCalls.push({
                executable: command,
                args: args,
                options: options || {},
            });

            // Create and return a mock child process that won't actually spawn
            const mockProcess = new MockChildProcess(command, args);
            _mockProcesses.push(mockProcess);

            // Set the pid property directly on the object
            Object.defineProperty(mockProcess, 'pid', {
                value: 12345,
                writable: false,
                configurable: true,
            });

            // Return the mock process (it extends EventEmitter and has stdin/stdout/stderr)
            return mockProcess as unknown as cp.ChildProcess;
        });
    });

    teardown(() => {
        sinon.restore();
    });

    suite('Executable and Args Logic', () => {
        test('should prefer activatedRun executable over run executable', async () => {
            // Mock → Environment with both activatedRun and run executables
            const environment = createMockEnvironment({
                run: {
                    executable: path.join('usr', 'bin', 'python3'),
                    args: ['--base-arg'],
                },
                activatedRun: {
                    executable: path.join('path', 'to', 'venv', 'python'),
                    args: ['--activated-arg'],
                },
            });

            const options: PythonBackgroundRunOptions = {
                args: ['script.py', '--script-arg'],
            };

            // Run
            await runInBackground(environment, options);

            // Assert
            assert.strictEqual(_spawnCalls.length, 1, 'Should call spawn once');
            const spawnCall = _spawnCalls[0];
            assert.strictEqual(
                spawnCall.executable,
                path.join('path', 'to', 'venv', 'python'),
                'Should prefer activatedRun executable',
            );
            assert.deepStrictEqual(
                spawnCall.args,
                ['--activated-arg', 'script.py', '--script-arg'],
                'Should combine activatedRun args with options args',
            );
        });

        test('should fallback to run executable when activatedRun not available', async () => {
            // Mock → Environment with only run executable
            const environment = createMockEnvironment({
                run: {
                    executable: path.join('usr', 'bin', 'python3'),
                    args: ['--base-arg'],
                },
            });

            const options: PythonBackgroundRunOptions = {
                args: ['module', '-m', 'pip', 'list'],
            };

            // Run
            await runInBackground(environment, options);

            // Assert
            assert.strictEqual(_spawnCalls.length, 1, 'Should call spawn once');
            const spawnCall = _spawnCalls[0];
            assert.strictEqual(spawnCall.executable, path.join('usr', 'bin', 'python3'), 'Should use run executable');
            assert.deepStrictEqual(
                spawnCall.args,
                ['--base-arg', 'module', '-m', 'pip', 'list'],
                'Should combine run args with options args',
            );
        });

        test('should fallback to "python" when no executable found', async () => {
            // Mock → Environment with no execInfo
            const environment = createMockEnvironment(null);

            const options: PythonBackgroundRunOptions = {
                args: ['script.py'],
            };

            // Run
            await runInBackground(environment, options);

            // Assert
            assert.strictEqual(_spawnCalls.length, 1, 'Should call spawn once');
            const spawnCall = _spawnCalls[0];
            assert.strictEqual(spawnCall.executable, 'python', 'Should fallback to "python"');
            assert.deepStrictEqual(spawnCall.args, ['script.py'], 'Should use options args only');
        });

        test('should remove quotes from executable path', async () => {
            // Mock → Environment with quoted executable path
            const environment = createMockEnvironment({
                run: {
                    executable: `"${path.join('path with spaces', 'python')}"`,
                    args: [],
                },
            });

            const options: PythonBackgroundRunOptions = {
                args: ['script.py'],
            };

            // Run
            await runInBackground(environment, options);

            // Assert
            assert.strictEqual(_spawnCalls.length, 1, 'Should call spawn once');
            const spawnCall = _spawnCalls[0];
            assert.strictEqual(
                spawnCall.executable,
                path.join('path with spaces', 'python'),
                'Should remove surrounding quotes',
            );
        });

        test('should handle empty args arrays', async () => {
            // Mock → Environment with no args and options with no args
            const environment = createMockEnvironment({
                run: {
                    executable: path.join('usr', 'bin', 'python3'),
                    // No args property
                },
            });

            const options: PythonBackgroundRunOptions = {
                args: [],
            };

            // Run
            await runInBackground(environment, options);

            // Assert
            assert.strictEqual(_spawnCalls.length, 1, 'Should call spawn once');
            const spawnCall = _spawnCalls[0];
            assert.deepStrictEqual(spawnCall.args, [], 'Should handle empty args arrays');
        });

        test('should combine environment args with options args correctly', async () => {
            // Mock → Complex environment with all options
            const environment = createMockEnvironment({
                run: {
                    executable: path.join('usr', 'bin', 'python3'),
                    args: ['--base'],
                },
                activatedRun: {
                    executable: path.join('venv', 'bin', 'python'),
                    args: ['--activated', '--optimized'],
                },
            });

            const options: PythonBackgroundRunOptions = {
                args: ['-m', 'mymodule', '--config', 'production'],
            };

            // Run
            await runInBackground(environment, options);

            // Assert
            assert.strictEqual(_spawnCalls.length, 1, 'Should call spawn once');
            const spawnCall = _spawnCalls[0];
            assert.strictEqual(spawnCall.executable, path.join('venv', 'bin', 'python'), 'Should prefer activatedRun');

            const expectedArgs = ['--activated', '--optimized', '-m', 'mymodule', '--config', 'production'];
            assert.deepStrictEqual(spawnCall.args, expectedArgs, 'Should combine all args correctly');
        });
    });

    suite('Logging Behavior', () => {
        test('should have proper logging methods available', () => {
            // Assert - verify logging functions exist
            assert.ok(mockTraceInfo, 'Should have traceInfo mock');
            assert.ok(mockTraceWarn, 'Should have traceWarn mock');
            assert.ok(mockTraceError, 'Should have traceError mock');
        });

        test('should have execUtils methods available', () => {
            // Assert - verify execUtils functions exist
            assert.ok(mockQuoteStringIfNecessary, 'Should have quoteStringIfNecessary mock');

            // Test the default behavior
            const result = mockQuoteStringIfNecessary('test-path');
            assert.strictEqual(result, 'test-path', 'Should return path unchanged by default');
        });
    });

    suite('Environment Structure Tests', () => {
        test('should create valid PythonEnvironment mock', () => {
            // Mock → Complete environment
            const environment = createMockEnvironment({
                run: { executable: path.join('usr', 'bin', 'python3'), args: ['--arg'] },
                activatedRun: { executable: path.join('venv', 'python'), args: ['--venv-arg'] },
            });

            // Assert - verify structure
            assert.ok(environment.envId, 'Should have envId');
            assert.strictEqual(environment.envId.id, 'test-env', 'Should have correct id');
            assert.strictEqual(environment.envId.managerId, 'test-manager', 'Should have correct managerId');
            assert.strictEqual(environment.name, 'test-env', 'Should have correct name');
            assert.strictEqual(environment.displayName, 'Test Environment', 'Should have correct displayName');
            assert.ok(environment.execInfo, 'Should have execInfo');
            assert.ok(environment.execInfo.run, 'Should have run config');
            assert.ok(environment.execInfo.activatedRun, 'Should have activatedRun config');
        });

        test('should create PythonBackgroundRunOptions correctly', () => {
            // Mock → Options with all properties
            const options: PythonBackgroundRunOptions = {
                args: ['-m', 'pytest', 'tests/', '--verbose'],
                cwd: '/project/root',
                env: { PYTHONPATH: '/custom/path', DEBUG: 'true' },
            };

            // Assert - verify structure
            assert.ok(Array.isArray(options.args), 'Should have args array');
            assert.strictEqual(options.args.length, 4, 'Should have correct number of args');
            assert.strictEqual(options.cwd, '/project/root', 'Should have correct cwd');
            assert.ok(options.env, 'Should have env object');
            assert.strictEqual(options.env.PYTHONPATH, '/custom/path', 'Should have correct PYTHONPATH');
            assert.strictEqual(options.env.DEBUG, 'true', 'Should have correct DEBUG value');
        });
    });

    suite('Edge Cases and Error Conditions', () => {
        test('should handle missing execInfo gracefully', async () => {
            // Mock → Environment without execInfo
            const environment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'test-env',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                sysPrefix: '/path/to/sys/prefix',
                // No execInfo
            } as PythonEnvironment;

            const options: PythonBackgroundRunOptions = {
                args: ['script.py'],
            };

            // Run
            await runInBackground(environment, options);

            // Assert
            assert.strictEqual(_spawnCalls.length, 1, 'Should call spawn once');
            const spawnCall = _spawnCalls[0];
            assert.strictEqual(spawnCall.executable, 'python', 'Should fallback to "python"');
            assert.deepStrictEqual(spawnCall.args, ['script.py'], 'Should use options args only');
        });

        test('should handle partial execInfo configurations', async () => {
            // Mock → Environment with run but no activatedRun
            const environment = createMockEnvironment({
                run: {
                    executable: path.join('usr', 'bin', 'python3'),
                    // No args
                },
                // No activatedRun
            });

            const options: PythonBackgroundRunOptions = {
                args: ['--help'],
            };

            // Run
            await runInBackground(environment, options);

            // Assert
            assert.strictEqual(_spawnCalls.length, 1, 'Should call spawn once');
            const spawnCall = _spawnCalls[0];
            assert.strictEqual(spawnCall.executable, path.join('usr', 'bin', 'python3'), 'Should use run executable');
            assert.deepStrictEqual(spawnCall.args, ['--help'], 'Should handle missing environment args');
        });

        test('should handle quote patterns correctly', async () => {
            // Test the common case of quoted paths with spaces
            const environment = createMockEnvironment({
                run: { executable: `"${path.join('path with spaces', 'python')}"`, args: [] },
            });

            const options: PythonBackgroundRunOptions = { args: [] };

            // Run
            await runInBackground(environment, options);

            // Assert
            assert.strictEqual(_spawnCalls.length, 1, 'Should call spawn once');
            const spawnCall = _spawnCalls[0];
            assert.strictEqual(
                spawnCall.executable,
                path.join('path with spaces', 'python'),
                'Should remove surrounding quotes from executable path',
            );
        });
    });
});
