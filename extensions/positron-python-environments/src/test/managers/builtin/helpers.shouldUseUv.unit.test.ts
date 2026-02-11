import assert from 'assert';
import * as sinon from 'sinon';
import { LogOutputChannel } from 'vscode';
import * as childProcessApis from '../../../common/childProcess.apis';
import * as persistentState from '../../../common/persistentState';
import * as workspaceApis from '../../../common/workspace.apis';
import { resetUvInstallationCache, shouldUseUv } from '../../../managers/builtin/helpers';
import * as uvEnvironments from '../../../managers/builtin/uvEnvironments';
import { createMockLogOutputChannel } from '../../mocks/helper';
import { MockChildProcess } from '../../mocks/mockChildProcess';

interface MockWorkspaceConfig {
    get: sinon.SinonStub;
    inspect: sinon.SinonStub;
    update: sinon.SinonStub;
}

suite('Helpers - shouldUseUv', () => {
    let mockGetConfiguration: sinon.SinonStub;
    let mockConfig: MockWorkspaceConfig;
    let mockLog: LogOutputChannel;
    let getWorkspacePersistentStateStub: sinon.SinonStub;
    let mockPersistentState: { get: sinon.SinonStub; set: sinon.SinonStub; clear: sinon.SinonStub };
    let getUvEnvironmentsStub: sinon.SinonStub;
    let spawnStub: sinon.SinonStub;

    setup(() => {
        // Reset UV installation cache before each test to ensure clean state
        resetUvInstallationCache();

        mockGetConfiguration = sinon.stub(workspaceApis, 'getConfiguration');
        mockConfig = {
            get: sinon.stub(),
            inspect: sinon.stub(),
            update: sinon.stub(),
        };
        mockGetConfiguration.withArgs('python-envs').returns(mockConfig);

        // Mock persistent state
        getWorkspacePersistentStateStub = sinon.stub(persistentState, 'getWorkspacePersistentState');
        mockPersistentState = {
            get: sinon.stub(),
            set: sinon.stub(),
            clear: sinon.stub(),
        };
        getWorkspacePersistentStateStub.returns(Promise.resolve(mockPersistentState));

        // Mock UV-related functions
        getUvEnvironmentsStub = sinon.stub(uvEnvironments, 'getUvEnvironments');

        mockLog = createMockLogOutputChannel();

        // Stub childProcess.apis spawnProcess
        spawnStub = sinon.stub(childProcessApis, 'spawnProcess');
    });

    teardown(() => {
        sinon.restore();
    });

    test('should return true when alwaysUseUv is true and UV is installed', async () => {
        // Mock - alwaysUseUv is true and UV is installed
        const mockInspectResult = {
            globalRemoteValue: true,
            globalLocalValue: true,
            globalValue: true,
        };

        mockConfig.get.withArgs('alwaysUseUv', true).returns(true);
        mockConfig.get.withArgs('alwaysUseUv').returns(true);
        mockConfig.inspect.withArgs('alwaysUseUv').returns(mockInspectResult);

        getUvEnvironmentsStub.resolves([]);

        // Arrange - Create mock process that simulates successful uv --version
        const mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        // Run - Call function and set up mock events in parallel
        const resultPromise = shouldUseUv(mockLog);

        // Simulate successful uv --version command
        setTimeout(() => {
            mockProcess.stdout?.emit('data', 'uv 0.1.0\n');
            mockProcess.emit('exit', 0, null);
        }, 10);

        const result = await resultPromise;

        // Assert - Should return true when setting is true and UV is installed
        assert.strictEqual(result, true);
    });

    test('should return false when alwaysUseUv is false', async () => {
        // Mock - alwaysUseUv is false
        mockConfig.get.withArgs('alwaysUseUv', true).returns(false);
        getUvEnvironmentsStub.resolves([]);

        // Run
        const result = await shouldUseUv(mockLog);

        // Assert - Should not use UV when setting is false
        assert.strictEqual(result, false);
    });

    test('should return true for UV environment path when UV is installed', async () => {
        // Mock - UV environments list with test path and UV is installed
        const uvEnvPath = '/path/to/uv/env';
        getUvEnvironmentsStub.resolves([uvEnvPath]);
        mockConfig.get.withArgs('alwaysUseUv', true).returns(false);

        // Arrange - Create mock process that simulates successful uv --version
        const mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        // Run - Call function and set up mock events in parallel
        const resultPromise = shouldUseUv(mockLog, uvEnvPath);

        // Simulate successful uv --version command
        setTimeout(() => {
            mockProcess.stdout?.emit('data', 'uv 0.1.0\n');
            mockProcess.emit('exit', 0, null);
        }, 10);

        const result = await resultPromise;

        // Assert - Should return true for UV environments when UV is installed
        assert.strictEqual(result, true);
    });

    test('should return false for non-UV environment when alwaysUseUv is false', async () => {
        // Mock - Non-UV environment, alwaysUseUv is false
        const nonUvEnvPath = '/path/to/regular/env';
        mockConfig.get.withArgs('alwaysUseUv', true).returns(false);
        getUvEnvironmentsStub.resolves([]);

        // Run
        const result = await shouldUseUv(mockLog, nonUvEnvPath);

        // Assert - Should not use UV for non-UV environments when setting is false
        assert.strictEqual(result, false);
    });

    test('should check setting when alwaysUseUv is true for non-UV environment', async () => {
        // Mock - Non-UV environment, alwaysUseUv is true, UV is installed
        const nonUvEnvPath = '/path/to/regular/env';
        mockConfig.get.withArgs('alwaysUseUv', true).returns(true);
        getUvEnvironmentsStub.resolves([]);

        // Arrange - Create mock process that simulates successful uv --version
        const mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        // Run - Call function and set up mock events in parallel
        const resultPromise = shouldUseUv(mockLog, nonUvEnvPath);

        // Simulate successful uv --version command
        setTimeout(() => {
            mockProcess.stdout?.emit('data', 'uv 0.1.0\n');
            mockProcess.emit('exit', 0, null);
        }, 10);

        const result = await resultPromise;

        // Assert - Should return true when alwaysUseUv is true and UV is installed
        assert.strictEqual(result, true);
    });

    test('should use default value true when alwaysUseUv setting is not configured', async () => {
        // Mock - Setting not configured, should use default of true, UV is installed
        mockConfig.get.withArgs('alwaysUseUv', true).returns(true);
        getUvEnvironmentsStub.resolves([]);

        // Arrange - Create mock process that simulates successful uv --version
        const mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        // Run - Call function and set up mock events in parallel
        const resultPromise = shouldUseUv(mockLog);

        // Simulate successful uv --version command
        setTimeout(() => {
            mockProcess.stdout?.emit('data', 'uv 0.1.0\n');
            mockProcess.emit('exit', 0, null);
        }, 10);

        const result = await resultPromise;

        // Assert - Should return true with default setting when UV is installed
        assert.strictEqual(result, true);
    });

    test('should respect alwaysUseUv setting when no environment path provided', async () => {
        // Mock - No environment path specified, alwaysUseUv is false
        mockConfig.get.withArgs('alwaysUseUv', true).returns(false);
        getUvEnvironmentsStub.resolves([]);

        // Run
        const result = await shouldUseUv(mockLog);

        // Assert - Should not use UV when setting is false
        assert.strictEqual(result, false);
    });
});
