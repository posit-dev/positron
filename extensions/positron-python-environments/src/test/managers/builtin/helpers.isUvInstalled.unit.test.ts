import assert from 'assert';
import * as sinon from 'sinon';
import { LogOutputChannel } from 'vscode';
import * as childProcessApis from '../../../common/childProcess.apis';
import { EventNames } from '../../../common/telemetry/constants';
import * as telemetrySender from '../../../common/telemetry/sender';
import { isUvInstalled, resetUvInstallationCache } from '../../../managers/builtin/helpers';
import { createMockLogOutputChannel } from '../../mocks/helper';
import { MockChildProcess } from '../../mocks/mockChildProcess';

suite('Helpers - isUvInstalled', () => {
    let mockLog: LogOutputChannel;
    let spawnStub: sinon.SinonStub;
    let sendTelemetryEventStub: sinon.SinonStub;

    setup(() => {
        // Reset UV installation cache before each test to ensure clean state
        resetUvInstallationCache();

        mockLog = createMockLogOutputChannel();

        // Stub childProcess.apis spawnProcess
        spawnStub = sinon.stub(childProcessApis, 'spawnProcess');

        // Stub telemetry
        sendTelemetryEventStub = sinon.stub(telemetrySender, 'sendTelemetryEvent');
    });

    teardown(() => {
        sinon.restore();
    });

    test('should return true when uv --version succeeds', async () => {
        // Arrange - Create mock process that simulates successful uv --version
        const mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        // Act - Call isUvInstalled and simulate successful process
        const resultPromise = isUvInstalled(mockLog);

        // Simulate successful uv --version command
        setTimeout(() => {
            mockProcess.stdout?.emit('data', 'uv 0.1.0\n');
            mockProcess.emit('exit', 0, null);
        }, 10);

        const result = await resultPromise;

        // Assert
        assert.strictEqual(result, true);
        assert(
            sendTelemetryEventStub.calledWith(EventNames.VENV_USING_UV),
            'Should send telemetry event when UV is available',
        );
        assert(spawnStub.calledWith('uv', ['--version']), 'Should spawn uv --version command');
    });

    test('should return false when uv --version fails with non-zero exit code', async () => {
        // Arrange - Create mock process that simulates failed uv --version
        const mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        // Act - Call isUvInstalled and simulate failed process
        const resultPromise = isUvInstalled(mockLog);

        // Simulate failed uv --version command
        setTimeout(() => {
            mockProcess.emit('exit', 1, null);
        }, 10);

        const result = await resultPromise;

        // Assert
        assert.strictEqual(result, false);
        assert(sendTelemetryEventStub.notCalled, 'Should not send telemetry event when UV is not available');
        assert(spawnStub.calledWith('uv', ['--version']), 'Should spawn uv --version command');
    });

    test('should return false when uv command is not found (error event)', async () => {
        // Arrange - Create mock process that simulates command not found
        const mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        // Act - Call isUvInstalled and simulate error (command not found)
        const resultPromise = isUvInstalled(mockLog);

        // Simulate error event (e.g., command not found)
        setTimeout(() => {
            mockProcess.emit('error', new Error('spawn uv ENOENT'));
        }, 10);

        const result = await resultPromise;

        // Assert
        assert.strictEqual(result, false);
        assert(sendTelemetryEventStub.notCalled, 'Should not send telemetry event when UV command is not found');
        assert(spawnStub.calledWith('uv', ['--version']), 'Should spawn uv --version command');
    });

    test('should log uv --version command when logger provided', async () => {
        // Arrange - Create mock process
        const mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        // Act - Call isUvInstalled with logger
        const resultPromise = isUvInstalled(mockLog);

        // Simulate successful command with output
        setTimeout(() => {
            mockProcess.stdout?.emit('data', 'uv 0.1.0\n');
            mockProcess.emit('exit', 0, null);
        }, 10);

        await resultPromise;

        // Assert
        assert(
            (mockLog.info as sinon.SinonStub).calledWith('Running: uv --version'),
            'Should log the command being run',
        );
        assert((mockLog.info as sinon.SinonStub).calledWith('uv 0.1.0\n'), 'Should log the command output');
    });

    test('should work without logger', async () => {
        // Arrange - Create mock process
        const mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        // Act - Call isUvInstalled without logger
        const resultPromise = isUvInstalled();

        // Simulate successful command
        setTimeout(() => {
            mockProcess.stdout?.emit('data', 'uv 0.1.0\n');
            mockProcess.emit('exit', 0, null);
        }, 10);

        const result = await resultPromise;

        // Assert
        assert.strictEqual(result, true);
        assert(spawnStub.calledWith('uv', ['--version']), 'Should spawn uv --version command even without logger');
    });

    test('should return cached result on subsequent calls', async () => {
        // Arrange - Create mock process for first call
        const mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        // Act - First call
        const firstCallPromise = isUvInstalled(mockLog);

        // Simulate successful command
        setTimeout(() => {
            mockProcess.stdout?.emit('data', 'uv 0.1.0\n');
            mockProcess.emit('exit', 0, null);
        }, 10);

        const firstResult = await firstCallPromise;

        // Act - Second call (should use cached result)
        const secondResult = await isUvInstalled(mockLog);

        // Assert
        assert.strictEqual(firstResult, true);
        assert.strictEqual(secondResult, true);
        assert(spawnStub.calledOnce, 'Should only spawn process once, second call should use cached result');
    });

    test('should check uv installation again after cache reset', async () => {
        // Arrange - First call
        let mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        const firstCallPromise = isUvInstalled(mockLog);
        setTimeout(() => {
            mockProcess.stdout?.emit('data', 'uv 0.1.0\n');
            mockProcess.emit('exit', 0, null);
        }, 10);

        const firstResult = await firstCallPromise;

        // Act - Reset cache
        resetUvInstallationCache();

        // Arrange - Second call after reset
        mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        const secondCallPromise = isUvInstalled(mockLog);
        setTimeout(() => {
            mockProcess.emit('exit', 1, null); // Simulate failure this time
        }, 10);

        const secondResult = await secondCallPromise;

        // Assert
        assert.strictEqual(firstResult, true);
        assert.strictEqual(secondResult, false);
        assert(spawnStub.calledTwice, 'Should spawn process twice after cache reset');
    });
});
