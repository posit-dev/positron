import assert from 'assert';
import { Uri } from 'vscode';
import {
    PyprojectToml,
    shouldProceedAfterPyprojectValidation,
    validatePyprojectToml,
    ValidationError,
} from '../../../managers/builtin/pipUtils';

suite('pipUtils - validatePyproject', () => {
    suite('shouldProceedAfterPyprojectValidation', () => {
        const mockValidationError: ValidationError = {
            message: 'Invalid package name "my package" in pyproject.toml.',
            fileUri: Uri.file('/test/path/pyproject.toml'),
        };

        test('should return true when no validation error exists', async () => {
            // Arrange: no validation error
            const validationError = undefined;
            const install = ['-e', '/test/path'];

            // Act
            const result = await shouldProceedAfterPyprojectValidation(validationError, install);

            // Assert
            assert.strictEqual(result, true, 'Should proceed when no validation error');
        });

        test('should return true when install array is empty', async () => {
            // Arrange: validation error exists but no packages selected
            const install: string[] = [];

            // Act
            const result = await shouldProceedAfterPyprojectValidation(mockValidationError, install);

            // Assert
            assert.strictEqual(result, true, 'Should proceed when no packages selected');
        });

        test('should return true when only requirements.txt packages selected (no -e flag)', async () => {
            // Arrange: validation error exists but only requirements.txt packages selected
            const install = ['-r', '/test/requirements.txt'];

            // Act
            const result = await shouldProceedAfterPyprojectValidation(mockValidationError, install);

            // Assert
            assert.strictEqual(result, true, 'Should proceed when no TOML packages selected');
        });

        test('should return true when only PyPI packages selected (no flags at all)', async () => {
            // Arrange: only PyPI package names, no flags
            const install = ['numpy', 'pandas', 'requests'];

            // Act
            const result = await shouldProceedAfterPyprojectValidation(mockValidationError, install);

            // Assert
            assert.strictEqual(result, true, 'Should proceed when only PyPI packages selected');
        });

        test('should not trigger on -e flag at end of array without following argument', async () => {
            // Arrange: -e flag is last item (malformed, but should not crash)
            const install = ['numpy', '-e'];
            // This is edge case - -e at end means no path follows, so index + 1 < arr.length is false

            // Act
            const result = await shouldProceedAfterPyprojectValidation(mockValidationError, install);

            // Assert
            assert.strictEqual(result, true, 'Should not crash on malformed -e flag at end');
        });
    });

    function verifyValidationError(toml: PyprojectToml, expectedError: string | undefined) {
        const ActualError = validatePyprojectToml(toml);
        assert.strictEqual(ActualError, expectedError);
    }

    suite('validatePyprojectToml - Package Name Validation (PEP 508)', () => {
        test('should accept valid single-character package name', () => {
            const toml: PyprojectToml = {
                project: { name: 'a' },
            };
            verifyValidationError(toml, undefined);
        });

        test('should accept valid package name with letters and numbers', () => {
            const toml: PyprojectToml = {
                project: { name: 'mypackage123' },
            };
            verifyValidationError(toml, undefined);
        });

        test('should accept valid package name with hyphens', () => {
            const toml: PyprojectToml = {
                project: { name: 'my-package' },
            };
            verifyValidationError(toml, undefined);
        });

        test('should accept valid package name with underscores', () => {
            const toml: PyprojectToml = {
                project: { name: 'my_package' },
            };
            verifyValidationError(toml, undefined);
        });

        test('should accept valid package name with dots', () => {
            const toml: PyprojectToml = {
                project: { name: 'my.package' },
            };
            verifyValidationError(toml, undefined);
        });

        test('should accept valid package name with mixed separators', () => {
            const toml: PyprojectToml = {
                project: { name: 'my-package_name.v2' },
            };
            verifyValidationError(toml, undefined);
        });

        test('should accept complex valid package name', () => {
            const toml: PyprojectToml = {
                project: { name: 'Django-REST-framework' },
            };
            verifyValidationError(toml, undefined);
        });

        test('should reject package name with spaces', () => {
            const toml: PyprojectToml = {
                project: { name: 'my package' },
            };
            verifyValidationError(toml, 'Invalid package name "my package" in pyproject.toml.');
        });

        test('should reject package name starting with hyphen', () => {
            const toml: PyprojectToml = {
                project: { name: '-mypackage' },
            };
            verifyValidationError(toml, 'Invalid package name "-mypackage" in pyproject.toml.');
        });

        test('should reject package name ending with hyphen', () => {
            const toml: PyprojectToml = {
                project: { name: 'mypackage-' },
            };
            verifyValidationError(toml, 'Invalid package name "mypackage-" in pyproject.toml.');
        });

        test('should reject package name starting with dot', () => {
            const toml: PyprojectToml = {
                project: { name: '.mypackage' },
            };
            verifyValidationError(toml, 'Invalid package name ".mypackage" in pyproject.toml.');
        });

        test('should reject package name ending with dot', () => {
            const toml: PyprojectToml = {
                project: { name: 'mypackage.' },
            };
            verifyValidationError(toml, 'Invalid package name "mypackage." in pyproject.toml.');
        });

        test('should reject package name starting with underscore', () => {
            const toml: PyprojectToml = {
                project: { name: '_mypackage' },
            };
            verifyValidationError(toml, 'Invalid package name "_mypackage" in pyproject.toml.');
        });

        test('should reject package name ending with underscore', () => {
            const toml: PyprojectToml = {
                project: { name: 'mypackage_' },
            };
            verifyValidationError(toml, 'Invalid package name "mypackage_" in pyproject.toml.');
        });

        test('should reject package name with special characters', () => {
            const toml: PyprojectToml = {
                project: { name: 'my@package' },
            };
            verifyValidationError(toml, 'Invalid package name "my@package" in pyproject.toml.');
        });

        test('should reject package name with only separator', () => {
            const toml: PyprojectToml = {
                project: { name: '-' },
            };
            verifyValidationError(toml, 'Invalid package name "-" in pyproject.toml.');
        });

        test('should accept when no project section exists', () => {
            const toml: PyprojectToml = {};
            verifyValidationError(toml, undefined);
        });
    });

    suite('validatePyprojectToml - Required Fields (PEP 621)', () => {
        test('should accept valid project with name', () => {
            const toml: PyprojectToml = {
                project: { name: 'test' },
            };
            verifyValidationError(toml, undefined);
        });

        test('should reject project without name field', () => {
            const toml: PyprojectToml = {
                project: { version: '1.0.0' },
            };
            verifyValidationError(toml, 'Missing required field "name" in [project] section of pyproject.toml.');
        });

        test('should accept when no project section exists', () => {
            const toml: PyprojectToml = {};
            verifyValidationError(toml, undefined);
        });
    });

    suite('validatePyprojectToml - Build System (PEP 518)', () => {
        test('should accept valid build-system with requires', () => {
            const toml: PyprojectToml = {
                project: { name: 'test' },
                'build-system': {
                    requires: ['setuptools', 'wheel'],
                },
            };
            verifyValidationError(toml, undefined);
        });

        test('should reject build-system without requires field', () => {
            const toml: PyprojectToml = {
                project: { name: 'test' },
                'build-system': {},
            };
            verifyValidationError(
                toml,
                'Missing required field "requires" in [build-system] section of pyproject.toml.',
            );
        });

        test('should accept when no build-system section exists', () => {
            const toml: PyprojectToml = {
                project: { name: 'test' },
            };
            verifyValidationError(toml, undefined);
        });
    });

    suite('validatePyprojectToml - Version Validation (PEP 440)', () => {
        interface VersionTestCase {
            version: string;
            expectedError: string | undefined;
            description: string;
        }

        function createVersionToml(version: string): PyprojectToml {
            return {
                project: { name: 'test', version },
            };
        }

        const versionTestCases: VersionTestCase[] = [
            // Basic release versions
            { version: '1.0', expectedError: undefined, description: 'simple version 1.0' },
            { version: '1.0.0', expectedError: undefined, description: 'version with three parts 1.0.0' },
            { version: '1.2.3.4.5', expectedError: undefined, description: 'version with many parts 1.2.3.4.5' },
            { version: '1.0.01', expectedError: undefined, description: 'version with leading zeros 1.0.01' },
            { version: '0', expectedError: undefined, description: 'single digit version 0' },
            { version: '2024.1.15', expectedError: undefined, description: 'large version numbers 2024.1.15' },

            // Epoch versions
            { version: '1!1.0', expectedError: undefined, description: 'epoch version 1!1.0' },
            { version: '2!0.0.1', expectedError: undefined, description: 'epoch version 2!0.0.1' },
            { version: '100!1.0.0', expectedError: undefined, description: 'large epoch 100!1.0.0' },

            // Pre-release versions - Alpha
            { version: '1.0a1', expectedError: undefined, description: 'alpha version 1.0a1' },
            { version: '1.0.a1', expectedError: undefined, description: 'alpha with dot separator 1.0.a1' },
            { version: '1.0-a1', expectedError: undefined, description: 'alpha with hyphen separator 1.0-a1' },
            { version: '1.0_a1', expectedError: undefined, description: 'alpha with underscore 1.0_a1' },
            { version: '1.0a', expectedError: undefined, description: 'alpha without number 1.0a' },
            { version: '1.0alpha1', expectedError: undefined, description: 'long form alpha 1.0alpha1' },
            { version: '1.0.alpha.1', expectedError: undefined, description: 'alpha with separators 1.0.alpha.1' },
            { version: '1.0a999', expectedError: undefined, description: 'alpha with large number 1.0a999' },

            // Pre-release versions - Beta
            { version: '1.0b1', expectedError: undefined, description: 'beta version 1.0b1' },
            { version: '1.0beta1', expectedError: undefined, description: 'long form beta 1.0beta1' },
            { version: '1.0.beta.2', expectedError: undefined, description: 'beta with separators 1.0.beta.2' },
            { version: '1.0b', expectedError: undefined, description: 'beta without number 1.0b' },

            // Pre-release versions - RC
            { version: '1.0rc1', expectedError: undefined, description: 'rc version 1.0rc1' },
            { version: '1.0c1', expectedError: undefined, description: 'c version 1.0c1' },
            { version: '1.0.rc.3', expectedError: undefined, description: 'rc with separators 1.0.rc.3' },
            { version: '1.0rc', expectedError: undefined, description: 'rc without number 1.0rc' },

            // Pre-release versions - Other
            { version: '1.0preview1', expectedError: undefined, description: 'preview version 1.0preview1' },
            { version: '1.0pre1', expectedError: undefined, description: 'pre version 1.0pre1' },
            {
                version: '1.0-preview-2',
                expectedError: undefined,
                description: 'preview with separators 1.0-preview-2',
            },

            // Post-release versions
            { version: '1.0.post1', expectedError: undefined, description: 'post version 1.0.post1' },
            { version: '1.0post1', expectedError: undefined, description: 'post without dot 1.0post1' },
            { version: '1.0-post1', expectedError: undefined, description: 'post with hyphen 1.0-post1' },
            { version: '1.0_post1', expectedError: undefined, description: 'post with underscore 1.0_post1' },
            { version: '1.0.post', expectedError: undefined, description: 'post without number 1.0.post' },
            { version: '1.0-1', expectedError: undefined, description: 'implicit post version 1.0-1' },
            { version: '1.0-5', expectedError: undefined, description: 'implicit post version 1.0-5' },
            { version: '1.0rev1', expectedError: undefined, description: 'rev version 1.0rev1' },
            { version: '1.0r1', expectedError: undefined, description: 'r version 1.0r1' },
            { version: '1.0.rev.2', expectedError: undefined, description: 'rev with separators 1.0.rev.2' },
            { version: '1.0.post999', expectedError: undefined, description: 'post with large number 1.0.post999' },

            // Dev versions
            { version: '1.0.dev1', expectedError: undefined, description: 'dev version 1.0.dev1' },
            { version: '1.0dev1', expectedError: undefined, description: 'dev without dot 1.0dev1' },
            { version: '1.0-dev1', expectedError: undefined, description: 'dev with hyphen 1.0-dev1' },
            { version: '1.0_dev1', expectedError: undefined, description: 'dev with underscore 1.0_dev1' },
            { version: '1.0.dev', expectedError: undefined, description: 'dev without number 1.0.dev' },
            { version: '1.0.dev999', expectedError: undefined, description: 'dev with large number 1.0.dev999' },

            // Local versions
            { version: '1.0+abc', expectedError: undefined, description: 'local version 1.0+abc' },
            { version: '1.0+abc.def', expectedError: undefined, description: 'local with dots 1.0+abc.def' },
            { version: '1.0+abc-def', expectedError: undefined, description: 'local with hyphens 1.0+abc-def' },
            { version: '1.0+abc_def', expectedError: undefined, description: 'local with underscores 1.0+abc_def' },
            { version: '1.0+abc.5', expectedError: undefined, description: 'local with numbers 1.0+abc.5' },
            {
                version: '1.0+abc.def-ghi_jkl',
                expectedError: undefined,
                description: 'local with mixed separators 1.0+abc.def-ghi_jkl',
            },
            { version: '1.0+001', expectedError: undefined, description: 'numeric local version 1.0+001' },
            { version: '1.0+g1234567', expectedError: undefined, description: 'git hash-like local 1.0+g1234567' },

            // Combined versions
            { version: '1.0a1.post1', expectedError: undefined, description: 'pre + post 1.0a1.post1' },
            {
                version: '1.0a1.post1.dev2',
                expectedError: undefined,
                description: 'pre + post + dev 1.0a1.post1.dev2',
            },
            { version: '1.0.post1.dev2', expectedError: undefined, description: 'post + dev 1.0.post1.dev2' },
            { version: '1.0a1.dev1', expectedError: undefined, description: 'pre + dev 1.0a1.dev1' },
            { version: '1.0a1+local', expectedError: undefined, description: 'pre + local 1.0a1+local' },
            { version: '1.0.post1+local', expectedError: undefined, description: 'post + local 1.0.post1+local' },
            { version: '1.0.dev1+local', expectedError: undefined, description: 'dev + local 1.0.dev1+local' },
            {
                version: '1!1.0a1.post1.dev2+abc',
                expectedError: undefined,
                description: 'epoch + all components 1!1.0a1.post1.dev2+abc',
            },
            {
                version: '2!1.2.3rc4.post5.dev6+local.version',
                expectedError: undefined,
                description: 'full complex version 2!1.2.3rc4.post5.dev6+local.version',
            },
            { version: '1.0rc1-1', expectedError: undefined, description: 'rc + implicit post 1.0rc1-1' },

            // Version with v prefix
            { version: 'v1.0', expectedError: undefined, description: 'version with v prefix v1.0' },
            { version: 'v1.0.0', expectedError: undefined, description: 'version with v prefix v1.0.0' },
            { version: 'v1.0a1', expectedError: undefined, description: 'v prefix with pre-release v1.0a1' },
            { version: 'v1.0-1', expectedError: undefined, description: 'v prefix with implicit post v1.0-1' },
            {
                version: 'v1!2.0rc1.post2.dev3+local',
                expectedError: undefined,
                description: 'v prefix with all components v1!2.0rc1.post2.dev3+local',
            },

            // Case insensitivity
            { version: '1.0A1', expectedError: undefined, description: 'uppercase alpha 1.0A1' },
            { version: '1.0ALPHA1', expectedError: undefined, description: 'uppercase ALPHA 1.0ALPHA1' },
            { version: '1.0Alpha1', expectedError: undefined, description: 'mixed case Alpha 1.0Alpha1' },
            { version: '1.0POST1', expectedError: undefined, description: 'uppercase POST 1.0POST1' },
            { version: '1.0DEV1', expectedError: undefined, description: 'uppercase DEV 1.0DEV1' },
            { version: '1.0RC1', expectedError: undefined, description: 'uppercase RC 1.0RC1' },
            { version: 'V1.0', expectedError: undefined, description: 'uppercase V prefix V1.0' },
            {
                version: '1.0Alpha1.POST2.Dev3',
                expectedError: undefined,
                description: 'mixed case components 1.0Alpha1.POST2.Dev3',
            },

            // Invalid versions
            {
                version: '.1.0',
                expectedError: 'Invalid version ".1.0" in pyproject.toml.',
                description: 'starting with dot .1.0',
            },
            {
                version: '1.0.',
                expectedError: 'Invalid version "1.0." in pyproject.toml.',
                description: 'ending with dot 1.0.',
            },
            {
                version: 'abc',
                expectedError: 'Invalid version "abc" in pyproject.toml.',
                description: 'completely invalid abc',
            },
            { version: '', expectedError: 'Version cannot be empty in pyproject.toml.', description: 'empty version' },
            {
                version: '1..0',
                expectedError: 'Invalid version "1..0" in pyproject.toml.',
                description: 'double dots 1..0',
            },
            {
                version: '1.0 rc1',
                expectedError: 'Invalid version "1.0 rc1" in pyproject.toml.',
                description: 'spaces 1.0 rc1',
            },
            {
                version: '1.0gamma1',
                expectedError: 'Invalid version "1.0gamma1" in pyproject.toml.',
                description: 'invalid pre-release keyword 1.0gamma1',
            },
            {
                version: '1 1.0',
                expectedError: 'Invalid version "1 1.0" in pyproject.toml.',
                description: 'epoch without exclamation 1 1.0',
            },
            {
                version: '1.0local',
                expectedError: 'Invalid version "1.0local" in pyproject.toml.',
                description: 'local without plus 1.0local',
            },
            {
                version: '1.0+abc+def',
                expectedError: 'Invalid version "1.0+abc+def" in pyproject.toml.',
                description: 'multiple local markers 1.0+abc+def',
            },
            {
                version: '1!',
                expectedError: 'Invalid version "1!" in pyproject.toml.',
                description: 'only epoch 1!',
            },
            {
                version: '1.0--a1',
                expectedError: 'Invalid version "1.0--a1" in pyproject.toml.',
                description: 'invalid separator combinations 1.0--a1',
            },
        ];

        versionTestCases.forEach(({ version, expectedError, description }) => {
            test(`should ${expectedError ? 'reject' : 'accept'} ${description}`, () => {
                const toml = createVersionToml(version);
                verifyValidationError(toml, expectedError);
            });
        });

        // Edge cases
        test('should accept when no version field exists', () => {
            const toml: PyprojectToml = {
                project: { name: 'test' },
            };
            verifyValidationError(toml, undefined);
        });

        test('should accept when no project section exists', () => {
            const toml: PyprojectToml = {};
            verifyValidationError(toml, undefined);
        });
    });
});
