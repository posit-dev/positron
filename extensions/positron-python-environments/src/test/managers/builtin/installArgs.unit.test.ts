import assert from 'assert';
import { processEditableInstallArgs } from '../../../managers/builtin/utils';

suite('Process Editable Install Arguments Tests', () => {
    test('should handle empty args array', () => {
        const result = processEditableInstallArgs([]);
        assert.deepStrictEqual(result, [], 'Should return empty array for empty input');
    });

    test('should pass through non-editable install args unchanged', () => {
        const args = ['numpy', 'pandas==2.0.0', '--user'];
        const result = processEditableInstallArgs(args);
        assert.deepStrictEqual(result, args, 'Should return regular args unchanged');
    });

    test('should pass through single -e argument unchanged', () => {
        const args = ['-e', 'c:/path/to/package'];
        const result = processEditableInstallArgs(args);
        assert.deepStrictEqual(result, args, 'Should return single -e arg unchanged');
    });

    test('should pass through multiple unrelated -e arguments unchanged', () => {
        const args = ['-e', 'c:/path/to/package1', '-e', 'c:/path/to/package2'];
        const result = processEditableInstallArgs(args);
        assert.deepStrictEqual(result, args, 'Should return multiple unrelated -e args unchanged');
    });

    test('should combine -e with extras correctly', () => {
        const args = ['-e', 'c:/path/to/package', '-e', '.[testing]'];
        const expected = ['-e', 'c:/path/to/package[testing]'];
        const result = processEditableInstallArgs(args);
        assert.deepStrictEqual(result, expected, 'Should combine -e with extras correctly');
    });

    test('should handle multiple editable installs with extras correctly', () => {
        const args = ['-e', 'c:/path/to/package1', '-e', '.[testing]', '-e', 'c:/path/to/package2', '-e', '.[dev]'];
        const expected = ['-e', 'c:/path/to/package1[testing]', '-e', 'c:/path/to/package2[dev]'];
        const result = processEditableInstallArgs(args);
        assert.deepStrictEqual(result, expected, 'Should handle multiple editable installs with extras');
    });

    test('should handle mixed regular and editable installs correctly', () => {
        const args = ['numpy', '-e', 'c:/path/to/package', '-e', '.[testing]', 'pandas==2.0.0'];
        const expected = ['numpy', '-e', 'c:/path/to/package[testing]', 'pandas==2.0.0'];
        const result = processEditableInstallArgs(args);
        assert.deepStrictEqual(result, expected, 'Should handle mixed regular and editable installs');
    });

    test('should handle incomplete -e arguments gracefully', () => {
        const args = ['-e'];
        const result = processEditableInstallArgs(args);
        assert.deepStrictEqual(result, ['-e'], 'Should handle incomplete -e arguments');
    });

    test('should not combine -e args when second is not an extras specification', () => {
        const args = ['-e', 'c:/path/to/package1', '-e', 'c:/path/to/package2'];
        const result = processEditableInstallArgs(args);
        assert.deepStrictEqual(result, args, 'Should not combine when second -e arg is not an extras spec');
    });

    test('should handle extras with multiple requirements', () => {
        const args = ['-e', 'c:/path/to/package', '-e', '.[testing,dev]'];
        const expected = ['-e', 'c:/path/to/package[testing,dev]'];
        const result = processEditableInstallArgs(args);
        assert.deepStrictEqual(result, expected, 'Should handle extras with multiple requirements');
    });

    test('should handle Windows-style paths correctly', () => {
        const args = ['-e', 'C:\\path\\to\\package', '-e', '.[testing]'];
        const expected = ['-e', 'C:\\path\\to\\package[testing]'];
        const result = processEditableInstallArgs(args);
        assert.deepStrictEqual(result, expected, 'Should handle Windows paths correctly');
    });

    test('should handle editable installs followed by other args', () => {
        const args = ['-e', 'c:/path/to/package', '-e', '.[testing]', '--no-deps'];
        const expected = ['-e', 'c:/path/to/package[testing]', '--no-deps'];
        const result = processEditableInstallArgs(args);
        assert.deepStrictEqual(result, expected, 'Should handle editable installs followed by other args');
    });
});
