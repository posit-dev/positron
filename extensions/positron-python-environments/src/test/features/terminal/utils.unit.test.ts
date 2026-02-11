import * as assert from 'assert';
import * as sinon from 'sinon';
import * as workspaceApis from '../../../common/workspace.apis';
import {
    ACT_TYPE_COMMAND,
    ACT_TYPE_OFF,
    ACT_TYPE_SHELL,
    AutoActivationType,
    getAutoActivationType,
} from '../../../features/terminal/utils';

interface MockWorkspaceConfig {
    get: sinon.SinonStub;
    inspect: sinon.SinonStub;
    update: sinon.SinonStub;
}

suite('Terminal Utils - getAutoActivationType', () => {
    let mockGetConfiguration: sinon.SinonStub;
    let pyEnvsConfig: MockWorkspaceConfig;
    let pythonConfig: MockWorkspaceConfig;

    setup(() => {
        // Initialize mocks
        mockGetConfiguration = sinon.stub(workspaceApis, 'getConfiguration');

        // Create mock configuration objects
        pyEnvsConfig = {
            get: sinon.stub(),
            inspect: sinon.stub(),
            update: sinon.stub(),
        };

        pythonConfig = {
            get: sinon.stub(),
            inspect: sinon.stub(),
            update: sinon.stub(),
        };

        // Set up default configuration returns
        mockGetConfiguration.withArgs('python-envs').returns(pyEnvsConfig);
        mockGetConfiguration.withArgs('python').returns(pythonConfig);
    });

    teardown(() => {
        sinon.restore();
    });

    suite('Priority Order Tests', () => {
        test('should return globalRemoteValue when set (highest priority)', () => {
            // Mock - globalRemoteValue is set
            const mockInspectResult = {
                globalRemoteValue: ACT_TYPE_SHELL,
                globalLocalValue: ACT_TYPE_COMMAND,
                globalValue: ACT_TYPE_OFF,
            };
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(mockInspectResult);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(result, ACT_TYPE_SHELL, 'Should return globalRemoteValue when set');
        });

        test('should return globalLocalValue when globalRemoteValue is undefined', () => {
            // Mock - globalRemoteValue is undefined, globalLocalValue is set
            const mockInspectResult = {
                globalRemoteValue: undefined,
                globalLocalValue: ACT_TYPE_SHELL,
                globalValue: ACT_TYPE_OFF,
            };
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(mockInspectResult);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(
                result,
                ACT_TYPE_SHELL,
                'Should return globalLocalValue when globalRemoteValue is undefined',
            );
        });

        test('should return globalValue when both globalRemoteValue and globalLocalValue are undefined', () => {
            // Mock - only globalValue is set
            const mockInspectResult = {
                globalRemoteValue: undefined,
                globalLocalValue: undefined,
                globalValue: ACT_TYPE_OFF,
            };
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(mockInspectResult);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(
                result,
                ACT_TYPE_OFF,
                'Should return globalValue when higher priority values are undefined',
            );
        });

        test('should ignore globalLocalValue and globalValue when globalRemoteValue exists', () => {
            // Mock - all values set, should prioritize globalRemoteValue
            const mockInspectResult = {
                globalRemoteValue: ACT_TYPE_OFF,
                globalLocalValue: ACT_TYPE_SHELL,
                globalValue: ACT_TYPE_COMMAND,
            };
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(mockInspectResult);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(result, ACT_TYPE_OFF, 'Should prioritize globalRemoteValue over other values');
        });

        test('should ignore globalValue when globalLocalValue exists', () => {
            // Mock - globalLocalValue and globalValue set, should prioritize globalLocalValue
            const mockInspectResult = {
                globalLocalValue: ACT_TYPE_SHELL,
                globalValue: ACT_TYPE_COMMAND,
            };
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(mockInspectResult);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(result, ACT_TYPE_SHELL, 'Should prioritize globalLocalValue over globalValue');
        });
    });

    suite('Custom Properties Handling', () => {
        test('should handle case when globalRemoteValue property does not exist', () => {
            // Mock - standard VS Code inspection result without custom properties
            const mockInspectResult = {
                key: 'terminal.autoActivationType',
                globalValue: ACT_TYPE_SHELL,
            };
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(mockInspectResult);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(result, ACT_TYPE_SHELL, 'Should return globalValue when custom properties do not exist');
        });

        test('should handle case when globalLocalValue property does not exist', () => {
            // Mock - inspection result without globalLocalValue property
            const mockInspectResult = {
                key: 'terminal.autoActivationType',
                globalValue: ACT_TYPE_COMMAND,
            };
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(mockInspectResult);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(
                result,
                ACT_TYPE_COMMAND,
                'Should return globalValue when globalLocalValue property does not exist',
            );
        });

        test('should handle case when custom properties exist but are undefined', () => {
            // Mock - custom properties exist but have undefined values
            const mockInspectResult = {
                globalRemoteValue: undefined,
                globalLocalValue: undefined,
                globalValue: ACT_TYPE_OFF,
            };
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(mockInspectResult);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(
                result,
                ACT_TYPE_OFF,
                'Should fall back to globalValue when custom properties are undefined',
            );
        });
    });

    suite('Legacy Python Setting Fallback', () => {
        test('should return ACT_TYPE_OFF and update config when python.terminal.activateEnvironment is false', () => {
            // Mock - no python-envs settings, python.terminal.activateEnvironment is false
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(undefined);
            pythonConfig.get.withArgs('terminal.activateEnvironment', undefined).returns(false);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(result, ACT_TYPE_OFF, 'Should return ACT_TYPE_OFF when legacy setting is false');
            assert.ok(
                pyEnvsConfig.update.calledWithExactly('terminal.autoActivationType', ACT_TYPE_OFF),
                'Should update python-envs config to ACT_TYPE_OFF',
            );
        });

        test('should return ACT_TYPE_COMMAND when python.terminal.activateEnvironment is true', () => {
            // Mock - no python-envs settings, python.terminal.activateEnvironment is true
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(undefined);
            pythonConfig.get.withArgs('terminal.activateEnvironment', undefined).returns(true);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(result, ACT_TYPE_COMMAND, 'Should return ACT_TYPE_COMMAND when legacy setting is true');
            assert.ok(
                pyEnvsConfig.update.notCalled,
                'Should not update python-envs config when legacy setting is true',
            );
        });

        test('should return ACT_TYPE_COMMAND when python.terminal.activateEnvironment is undefined', () => {
            // Mock - no python-envs settings, python.terminal.activateEnvironment is undefined
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(undefined);
            pythonConfig.get.withArgs('terminal.activateEnvironment', undefined).returns(undefined);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(result, ACT_TYPE_COMMAND, 'Should return ACT_TYPE_COMMAND when no settings are found');
            assert.ok(
                pyEnvsConfig.update.notCalled,
                'Should not update python-envs config when no legacy setting exists',
            );
        });
    });

    suite('Fallback Scenarios', () => {
        test('should return ACT_TYPE_COMMAND when no configuration exists', () => {
            // Mock - no configurations exist
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(undefined);
            pythonConfig.get.withArgs('terminal.activateEnvironment', undefined).returns(undefined);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(
                result,
                ACT_TYPE_COMMAND,
                'Should return default ACT_TYPE_COMMAND when no configurations exist',
            );
        });

        test('should return ACT_TYPE_COMMAND when python-envs config exists but all values are undefined', () => {
            // Mock - python-envs config exists but all relevant values are undefined
            const mockInspectResult = {
                key: 'terminal.autoActivationType',
                globalValue: undefined,
                workspaceValue: undefined,
                workspaceFolderValue: undefined,
            };
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(mockInspectResult);
            pythonConfig.get.withArgs('terminal.activateEnvironment', undefined).returns(undefined);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(
                result,
                ACT_TYPE_COMMAND,
                'Should return default when python-envs config exists but values are undefined',
            );
        });

        test('should prioritize python-envs settings over legacy python settings', () => {
            // Mock - python-envs has globalValue, python has conflicting setting
            const mockInspectResult = {
                globalValue: ACT_TYPE_SHELL,
            };
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(mockInspectResult);
            pythonConfig.get.withArgs('terminal.activateEnvironment', undefined).returns(false);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(
                result,
                ACT_TYPE_SHELL,
                'Should prioritize python-envs globalValue over legacy python setting',
            );
            assert.ok(
                pyEnvsConfig.update.notCalled,
                'Should not update python-envs config when it already has a value',
            );
        });
    });

    suite('Edge Cases', () => {
        test('should handle null inspect result', () => {
            // Mock - inspect returns null
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(null);
            pythonConfig.get.withArgs('terminal.activateEnvironment', undefined).returns(undefined);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(result, ACT_TYPE_COMMAND, 'Should handle null inspect result gracefully');
        });

        test('should handle empty object inspect result', () => {
            // Mock - inspect returns empty object
            pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns({});
            pythonConfig.get.withArgs('terminal.activateEnvironment', undefined).returns(undefined);

            // Run
            const result = getAutoActivationType();

            // Assert
            assert.strictEqual(result, ACT_TYPE_COMMAND, 'Should handle empty inspect result gracefully');
        });

        test('should handle all AutoActivationType values correctly', () => {
            const testCases: { input: AutoActivationType; expected: AutoActivationType }[] = [
                { input: ACT_TYPE_COMMAND, expected: ACT_TYPE_COMMAND },
                { input: ACT_TYPE_SHELL, expected: ACT_TYPE_SHELL },
                { input: ACT_TYPE_OFF, expected: ACT_TYPE_OFF },
            ];

            testCases.forEach(({ input, expected }) => {
                // Reset stubs for each test case
                pyEnvsConfig.inspect.resetHistory();
                pythonConfig.get.resetHistory();

                // Mock - set globalValue to test input
                const mockInspectResult = { globalValue: input };
                pyEnvsConfig.inspect.withArgs('terminal.autoActivationType').returns(mockInspectResult);

                // Run
                const result = getAutoActivationType();

                // Assert
                assert.strictEqual(result, expected, `Should handle ${input} value correctly`);
            });
        });
    });
});
