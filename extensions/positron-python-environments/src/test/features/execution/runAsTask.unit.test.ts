import * as assert from 'assert';
import * as sinon from 'sinon';
import { Task, TaskExecution, TaskPanelKind, TaskRevealKind, TaskScope, Uri, WorkspaceFolder } from 'vscode';
import { PythonEnvironment, PythonTaskExecutionOptions } from '../../../api';
import * as logging from '../../../common/logging';
import * as tasksApi from '../../../common/tasks.apis';
import * as workspaceApis from '../../../common/workspace.apis';
import * as execUtils from '../../../features/execution/execUtils';
import { runAsTask } from '../../../features/execution/runAsTask';

suite('runAsTask Tests', () => {
    let mockTraceInfo: sinon.SinonStub;
    let mockTraceWarn: sinon.SinonStub;
    let mockExecuteTask: sinon.SinonStub;
    let mockGetWorkspaceFolder: sinon.SinonStub;
    let mockQuoteStringIfNecessary: sinon.SinonStub;

    setup(() => {
        mockTraceInfo = sinon.stub(logging, 'traceInfo');
        mockTraceWarn = sinon.stub(logging, 'traceWarn');
        mockExecuteTask = sinon.stub(tasksApi, 'executeTask');
        mockGetWorkspaceFolder = sinon.stub(workspaceApis, 'getWorkspaceFolder');
        mockQuoteStringIfNecessary = sinon.stub(execUtils, 'quoteStringIfNecessary');
    });

    teardown(() => {
        sinon.restore();
    });

    suite('Happy Path Scenarios', () => {
        test('should create and execute task with activated run configuration', async () => {
            // Mock - Environment with activatedRun
            const environment: PythonEnvironment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                shortDisplayName: 'TestEnv',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                execInfo: {
                    run: {
                        executable: '/path/to/python',
                        args: ['--default'],
                    },
                    activatedRun: {
                        executable: '/activated/python',
                        args: ['--activated'],
                    },
                },
                sysPrefix: '/path/to/env',
            };

            const options: PythonTaskExecutionOptions = {
                name: 'Test Task',
                args: ['script.py', '--arg1'],
                project: {
                    name: 'Test Project',
                    uri: Uri.file('/workspace'),
                },
                cwd: '/workspace',
                env: { PATH: '/custom/path' },
            };

            const mockWorkspaceFolder: WorkspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'Test Workspace',
                index: 0,
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.withArgs(options.project?.uri).returns(mockWorkspaceFolder);
            mockQuoteStringIfNecessary.withArgs('/activated/python').returns('"/activated/python"');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run
            const result = await runAsTask(environment, options);

            // Assert
            assert.strictEqual(result, mockTaskExecution, 'Should return the task execution result');

            // Verify task creation
            assert.ok(mockExecuteTask.calledOnce, 'Should execute task once');
            const taskArg = mockExecuteTask.firstCall.args[0] as Task;

            assert.strictEqual(taskArg.definition.type, 'python', 'Task type should be python');
            assert.strictEqual(taskArg.scope, mockWorkspaceFolder, 'Task scope should be workspace folder');
            assert.strictEqual(taskArg.name, 'Test Task', 'Task name should match options');
            assert.strictEqual(taskArg.source, 'Python', 'Task source should be Python');
            assert.deepStrictEqual(taskArg.problemMatchers, ['$python'], 'Should use python problem matcher');

            // Verify presentation options
            assert.strictEqual(
                taskArg.presentationOptions?.reveal,
                TaskRevealKind.Silent,
                'Should use silent reveal by default',
            );
            assert.strictEqual(taskArg.presentationOptions?.echo, true, 'Should echo commands');
            assert.strictEqual(taskArg.presentationOptions?.panel, TaskPanelKind.Shared, 'Should use shared panel');
            assert.strictEqual(taskArg.presentationOptions?.close, false, 'Should not close panel');
            assert.strictEqual(taskArg.presentationOptions?.showReuseMessage, true, 'Should show reuse message');

            // Verify logging
            assert.ok(
                mockTraceInfo.calledWith(
                    sinon.match(/Running as task: "\/activated\/python" --activated script\.py --arg1/),
                ),
                'Should log execution command',
            );

            // Verify no warnings
            assert.ok(mockTraceWarn.notCalled, 'Should not log warnings for valid environment');
        });

        test('should create and execute task with regular run configuration when no activatedRun', async () => {
            // Mock - Environment without activatedRun
            const environment: PythonEnvironment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                execInfo: {
                    run: {
                        executable: '/path/to/python',
                        args: ['--default-arg'],
                    },
                },
                sysPrefix: '/path/to/env',
            };

            const options: PythonTaskExecutionOptions = {
                name: 'Simple Task',
                args: ['test.py'],
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.withArgs(undefined).returns(undefined);
            mockQuoteStringIfNecessary.withArgs('/path/to/python').returns('/path/to/python');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run
            const result = await runAsTask(environment, options);

            // Assert
            assert.strictEqual(result, mockTaskExecution, 'Should return the task execution result');

            const taskArg = mockExecuteTask.firstCall.args[0] as Task;
            assert.strictEqual(taskArg.scope, TaskScope.Global, 'Should use global scope when no workspace');

            // Verify logging shows correct executable and args
            assert.ok(
                mockTraceInfo.calledWith(sinon.match(/Running as task: \/path\/to\/python --default-arg test\.py/)),
                'Should log execution with run args',
            );
        });

        test('should handle custom reveal option', async () => {
            // Mock - Test custom reveal option
            const environment: PythonEnvironment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                execInfo: {
                    run: {
                        executable: 'python',
                        args: [],
                    },
                },
                sysPrefix: '/path/to/env',
            };

            const options: PythonTaskExecutionOptions = {
                name: 'Reveal Task',
                args: ['script.py'],
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.returns(undefined);
            mockQuoteStringIfNecessary.withArgs('python').returns('python');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run with custom reveal option
            await runAsTask(environment, options, { reveal: TaskRevealKind.Always });

            // Assert
            const taskArg = mockExecuteTask.firstCall.args[0] as Task;
            assert.strictEqual(
                taskArg.presentationOptions?.reveal,
                TaskRevealKind.Always,
                'Should use custom reveal option',
            );
        });
    });

    suite('Edge Cases', () => {
        test('should handle environment without execInfo', async () => {
            // Mock - Environment with no execInfo
            const environment: PythonEnvironment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                sysPrefix: '/path/to/env',
            } as PythonEnvironment;

            const options: PythonTaskExecutionOptions = {
                name: 'No ExecInfo Task',
                args: ['script.py'],
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.returns(undefined);
            mockQuoteStringIfNecessary.withArgs('python').returns('python');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run
            const result = await runAsTask(environment, options);

            // Assert
            assert.strictEqual(result, mockTaskExecution, 'Should return the task execution result');

            // Verify fallback to 'python' and warning
            assert.ok(
                mockTraceWarn.calledWith('No Python executable found in environment; falling back to "python".'),
                'Should warn about missing executable',
            );
            assert.ok(
                mockTraceInfo.calledWith(sinon.match(/Running as task: python script\.py/)),
                'Should log with fallback executable',
            );
        });

        test('should handle environment with empty execInfo run args', async () => {
            // Mock - Environment with empty args
            const environment: PythonEnvironment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                execInfo: {
                    run: {
                        executable: '/path/to/python',
                        // No args provided
                    },
                },
                sysPrefix: '/path/to/env',
            };

            const options: PythonTaskExecutionOptions = {
                name: 'Empty Args Task',
                args: ['script.py', '--verbose'],
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.returns(undefined);
            mockQuoteStringIfNecessary.withArgs('/path/to/python').returns('/path/to/python');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run
            const result = await runAsTask(environment, options);

            // Assert
            assert.strictEqual(result, mockTaskExecution, 'Should return the task execution result');

            // Verify only option args are used
            assert.ok(
                mockTraceInfo.calledWith(sinon.match(/Running as task: \/path\/to\/python script\.py --verbose/)),
                'Should log with only option args',
            );
        });

        test('should handle options with no args', async () => {
            // Mock - Options with empty args
            const environment: PythonEnvironment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                execInfo: {
                    run: {
                        executable: 'python',
                        args: ['--version-check'],
                    },
                },
                sysPrefix: '/path/to/env',
            };

            const options: PythonTaskExecutionOptions = {
                name: 'No Args Task',
                args: [], // Empty args
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.returns(undefined);
            mockQuoteStringIfNecessary.withArgs('python').returns('python');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run
            const result = await runAsTask(environment, options);

            // Assert
            assert.strictEqual(result, mockTaskExecution, 'Should return the task execution result');

            // Verify only environment args are used
            assert.ok(
                mockTraceInfo.calledWith(sinon.match(/Running as task: python --version-check/)),
                'Should log with only environment args',
            );
        });

        test('should handle executable paths with spaces requiring quoting', async () => {
            // Mock - Executable path with spaces
            const environment: PythonEnvironment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                execInfo: {
                    run: {
                        executable: '/path with spaces/to/python',
                        args: [],
                    },
                },
                sysPrefix: '/path/to/env',
            };

            const options: PythonTaskExecutionOptions = {
                name: 'Spaced Path Task',
                args: ['script.py'],
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.returns(undefined);
            mockQuoteStringIfNecessary.withArgs('/path with spaces/to/python').returns('"/path with spaces/to/python"');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run
            const result = await runAsTask(environment, options);

            // Assert
            assert.strictEqual(result, mockTaskExecution, 'Should return the task execution result');

            // Verify quoting function is called
            assert.ok(
                mockQuoteStringIfNecessary.calledWith('/path with spaces/to/python'),
                'Should call quoting function for executable',
            );
            assert.ok(
                mockTraceInfo.calledWith(sinon.match(/Running as task: "\/path with spaces\/to\/python" script\.py/)),
                'Should log with quoted executable',
            );
        });
    });

    suite('Workspace Resolution', () => {
        test('should use workspace folder when project URI is provided', async () => {
            // Mock - Test workspace resolution
            const environment: PythonEnvironment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                execInfo: {
                    run: {
                        executable: 'python',
                        args: [],
                    },
                },
                sysPrefix: '/path/to/env',
            };

            const projectUri = Uri.file('/workspace/project');
            const options: PythonTaskExecutionOptions = {
                name: 'Workspace Task',
                args: ['script.py'],
                project: {
                    name: 'Test Project',
                    uri: projectUri,
                },
            };

            const mockWorkspaceFolder: WorkspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'Workspace',
                index: 0,
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.withArgs(projectUri).returns(mockWorkspaceFolder);
            mockQuoteStringIfNecessary.withArgs('python').returns('python');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run
            const result = await runAsTask(environment, options);

            // Assert
            assert.strictEqual(result, mockTaskExecution, 'Should return the task execution result');

            const taskArg = mockExecuteTask.firstCall.args[0] as Task;
            assert.strictEqual(taskArg.scope, mockWorkspaceFolder, 'Should use resolved workspace folder as scope');

            // Verify workspace lookup was called correctly
            assert.ok(
                mockGetWorkspaceFolder.calledWith(projectUri),
                'Should look up workspace folder with project URI',
            );
        });

        test('should use global scope when no workspace folder found', async () => {
            // Mock - No workspace folder found
            const environment: PythonEnvironment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                execInfo: {
                    run: {
                        executable: 'python',
                        args: [],
                    },
                },
                sysPrefix: '/path/to/env',
            };

            const options: PythonTaskExecutionOptions = {
                name: 'Global Task',
                args: ['script.py'],
                project: {
                    name: 'Test Project',
                    uri: Uri.file('/non-workspace/project'),
                },
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.returns(undefined);
            mockQuoteStringIfNecessary.withArgs('python').returns('python');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run
            const result = await runAsTask(environment, options);

            // Assert
            assert.strictEqual(result, mockTaskExecution, 'Should return the task execution result');

            const taskArg = mockExecuteTask.firstCall.args[0] as Task;
            assert.strictEqual(
                taskArg.scope,
                TaskScope.Global,
                'Should fallback to global scope when workspace not found',
            );
        });
    });

    suite('Task Configuration', () => {
        test('should correctly combine environment and option args', async () => {
            // Mock - Test arg combination
            const environment: PythonEnvironment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                execInfo: {
                    activatedRun: {
                        executable: 'python',
                        args: ['--env-arg1', '--env-arg2'],
                    },
                    run: {
                        executable: 'fallback-python',
                        args: ['--fallback'],
                    },
                },
                sysPrefix: '/path/to/env',
            };

            const options: PythonTaskExecutionOptions = {
                name: 'Combined Args Task',
                args: ['--opt-arg1', 'script.py', '--opt-arg2'],
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.returns(undefined);
            mockQuoteStringIfNecessary.withArgs('python').returns('python');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run
            const result = await runAsTask(environment, options);

            // Assert
            assert.strictEqual(result, mockTaskExecution, 'Should return the task execution result');

            // Verify args are combined correctly (environment args first, then option args)
            assert.ok(
                mockTraceInfo.calledWith(
                    sinon.match(/Running as task: python --env-arg1 --env-arg2 --opt-arg1 script\.py --opt-arg2/),
                ),
                'Should log with combined args in correct order',
            );
        });

        test('should pass through cwd and env options to shell execution', async () => {
            // Mock - Test shell execution options
            const environment: PythonEnvironment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                execInfo: {
                    run: {
                        executable: 'python',
                        args: [],
                    },
                },
                sysPrefix: '/path/to/env',
            };

            const options: PythonTaskExecutionOptions = {
                name: 'Shell Options Task',
                args: ['script.py'],
                cwd: '/custom/working/dir',
                env: {
                    CUSTOM_VAR: 'custom_value',
                    PATH: '/custom/path',
                },
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.returns(undefined);
            mockQuoteStringIfNecessary.withArgs('python').returns('python');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run
            const result = await runAsTask(environment, options);

            // Assert
            assert.strictEqual(result, mockTaskExecution, 'Should return the task execution result');

            const taskArg = mockExecuteTask.firstCall.args[0] as Task;

            // Verify shell execution was created with correct options
            // Note: We can't easily inspect ShellExecution internals, but we can verify the task was created
            assert.ok(taskArg.execution, 'Task should have execution configured');
            assert.strictEqual(taskArg.name, 'Shell Options Task', 'Task should have correct name');
        });
    });

    suite('Error Scenarios', () => {
        test('should propagate task execution failures', async () => {
            // Mock - Task execution failure
            const environment: PythonEnvironment = {
                envId: { id: 'test-env', managerId: 'test-manager' },
                name: 'Test Environment',
                displayName: 'Test Environment',
                displayPath: '/path/to/env',
                version: '3.9.0',
                environmentPath: Uri.file('/path/to/env'),
                execInfo: {
                    run: {
                        executable: 'python',
                        args: [],
                    },
                },
                sysPrefix: '/path/to/env',
            };

            const options: PythonTaskExecutionOptions = {
                name: 'Failing Task',
                args: ['script.py'],
            };

            const executionError = new Error('Task execution failed');

            mockGetWorkspaceFolder.returns(undefined);
            mockQuoteStringIfNecessary.withArgs('python').returns('python');
            mockExecuteTask.rejects(executionError);

            // Run & Assert
            await assert.rejects(
                () => runAsTask(environment, options),
                executionError,
                'Should propagate task execution error',
            );

            // Verify logging still occurred before failure
            assert.ok(
                mockTraceInfo.calledWith(sinon.match(/Running as task: python script\.py/)),
                'Should log before execution attempt',
            );
        });
    });

    suite('Integration Scenarios', () => {
        test('should work with minimal environment and options', async () => {
            // Mock - Minimal valid configuration
            const environment: PythonEnvironment = {
                envId: { id: 'minimal-env', managerId: 'minimal-manager' },
                name: 'Minimal Environment',
                displayName: 'Minimal Environment',
                displayPath: '/minimal/env',
                version: '3.8.0',
                environmentPath: Uri.file('/minimal/env'),
                sysPrefix: '/minimal/env',
                // No execInfo - should fallback to 'python'
            } as PythonEnvironment;

            const options: PythonTaskExecutionOptions = {
                name: 'Minimal Task',
                args: ['hello.py'],
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.returns(undefined);
            mockQuoteStringIfNecessary.withArgs('python').returns('python');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run
            const result = await runAsTask(environment, options);

            // Assert
            assert.strictEqual(result, mockTaskExecution, 'Should successfully execute with minimal configuration');
            assert.ok(mockTraceWarn.calledOnce, 'Should warn about missing executable');
            assert.ok(
                mockTraceInfo.calledWith(sinon.match(/Running as task: python hello\.py/)),
                'Should log with fallback executable',
            );
        });

        test('should handle complex real-world scenario', async () => {
            // Mock - Complex real-world environment
            const environment: PythonEnvironment = {
                envId: { id: 'venv-1', managerId: 'virtualenv' },
                name: 'Project Virtual Environment',
                displayName: 'myproject-venv (Python 3.11.0)',
                shortDisplayName: 'myproject-venv',
                displayPath: '~/projects/myproject/.venv',
                version: '3.11.0',
                environmentPath: Uri.file('/Users/user/projects/myproject/.venv'),
                description: 'Virtual environment for myproject',
                execInfo: {
                    run: {
                        executable: '/Users/user/projects/myproject/.venv/bin/python',
                        args: [],
                    },
                    activatedRun: {
                        executable: '/Users/user/projects/myproject/.venv/bin/python',
                        args: ['-m', 'site'],
                    },
                    activation: [
                        {
                            executable: 'source',
                            args: ['/Users/user/projects/myproject/.venv/bin/activate'],
                        },
                    ],
                },
                sysPrefix: '/Users/user/projects/myproject/.venv',
                group: 'Virtual Environments',
            };

            const options: PythonTaskExecutionOptions = {
                name: 'Run Tests',
                args: ['-m', 'pytest', 'tests/', '-v', '--tb=short'],
                project: {
                    name: 'MyProject',
                    uri: Uri.file('/Users/user/projects/myproject'),
                    description: 'My Python Project',
                },
                cwd: '/Users/user/projects/myproject',
                env: {
                    PYTHONPATH: '/Users/user/projects/myproject/src',
                    TEST_ENV: 'development',
                },
            };

            const mockWorkspaceFolder: WorkspaceFolder = {
                uri: Uri.file('/Users/user/projects'),
                name: 'Projects',
                index: 0,
            };

            const mockTaskExecution = {} as TaskExecution;

            mockGetWorkspaceFolder.withArgs(options.project?.uri).returns(mockWorkspaceFolder);
            mockQuoteStringIfNecessary
                .withArgs('/Users/user/projects/myproject/.venv/bin/python')
                .returns('/Users/user/projects/myproject/.venv/bin/python');
            mockExecuteTask.resolves(mockTaskExecution);

            // Run
            const result = await runAsTask(environment, options, { reveal: TaskRevealKind.Always });

            // Assert
            assert.strictEqual(result, mockTaskExecution, 'Should handle complex real-world scenario');

            const taskArg = mockExecuteTask.firstCall.args[0] as Task;
            assert.strictEqual(taskArg.name, 'Run Tests', 'Should use correct task name');
            assert.strictEqual(taskArg.scope, mockWorkspaceFolder, 'Should use correct workspace scope');
            assert.strictEqual(
                taskArg.presentationOptions?.reveal,
                TaskRevealKind.Always,
                'Should use custom reveal setting',
            );

            // Verify complex args are logged correctly
            assert.ok(
                mockTraceInfo.calledWith(
                    sinon.match(
                        /Running as task: \/Users\/user\/projects\/myproject\/\.venv\/bin\/python -m site -m pytest tests\/ -v --tb=short/,
                    ),
                ),
                'Should log complex command with all args',
            );

            // Verify no warnings for complete environment
            assert.ok(mockTraceWarn.notCalled, 'Should not warn for complete environment configuration');
        });
    });
});
