import assert from 'assert';
import * as sinon from 'sinon';
import { CancellationError, CancellationTokenSource, LogOutputChannel } from 'vscode';
import * as childProcessApis from '../../../common/childProcess.apis';
import { runUV } from '../../../managers/builtin/helpers';
import { createMockLogOutputChannel } from '../../mocks/helper';
import { MockChildProcess } from '../../mocks/mockChildProcess';

suite('Helpers - runUV', () => {
    let mockLog: LogOutputChannel;
    let spawnStub: sinon.SinonStub;

    setup(() => {
        mockLog = createMockLogOutputChannel();
        spawnStub = sinon.stub(childProcessApis, 'spawnProcess');
    });

    teardown(() => {
        sinon.restore();
    });

    test('should resolve with stdout when command succeeds', async () => {
        const mockProcess = new MockChildProcess('uv', ['pip', 'list']);
        spawnStub.withArgs('uv', ['pip', 'list']).returns(mockProcess);

        const resultPromise = runUV(['pip', 'list'], undefined, mockLog);

        setTimeout(() => {
            mockProcess.stdout?.emit('data', Buffer.from('package1==1.0.0\n'));
            mockProcess.stdout?.emit('data', Buffer.from('package2==2.0.0\n'));
            mockProcess.emit('exit', 0, null);
            (mockProcess as unknown as { emit: (event: string) => void }).emit('close');
        }, 10);

        const result = await resultPromise;

        assert.strictEqual(result, 'package1==1.0.0\npackage2==2.0.0\n');
    });

    test('should reject when command exits with non-zero code', async () => {
        const mockProcess = new MockChildProcess('uv', ['pip', 'install', 'nonexistent']);
        spawnStub.withArgs('uv', ['pip', 'install', 'nonexistent']).returns(mockProcess);

        const resultPromise = runUV(['pip', 'install', 'nonexistent'], undefined, mockLog);

        setTimeout(() => {
            mockProcess.stderr?.emit('data', Buffer.from('error: package not found\n'));
            mockProcess.emit('exit', 1, null);
        }, 10);

        await assert.rejects(resultPromise, Error);
    });

    test('should reject when process spawn fails', async () => {
        const mockProcess = new MockChildProcess('uv', ['pip', 'list']);
        spawnStub.withArgs('uv', ['pip', 'list']).returns(mockProcess);

        const resultPromise = runUV(['pip', 'list'], undefined, mockLog);

        setTimeout(() => {
            mockProcess.emit('error', new Error('spawn uv ENOENT'));
        }, 10);

        await assert.rejects(resultPromise, Error);
    });

    test('should handle cancellation token', async () => {
        const mockProcess = new MockChildProcess('uv', ['venv', 'create']);
        spawnStub.withArgs('uv', ['venv', 'create']).returns(mockProcess);

        const tokenSource = new CancellationTokenSource();
        const resultPromise = runUV(['venv', 'create'], undefined, mockLog, tokenSource.token);

        setTimeout(() => {
            tokenSource.cancel();
        }, 10);

        await assert.rejects(resultPromise, (err: Error) => {
            assert.ok(err instanceof CancellationError);
            return true;
        });
    });

    test('should use provided working directory', async () => {
        const mockProcess = new MockChildProcess('uv', ['pip', 'list']);
        const cwd = '/test/directory';
        spawnStub.withArgs('uv', ['pip', 'list'], { cwd }).returns(mockProcess);

        const resultPromise = runUV(['pip', 'list'], cwd, mockLog);

        setTimeout(() => {
            mockProcess.stdout?.emit('data', Buffer.from('output\n'));
            mockProcess.emit('exit', 0, null);
            (mockProcess as unknown as { emit: (event: string) => void }).emit('close');
        }, 10);

        await resultPromise;

        assert.ok(spawnStub.calledWith('uv', ['pip', 'list'], { cwd }));
    });

    test('should work without logger', async () => {
        const mockProcess = new MockChildProcess('uv', ['--version']);
        spawnStub.withArgs('uv', ['--version']).returns(mockProcess);

        const resultPromise = runUV(['--version']);

        setTimeout(() => {
            mockProcess.stdout?.emit('data', Buffer.from('uv 0.1.0\n'));
            mockProcess.emit('exit', 0, null);
            (mockProcess as unknown as { emit: (event: string) => void }).emit('close');
        }, 10);

        const result = await resultPromise;

        assert.strictEqual(result, 'uv 0.1.0\n');
    });

    test('should concatenate multiple stdout chunks correctly', async () => {
        const mockProcess = new MockChildProcess('uv', ['pip', 'list']);
        spawnStub.withArgs('uv', ['pip', 'list']).returns(mockProcess);

        const resultPromise = runUV(['pip', 'list'], undefined, mockLog);

        setTimeout(() => {
            mockProcess.stdout?.emit('data', Buffer.from('line1\n'));
            mockProcess.stdout?.emit('data', Buffer.from('line2\n'));
            mockProcess.stdout?.emit('data', Buffer.from('line3\n'));
            mockProcess.emit('exit', 0, null);
            (mockProcess as unknown as { emit: (event: string) => void }).emit('close');
        }, 10);

        const result = await resultPromise;

        assert.strictEqual(result, 'line1\nline2\nline3\n');
    });
});
