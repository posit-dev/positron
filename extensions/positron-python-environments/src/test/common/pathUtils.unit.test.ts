import assert from 'node:assert';
import * as sinon from 'sinon';
import { Uri } from 'vscode';
import { getResourceUri, normalizePath } from '../../common/utils/pathUtils';
import * as utils from '../../common/utils/platformUtils';

suite('Path Utilities', () => {
    suite('getResourceUri', () => {
        const testRoot = process.cwd();

        test('returns undefined when path is empty', () => {
            const result = getResourceUri('', testRoot);
            assert.strictEqual(result, undefined);
        });

        test('returns undefined when path is undefined', () => {
            // @ts-ignore: Testing with undefined even though the type doesn't allow it
            const result = getResourceUri(undefined, testRoot);
            assert.strictEqual(result, undefined);
        });
        test('creates file URI from normal file path', () => {
            const testPath = '/path/to/file.txt';
            const result = getResourceUri(testPath, testRoot);

            assert.ok(result instanceof Uri);
            assert.strictEqual(result?.scheme, 'file');
            assert.strictEqual(result?.path, testPath);
        });

        test('creates file URI from Windows path', function () {
            if (!utils.isWindows()) {
                this.skip();
            }
            const testPath = 'C:\\path\\to\\file.txt';
            const result = getResourceUri(testPath, testRoot);

            assert.ok(result instanceof Uri);
            assert.strictEqual(result?.scheme, 'file');
            assert.strictEqual(result?.path, '/C:/path/to/file.txt');
        });

        test('parses existing URI correctly', () => {
            const uriString = 'scheme://authority/path';
            const result = getResourceUri(uriString, testRoot);

            assert.ok(result instanceof Uri);
            assert.strictEqual(result?.scheme, 'scheme');
            assert.strictEqual(result?.authority, 'authority');
            assert.strictEqual(result?.path, '/path');
        });

        test('handles exception and returns undefined', () => {
            // Create a scenario that would cause an exception
            // For this test, we'll mock Uri.file to throw an error
            const originalUriFile = Uri.file;
            Uri.file = () => {
                throw new Error('Test error');
            };
            try {
                const result = getResourceUri('some-path', testRoot);
                assert.strictEqual(result, undefined);
            } finally {
                // Restore the original function
                Uri.file = originalUriFile;
            }
        });

        test('handles relative paths by resolving against the provided root', () => {
            const path = require('path');

            // Use a relative path
            const relativePath = './relative/path/file.txt';
            const customRoot = path.join(testRoot, 'custom/root');

            const result = getResourceUri(relativePath, customRoot);

            assert.ok(result instanceof Uri);
            assert.strictEqual(result?.scheme, 'file');
            // The resulting path should be resolved against the custom root
            assert.ok(
                result!.fsPath.replace(/\\/g, '/').toLowerCase().endsWith('relative/path/file.txt'),
                `Expected path to end with the relative path segment, but got: ${result!.fsPath}`,
            );

            // Verify the path contains the custom root
            const normalizedResult = result!.fsPath.replace(/\\/g, '/').toLowerCase();
            const normalizedRoot = customRoot.replace(/\\/g, '/').toLowerCase();
            assert.ok(
                normalizedResult.includes(normalizedRoot),
                `Expected path to include the custom root "${normalizedRoot}", but got: ${normalizedResult}`,
            );
        });
    });

    suite('normalizePath', () => {
        let isWindowsStub: sinon.SinonStub;

        setup(() => {
            isWindowsStub = sinon.stub(utils, 'isWindows');
        });

        teardown(() => {
            sinon.restore();
        });
        test('replaces backslashes with forward slashes', () => {
            const testPath = 'C:\\path\\to\\file.txt';
            const result = normalizePath(testPath);

            assert.strictEqual(result.includes('\\'), false);
            assert.strictEqual(result, 'C:/path/to/file.txt');
        });

        test('converts to lowercase on Windows', () => {
            isWindowsStub.returns(true);

            const testPath = 'C:/Path/To/File.txt';
            const result = normalizePath(testPath);

            assert.strictEqual(result, 'c:/path/to/file.txt');
        });

        test('preserves case on non-Windows', () => {
            isWindowsStub.returns(false);

            const testPath = 'C:/Path/To/File.txt';
            const result = normalizePath(testPath);

            assert.strictEqual(result, 'C:/Path/To/File.txt');
        });
    });
});
