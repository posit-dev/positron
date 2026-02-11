import * as assert from 'assert';
import {
    extractProfilePath,
    PROFILE_TAG_END,
    PROFILE_TAG_START,
} from '../../../../../features/terminal/shells/common/shellUtils';

suite('Shell Utils', () => {
    suite('extractProfilePath', () => {
        test('should return undefined when content is empty', () => {
            const content = '';
            const result = extractProfilePath(content);
            assert.strictEqual(result, undefined);
        });

        test('should return undefined when content does not have tags', () => {
            const content = 'sample content without tags';
            const result = extractProfilePath(content);
            assert.strictEqual(result, undefined);
        });

        test('should return undefined when only start tag exists', () => {
            const content = `content\n${PROFILE_TAG_START}\nsome path`;
            const result = extractProfilePath(content);
            assert.strictEqual(result, undefined);
        });

        test('should return undefined when only end tag exists', () => {
            const content = `content\nsome path\n${PROFILE_TAG_END}`;
            const result = extractProfilePath(content);
            assert.strictEqual(result, undefined);
        });

        test('should return undefined when tags are in wrong order', () => {
            const content = `content\n${PROFILE_TAG_END}\nsome path\n${PROFILE_TAG_START}`;
            const result = extractProfilePath(content);
            assert.strictEqual(result, undefined);
        });
        test('should return undefined when content between tags is empty', () => {
            const content = `content\n${PROFILE_TAG_START}\n\n${PROFILE_TAG_END}\nmore content`;
            const result = extractProfilePath(content);
            assert.strictEqual(result, undefined);
        });

        test('should extract path when found between tags', () => {
            const expectedPath = '/usr/local/bin/python';
            const content = `content\n${PROFILE_TAG_START}\n${expectedPath}\n${PROFILE_TAG_END}\nmore content`;
            const result = extractProfilePath(content);
            assert.strictEqual(result, expectedPath);
        });

        test('should trim whitespace from extracted path', () => {
            const expectedPath = '/usr/local/bin/python';
            const content = `content\n${PROFILE_TAG_START}\n  ${expectedPath}  \n${PROFILE_TAG_END}\nmore content`;
            const result = extractProfilePath(content);
            assert.strictEqual(result, expectedPath);
        });

        test('should handle Windows-style line endings', () => {
            const expectedPath = 'C:\\Python\\python.exe';
            const content = `content\r\n${PROFILE_TAG_START}\r\n${expectedPath}\r\n${PROFILE_TAG_END}\r\nmore content`;
            const result = extractProfilePath(content);
            assert.strictEqual(result, expectedPath);
        });

        test('should extract path with special characters', () => {
            const expectedPath = '/path with spaces/and (parentheses)/python';
            const content = `${PROFILE_TAG_START}\n${expectedPath}\n${PROFILE_TAG_END}`;
            const result = extractProfilePath(content);
            assert.strictEqual(result, expectedPath);
        });

        test('should extract multiline content correctly', () => {
            const expectedPath = 'line1\nline2\nline3';
            const content = `${PROFILE_TAG_START}\n${expectedPath}\n${PROFILE_TAG_END}`;
            const result = extractProfilePath(content);
            assert.strictEqual(result, expectedPath);
        });
    });
});
