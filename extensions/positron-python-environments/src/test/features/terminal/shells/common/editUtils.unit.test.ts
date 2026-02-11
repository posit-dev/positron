import * as assert from 'assert';
import { isWindows } from '../../../../../common/utils/platformUtils';
import {
    hasStartupCode,
    insertStartupCode,
    removeStartupCode,
} from '../../../../../features/terminal/shells/common/editUtils';

suite('Shell Edit Utils', () => {
    suite('hasStartupCode', () => {
        test('should return false when no markers exist', () => {
            const content = 'sample content without markers';
            const result = hasStartupCode(content, '# START', '# END', ['key']);
            assert.strictEqual(result, false);
        });

        test('should return false when only start marker exists', () => {
            const content = 'content\n# START\nsome code';
            const result = hasStartupCode(content, '# START', '# END', ['key']);
            assert.strictEqual(result, false);
        });

        test('should return false when only end marker exists', () => {
            const content = 'content\nsome code\n# END';
            const result = hasStartupCode(content, '# START', '# END', ['key']);
            assert.strictEqual(result, false);
        });

        test('should return false when markers are in wrong order', () => {
            const content = 'content\n# END\nsome code\n# START';
            const result = hasStartupCode(content, '# START', '# END', ['key']);
            assert.strictEqual(result, false);
        });

        test('should return false when content between markers is empty', () => {
            const content = 'content\n# START\n# END\nmore content';
            const result = hasStartupCode(content, '# START', '# END', ['key']);
            assert.strictEqual(result, false);
        });

        test('should return false when key is not found between markers', () => {
            const content = 'content\n# START\nsome other content\n# END\nmore content';
            const result = hasStartupCode(content, '# START', '# END', ['key']);
            assert.strictEqual(result, false);
        });

        test('should return true when key is found between markers', () => {
            const content = 'content\n# START\nsome key content\n# END\nmore content';
            const result = hasStartupCode(content, '# START', '# END', ['key']);
            assert.strictEqual(result, true);
        });

        test('should return true when all keys are found between markers', () => {
            const content = 'content\n# START\nsome key1 and key2 content\n# END\nmore content';
            const result = hasStartupCode(content, '# START', '# END', ['key1', 'key2']);
            assert.strictEqual(result, true);
        });

        test('should return false when not all keys are found between markers', () => {
            const content = 'content\n# START\nsome key1 content\n# END\nmore content';
            const result = hasStartupCode(content, '# START', '# END', ['key1', 'key2']);
            assert.strictEqual(result, false);
        });

        test('should handle Windows line endings (CRLF) correctly', () => {
            const content = 'content\r\n# START\r\nsome key content\r\n# END\r\nmore content';
            const result = hasStartupCode(content, '# START', '# END', ['key']);
            assert.strictEqual(result, true);
        });

        test('should handle mixed line endings correctly', () => {
            const content = 'content\n# START\r\nsome key content\n# END\r\nmore content';
            const result = hasStartupCode(content, '# START', '# END', ['key']);
            assert.strictEqual(result, true);
        });
    });

    suite('insertStartupCode', () => {
        test('should insert code at the end when no markers exist', () => {
            const content = 'existing content';
            const start = '# START';
            const end = '# END';
            const code = 'new code';
            const lineEndings = isWindows() ? '\r\n' : '\n';

            const result = insertStartupCode(content, start, end, code);
            const expected = `existing content${lineEndings}# START${lineEndings}new code${lineEndings}# END${lineEndings}`;

            assert.strictEqual(result, expected);
        });

        test('should replace code between existing markers', () => {
            const content = 'before\n# START\nold code\n# END\nafter';
            const start = '# START';
            const end = '# END';
            const code = 'new code';

            const result = insertStartupCode(content, start, end, code);
            const expected = 'before\n# START\nnew code\n# END\nafter';

            assert.strictEqual(result, expected);
        });

        test('should preserve content outside markers when replacing', () => {
            const content = 'line1\nline2\n# START\nold code\n# END\nline3\nline4';
            const start = '# START';
            const end = '# END';
            const code = 'new code';

            const result = insertStartupCode(content, start, end, code);
            const expected = 'line1\nline2\n# START\nnew code\n# END\nline3\nline4';

            assert.strictEqual(result, expected);
        });

        test('should add new code when only start marker exists', () => {
            const content = 'before\n# START\nold code';
            const start = '# START';
            const end = '# END';
            const code = 'new code';

            const result = insertStartupCode(content, start, end, code);
            const expected = 'before\n# START\nnew code\n# END\n';

            assert.strictEqual(result, expected);
        });

        test('should add new code when only end marker exists', () => {
            const content = 'before\nold code\n# END\nafter';
            const start = '# START';
            const end = '# END';
            const code = 'new code';

            const result = insertStartupCode(content, start, end, code);
            const expected = 'before\nold code\n# END\nafter\n# START\nnew code\n# END\n';

            assert.strictEqual(result, expected);
        });

        test('should handle Windows line endings (CRLF) correctly', () => {
            const content = 'before\r\n# START\r\nold code\r\n# END\r\nafter';
            const start = '# START';
            const end = '# END';
            const code = 'new code';

            const result = insertStartupCode(content, start, end, code);
            const expected = 'before\r\n# START\r\nnew code\r\n# END\r\nafter';

            assert.strictEqual(result, expected);
        });

        test('should preserve original line ending style when inserting', () => {
            // Content with Windows line endings
            const contentWindows = 'before\r\n# START\r\nold code\r\n# END\r\nafter';
            const resultWindows = insertStartupCode(contentWindows, '# START', '# END', 'new code');
            assert.ok(resultWindows.includes('\r\n'), 'Windows line endings should be preserved');

            // Content with Unix line endings
            const contentUnix = 'before\n# START\nold code\n# END\nafter';
            const resultUnix = insertStartupCode(contentUnix, '# START', '# END', 'new code');
            assert.ok(!resultUnix.includes('\r\n'), 'Unix line endings should be preserved');
        });
    });

    suite('removeStartupCode', () => {
        test('should return original content when no markers exist', () => {
            const content = 'sample content without markers';
            const result = removeStartupCode(content, '# START', '# END');
            assert.strictEqual(result, content);
        });

        test('should return original content when only start marker exists', () => {
            const content = 'content\n# START\nsome code';
            const result = removeStartupCode(content, '# START', '# END');
            assert.strictEqual(result, content);
        });

        test('should return original content when only end marker exists', () => {
            const content = 'content\nsome code\n# END';
            const result = removeStartupCode(content, '# START', '# END');
            assert.strictEqual(result, content);
        });

        test('should return original content when markers are in wrong order', () => {
            const content = 'content\n# END\nsome code\n# START';
            const result = removeStartupCode(content, '# START', '# END');
            assert.strictEqual(result, content);
        });

        test('should remove content between markers', () => {
            const content = 'before\n# START\ncode to remove\n# END\nafter';
            const result = removeStartupCode(content, '# START', '# END');
            const expected = 'before\nafter';
            assert.strictEqual(result, expected);
        });

        test('should handle multiple lines of content between markers', () => {
            const content = 'line1\nline2\n# START\nline3\nline4\nline5\n# END\nline6\nline7';
            const result = removeStartupCode(content, '# START', '# END');
            const expected = 'line1\nline2\nline6\nline7';
            assert.strictEqual(result, expected);
        });

        test('should handle markers at beginning of content', () => {
            const content = '# START\ncode to remove\n# END\nafter content';
            const result = removeStartupCode(content, '# START', '# END');
            const expected = 'after content';
            assert.strictEqual(result, expected);
        });

        test('should handle markers at end of content', () => {
            const content = 'before content\n# START\ncode to remove\n# END';
            const result = removeStartupCode(content, '# START', '# END');
            const expected = 'before content';
            assert.strictEqual(result, expected);
        });

        test('should handle Windows line endings (CRLF) correctly', () => {
            const content = 'before\r\n# START\r\ncode to remove\r\n# END\r\nafter';
            const result = removeStartupCode(content, '# START', '# END');
            const expected = 'before\r\nafter';
            assert.strictEqual(result, expected);
        });

        test('should preserve original line ending style when removing', () => {
            // Content with Windows line endings
            const contentWindows = 'before\r\n# START\r\ncode to remove\r\n# END\r\nafter';
            const resultWindows = removeStartupCode(contentWindows, '# START', '# END');
            assert.ok(resultWindows.includes('\r\n'), 'Windows line endings should be preserved');

            // Content with Unix line endings
            const contentUnix = 'before\n# START\ncode to remove\n# END\nafter';
            const resultUnix = removeStartupCode(contentUnix, '# START', '# END');
            assert.ok(!resultUnix.includes('\r\n'), 'Unix line endings should be preserved');
        });
    });
});
