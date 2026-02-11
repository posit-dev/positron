// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

/**
 * Package Manager API Unit Tests
 *
 * This test suite validates the package management API functionality including:
 * - Package manager registration and lifecycle
 * - Package operations (install, uninstall, upgrade)
 * - Package retrieval and refresh
 * - Event handling for package changes
 */

import { Extension } from 'vscode';

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as typeMoq from 'typemoq';
import { Disposable, EventEmitter, Uri } from 'vscode';
import {
    DidChangeEnvironmentEventArgs,
    DidChangeEnvironmentsEventArgs,
    DidChangePackagesEventArgs,
    Package,
    PackageChangeKind,
    PackageManagementOptions,
    PackageManager,
    PythonEnvironment,
} from '../../api';
import * as extensionApis from '../../common/extension.apis';
import { PythonEnvironmentManagers } from '../../features/envManagers';
import { PythonProjectManager } from '../../internal.api';
import { setupNonThenable } from '../mocks/helper';

/**
 * Test Suite: Package Manager API
 *
 * Tests the package management functionality including registration, package operations,
 * and event handling through the PythonEnvironmentManagers API.
 */
suite('PythonPackageManagerApi Tests', () => {
    // Mocks - declared at suite level for reuse across tests
    let envManagers: PythonEnvironmentManagers;
    let projectManager: typeMoq.IMock<PythonProjectManager>;
    let environment: typeMoq.IMock<PythonEnvironment>;
    let packageManager: typeMoq.IMock<PackageManager>;
    let onDidChangePackagesEmitter: EventEmitter<DidChangePackagesEventArgs>;
    let getExtensionStub: sinon.SinonStub;

    setup(() => {
        // Mock extension APIs to avoid registration errors
        const mockPythonExtension = {
            id: 'ms-python.python',
            extensionPath: '/mock/python/extension',
        };
        const mockEnvsExtension = {
            id: 'ms-python.vscode-python-envs',
            extensionPath: '/mock/envs/extension',
        };

        getExtensionStub = sinon.stub(extensionApis, 'getExtension');
        getExtensionStub.withArgs('ms-python.python').returns(mockPythonExtension as Extension<unknown>);
        getExtensionStub.withArgs('ms-python.vscode-python-envs').returns(mockEnvsExtension as Extension<unknown>);

        sinon
            .stub(extensionApis, 'allExtensions')
            .returns([mockPythonExtension, mockEnvsExtension] as Extension<unknown>[]);

        // Mock project manager
        projectManager = typeMoq.Mock.ofType<PythonProjectManager>();
        setupNonThenable(projectManager);

        // Create environment managers instance
        envManagers = new PythonEnvironmentManagers(projectManager.object);

        // Mock Python environment
        environment = typeMoq.Mock.ofType<PythonEnvironment>();
        environment.setup((e) => e.envId).returns(() => ({ id: 'env1', managerId: 'test-ext:test-env-mgr' }));
        environment.setup((e) => e.environmentPath).returns(() => Uri.file('/test/env'));
        setupNonThenable(environment);

        // Mock package manager with default behaviors
        onDidChangePackagesEmitter = new EventEmitter<DidChangePackagesEventArgs>();
        packageManager = typeMoq.Mock.ofType<PackageManager>();
        packageManager.setup((pm) => pm.name).returns(() => 'test-pkg-mgr');
        packageManager.setup((pm) => pm.displayName).returns(() => 'Test Package Manager');
        packageManager.setup((pm) => pm.description).returns(() => 'Test package manager description');
        packageManager.setup((pm) => pm.onDidChangePackages).returns(() => onDidChangePackagesEmitter.event);
        setupNonThenable(packageManager);
    });

    teardown(() => {
        sinon.restore();
        envManagers.dispose();
        onDidChangePackagesEmitter.dispose();
    });

    /**
     * Tests for Package Manager Registration
     *
     * Covers the lifecycle of registering and unregistering package managers,
     * including ID generation, duplicate detection, and event firing.
     */
    suite('registerPackageManager', () => {
        test('Should successfully register package manager', () => {
            // Mock - no additional setup needed, using default package manager

            // Run
            const disposable = envManagers.registerPackageManager(packageManager.object);

            // Assert
            assert.ok(disposable, 'Should return a disposable');
            assert.strictEqual(envManagers.packageManagers.length, 1, 'Should have one registered package manager');
            assert.strictEqual(
                envManagers.packageManagers[0].name,
                'test-pkg-mgr',
                'Package manager name should match',
            );

            disposable.dispose();
        });

        test('Should generate ID containing manager name', () => {
            // Mock - using default package manager with name 'test-pkg-mgr'

            // Run
            const disposable = envManagers.registerPackageManager(packageManager.object);
            const registeredManager = envManagers.packageManagers[0];

            // Assert
            assert.ok(registeredManager.id.includes('test-pkg-mgr'), 'ID should contain the manager name');

            disposable.dispose();
        });

        test('Should normalize special characters in package manager name for ID', () => {
            // Mock - Create package manager with special characters in name
            const specialCharsPackageManager = typeMoq.Mock.ofType<PackageManager>();
            specialCharsPackageManager.setup((pm) => pm.name).returns(() => 'Test Package Manager!@#');
            specialCharsPackageManager.setup((pm) => pm.displayName).returns(() => 'Test Package Manager');
            specialCharsPackageManager.setup((pm) => pm.description).returns(() => 'Test package manager description');
            specialCharsPackageManager
                .setup((pm) => pm.onDidChangePackages)
                .returns(() => onDidChangePackagesEmitter.event);
            setupNonThenable(specialCharsPackageManager);

            // Run
            const disposable = envManagers.registerPackageManager(specialCharsPackageManager.object);
            const registeredManager = envManagers.packageManagers[0];

            // Assert - Name preserved, ID normalized
            assert.strictEqual(registeredManager.name, 'Test Package Manager!@#', 'Name should not be modified');
            assert.ok(
                registeredManager.id.includes('test_package_manager'),
                `ID should contain normalized name with underscores. Got: '${registeredManager.id}'`,
            );

            disposable.dispose();
        });

        test('Should reject duplicate package manager registration', () => {
            // Mock - Register package manager once
            const disposable = envManagers.registerPackageManager(packageManager.object);

            // Run & Assert - Attempt to register same manager again
            assert.throws(
                () => envManagers.registerPackageManager(packageManager.object),
                /already registered/i,
                'Should throw error for duplicate registration',
            );

            disposable.dispose();
        });

        test('Should unregister package manager when disposable is disposed', () => {
            // Mock - Register package manager
            const disposable = envManagers.registerPackageManager(packageManager.object);
            assert.strictEqual(envManagers.packageManagers.length, 1, 'Should have one package manager');

            // Run
            disposable.dispose();

            // Assert
            assert.strictEqual(envManagers.packageManagers.length, 0, 'Should have no package managers after disposal');
        });

        test('Should fire onDidChangePackageManager event with "registered" kind on registration', (done) => {
            // Mock - Set up event listener
            const listener = envManagers.onDidChangePackageManager((e) => {
                // Assert
                assert.strictEqual(e.kind, 'registered', 'Event kind should be registered');
                assert.strictEqual(e.manager.name, 'test-pkg-mgr', 'Manager name should match');
                listener.dispose();
                done();
            });

            // Run
            envManagers.registerPackageManager(packageManager.object);
        });

        test('Should fire onDidChangePackageManager event with "unregistered" kind on disposal', (done) => {
            // Mock - Register package manager and set up event listener
            const disposable = envManagers.registerPackageManager(packageManager.object);

            const listener = envManagers.onDidChangePackageManager((e) => {
                if (e.kind === 'unregistered') {
                    // Assert
                    assert.strictEqual(e.manager.name, 'test-pkg-mgr', 'Manager name should match');
                    listener.dispose();
                    done();
                }
            });

            // Run
            disposable.dispose();
        });
    });

    /**
     * Tests for Package Management Operations
     *
     * Verifies install, uninstall, and upgrade operations are delegated correctly
     * to the underlying package manager.
     */
    suite('managePackages', () => {
        let disposable: Disposable;

        setup(() => {
            disposable = envManagers.registerPackageManager(packageManager.object);
        });

        teardown(() => {
            disposable.dispose();
        });

        test('Should propagate errors from underlying package manager with error details', async () => {
            // Mock - Set up package manager to fail with detailed error
            const options: PackageManagementOptions = {
                install: ['invalid-package'],
            };
            const testError = new Error('Package installation failed') as Error & {
                code: string;
                packageName: string;
            };
            testError.code = 'ENOTFOUND';
            testError.packageName = 'invalid-package';
            packageManager
                .setup((pm) => pm.manage(environment.object, options))
                .returns(() => Promise.reject(testError));

            // Run & Assert - Should reject with same error and preserve error properties
            try {
                await envManagers.packageManagers[0].manage(environment.object, options);
                assert.fail('Should have thrown an error');
            } catch (err) {
                const error = err as Error & { code?: string; packageName?: string };
                assert.strictEqual(error.message, 'Package installation failed', 'Error message should match');
                assert.strictEqual(error.code, 'ENOTFOUND', 'Error code should be preserved');
                assert.strictEqual(error.packageName, 'invalid-package', 'Error metadata should be preserved');
            }
        });

        test('Should handle concurrent package operations on same environment', async () => {
            // Mock - Set up multiple concurrent operations
            const installOptions: PackageManagementOptions = { install: ['numpy'] };
            const uninstallOptions: PackageManagementOptions = { uninstall: ['pandas'] };

            packageManager
                .setup((pm) => pm.manage(environment.object, installOptions))
                .returns(() => new Promise((resolve) => setTimeout(resolve, 50)));

            packageManager
                .setup((pm) => pm.manage(environment.object, uninstallOptions))
                .returns(() => new Promise((resolve) => setTimeout(resolve, 30)));

            // Run - Execute operations concurrently
            const operations = [
                envManagers.packageManagers[0].manage(environment.object, installOptions),
                envManagers.packageManagers[0].manage(environment.object, uninstallOptions),
            ];

            // Assert - Both operations should complete without interfering
            await assert.doesNotReject(Promise.all(operations), 'Concurrent operations should complete successfully');
        });
    });

    /**
     * Tests for Package Refresh Operations
     *
     * Verifies that package list refresh operations are correctly delegated
     * to the underlying package manager.
     */
    suite('refreshPackages', () => {
        let disposable: Disposable;

        setup(() => {
            disposable = envManagers.registerPackageManager(packageManager.object);
        });

        teardown(() => {
            disposable.dispose();
        });

        test('Should propagate errors from underlying package manager refresh', async () => {
            // Mock - Set up package manager to fail on refresh
            const testError = new Error('Refresh failed');
            packageManager.setup((pm) => pm.refresh(environment.object)).returns(() => Promise.reject(testError));

            // Run & Assert - Should reject with same error
            await assert.rejects(
                async () => envManagers.packageManagers[0].refresh(environment.object),
                testError,
                'Should propagate error from package manager',
            );
        });
    });

    suite('getPackages', () => {
        let disposable: Disposable;

        setup(() => {
            disposable = envManagers.registerPackageManager(packageManager.object);
        });

        teardown(() => {
            disposable.dispose();
        });

        test('Should return packages from package manager', async () => {
            // Mock - Set up package list with multiple packages
            const mockPackages: Package[] = [
                {
                    pkgId: { id: 'numpy', managerId: 'test-ext:test-pkg-mgr', environmentId: 'env1' },
                    name: 'numpy',
                    displayName: 'NumPy',
                    version: '1.24.0',
                },
                {
                    pkgId: { id: 'pandas', managerId: 'test-ext:test-pkg-mgr', environmentId: 'env1' },
                    name: 'pandas',
                    displayName: 'Pandas',
                    version: '2.0.0',
                },
            ];
            packageManager
                .setup((pm) => pm.getPackages(environment.object))
                .returns(() => Promise.resolve(mockPackages))
                .verifiable(typeMoq.Times.once());

            // Run
            const packages = await envManagers.packageManagers[0].getPackages(environment.object);

            // Assert
            assert.strictEqual(packages?.length, 2, 'Should return two packages');
            assert.strictEqual(packages?.[0].name, 'numpy', 'First package should be numpy');
            assert.strictEqual(packages?.[1].name, 'pandas', 'Second package should be pandas');
            packageManager.verifyAll();
        });

        test('Should return undefined when no packages found', async () => {
            // Mock - Package manager returns undefined
            packageManager
                .setup((pm) => pm.getPackages(environment.object))
                .returns(() => Promise.resolve(undefined))
                .verifiable(typeMoq.Times.once());

            // Run
            const packages = await envManagers.packageManagers[0].getPackages(environment.object);

            // Assert
            assert.strictEqual(packages, undefined, 'Should return undefined when no packages');
            packageManager.verifyAll();
        });

        test('Should return empty array when environment has no packages', async () => {
            // Mock - Package manager returns empty array
            packageManager
                .setup((pm) => pm.getPackages(environment.object))
                .returns(() => Promise.resolve([]))
                .verifiable(typeMoq.Times.once());

            // Run
            const packages = await envManagers.packageManagers[0].getPackages(environment.object);

            // Assert
            assert.strictEqual(packages?.length, 0, 'Should return empty array');
            packageManager.verifyAll();
        });

        test('Should return packages with complete metadata including optional fields', async () => {
            // Mock - Set up package with all optional fields
            const mockPackages: Package[] = [
                {
                    pkgId: { id: 'requests', managerId: 'test-ext:test-pkg-mgr', environmentId: 'env1' },
                    name: 'requests',
                    displayName: 'Requests',
                    version: '2.31.0',
                    description: 'HTTP library for Python',
                    tooltip: 'Requests: HTTP for Humans™',
                    iconPath: Uri.file('/path/to/icon.png'),
                    uris: [Uri.file('/path/to/package'), Uri.parse('https://pypi.org/project/requests')],
                },
            ];
            packageManager
                .setup((pm) => pm.getPackages(environment.object))
                .returns(() => Promise.resolve(mockPackages));

            // Run
            const packages = await envManagers.packageManagers[0].getPackages(environment.object);

            // Assert - Verify all metadata is preserved
            assert.strictEqual(packages?.length, 1, 'Should return one package');
            const pkg = packages![0];
            assert.strictEqual(pkg.name, 'requests', 'Package name should match');
            assert.strictEqual(pkg.version, '2.31.0', 'Version should match');
            assert.strictEqual(pkg.description, 'HTTP library for Python', 'Description should be preserved');
            assert.strictEqual(pkg.tooltip, 'Requests: HTTP for Humans™', 'Tooltip should be preserved');
            assert.ok(pkg.iconPath, 'Icon path should be preserved');
            assert.strictEqual(pkg.uris?.length, 2, 'Should have two URIs');
        });

        test('Should propagate errors from package manager getPackages method', async () => {
            // Mock - Package manager throws error
            const testError = new Error('Failed to get packages');
            packageManager.setup((pm) => pm.getPackages(environment.object)).returns(() => Promise.reject(testError));

            // Run & Assert - Should reject with same error
            await assert.rejects(
                async () => envManagers.packageManagers[0].getPackages(environment.object),
                testError,
                'Should propagate error from package manager',
            );
        });
    });

    /**
     * Tests for Package Change Events
     *
     * Verifies that package change events are correctly propagated from
     * package managers to listeners, including add/remove operations.
     */
    suite('onDidChangePackages', () => {
        let disposable: Disposable;

        setup(() => {
            disposable = envManagers.registerPackageManager(packageManager.object);
        });

        teardown(() => {
            disposable.dispose();
        });

        test('Should fire event when packages are added to environment', (done) => {
            // Mock - Create package and set up listener
            const addedPackage: Package = {
                pkgId: { id: 'numpy', managerId: 'test-ext:test-pkg-mgr', environmentId: 'env1' },
                name: 'numpy',
                displayName: 'NumPy',
                version: '1.24.0',
            };

            const listener = envManagers.onDidChangePackages((e) => {
                // Assert - Verify event details
                assert.strictEqual(e.environment, environment.object, 'Environment should match');
                assert.strictEqual(e.changes.length, 1, 'Should have one change');
                assert.strictEqual(e.changes[0].kind, PackageChangeKind.add, 'Change kind should be add');
                assert.strictEqual(e.changes[0].pkg.name, 'numpy', 'Package name should match');
                listener.dispose();
                done();
            });

            // Run - Fire package change event
            onDidChangePackagesEmitter.fire({
                environment: environment.object,
                manager: packageManager.object,
                changes: [{ kind: PackageChangeKind.add, pkg: addedPackage }],
            });
        });

        test('Should fire event when packages are removed from environment', (done) => {
            // Mock - Create package and set up listener
            const removedPackage: Package = {
                pkgId: { id: 'old-package', managerId: 'test-ext:test-pkg-mgr', environmentId: 'env1' },
                name: 'old-package',
                displayName: 'Old Package',
                version: '0.1.0',
            };

            const listener = envManagers.onDidChangePackages((e) => {
                // Assert - Verify event details
                assert.strictEqual(e.changes.length, 1, 'Should have one change');
                assert.strictEqual(e.changes[0].kind, PackageChangeKind.remove, 'Change kind should be remove');
                assert.strictEqual(e.changes[0].pkg.name, 'old-package', 'Package name should match');
                listener.dispose();
                done();
            });

            // Run - Fire package change event
            onDidChangePackagesEmitter.fire({
                environment: environment.object,
                manager: packageManager.object,
                changes: [{ kind: PackageChangeKind.remove, pkg: removedPackage }],
            });
        });

        test('Should fire event with multiple package changes in single operation', (done) => {
            // Mock - Create multiple packages
            const addedPackage: Package = {
                pkgId: { id: 'numpy', managerId: 'test-ext:test-pkg-mgr', environmentId: 'env1' },
                name: 'numpy',
                displayName: 'NumPy',
                version: '1.24.0',
            };
            const removedPackage: Package = {
                pkgId: { id: 'old-package', managerId: 'test-ext:test-pkg-mgr', environmentId: 'env1' },
                name: 'old-package',
                displayName: 'Old Package',
                version: '0.1.0',
            };

            const listener = envManagers.onDidChangePackages((e) => {
                // Assert - Verify multiple changes
                assert.strictEqual(e.changes.length, 2, 'Should have two changes');
                assert.strictEqual(e.changes[0].kind, PackageChangeKind.add, 'First change should be add');
                assert.strictEqual(e.changes[1].kind, PackageChangeKind.remove, 'Second change should be remove');
                listener.dispose();
                done();
            });

            // Run - Fire event with multiple changes
            onDidChangePackagesEmitter.fire({
                environment: environment.object,
                manager: packageManager.object,
                changes: [
                    { kind: PackageChangeKind.add, pkg: addedPackage },
                    { kind: PackageChangeKind.remove, pkg: removedPackage },
                ],
            });
        });

        test('Should not fire event after listener is disposed and verify cleanup', (done) => {
            // Mock - Set up listener and track events
            let eventCount = 0;

            const listener = envManagers.onDidChangePackages(() => {
                eventCount++;
            });

            // Fire event before disposal - should be received
            const pkg: Package = {
                pkgId: { id: 'test', managerId: 'test-ext:test-pkg-mgr', environmentId: 'env1' },
                name: 'test',
                displayName: 'Test',
            };

            onDidChangePackagesEmitter.fire({
                environment: environment.object,
                manager: packageManager.object,
                changes: [{ kind: PackageChangeKind.add, pkg }],
            });

            // Wait for async event to fire (uses setImmediate in implementation)
            setImmediate(() => {
                // Verify event was received
                assert.strictEqual(eventCount, 1, 'Should receive event before disposal');

                // Run - Dispose listener
                listener.dispose();

                // Try to fire event after disposal - should be ignored
                onDidChangePackagesEmitter.fire({
                    environment: environment.object,
                    manager: packageManager.object,
                    changes: [{ kind: PackageChangeKind.add, pkg }],
                });

                // Assert - Wait to ensure no async firing after disposal
                setImmediate(() => {
                    assert.strictEqual(eventCount, 1, 'Should only receive event before disposal');

                    // Disposing again should be safe (idempotent)
                    listener.dispose();
                    assert.strictEqual(eventCount, 1, 'Multiple dispose calls should be safe');
                    done();
                });
            });
        });

        test('Should support multiple concurrent listeners', (done) => {
            // Mock - Set up multiple listeners and track when both are called
            let listener1Called = false;
            let listener2Called = false;

            const listener1 = envManagers.onDidChangePackages(() => {
                listener1Called = true;
                checkBothCalled();
            });

            const listener2 = envManagers.onDidChangePackages(() => {
                listener2Called = true;
                checkBothCalled();
            });

            // Test completes only when both listeners have been notified
            function checkBothCalled() {
                if (listener1Called && listener2Called) {
                    // Assert - Both listeners were called
                    listener1.dispose();
                    listener2.dispose();
                    done();
                }
            }

            const pkg: Package = {
                pkgId: { id: 'test', managerId: 'test-ext:test-pkg-mgr', environmentId: 'env1' },
                name: 'test',
                displayName: 'Test',
            };

            // Run - Fire event to trigger both listeners
            onDidChangePackagesEmitter.fire({
                environment: environment.object,
                manager: packageManager.object,
                changes: [{ kind: PackageChangeKind.add, pkg }],
            });
        });
    });

    /**
     * Tests for Package Manager Retrieval
     *
     * Verifies that package managers can be retrieved by ID or from environment
     * objects, and handles non-existent managers gracefully.
     */
    suite('getPackageManager', () => {
        let disposable: Disposable;

        setup(() => {
            disposable = envManagers.registerPackageManager(packageManager.object);
        });

        teardown(() => {
            disposable.dispose();
        });

        test('Should retrieve package manager by ID string', () => {
            // Mock - Get registered package manager ID
            const managerId = envManagers.packageManagers[0].id;

            // Run
            const manager = envManagers.getPackageManager(managerId);

            // Assert
            assert.ok(manager, 'Should return a package manager');
            assert.strictEqual(manager?.name, 'test-pkg-mgr', 'Package manager name should match');
        });

        test('Should retrieve package manager from environment with preferred manager', () => {
            // Mock - Set up environment manager with preferred package manager
            const pkgManagerId = envManagers.packageManagers[0].id;

            // Create event emitters for the environment manager
            const onDidChangeEnvironmentsEmitter = new EventEmitter<DidChangeEnvironmentsEventArgs>();
            const onDidChangeEnvironmentEmitter = new EventEmitter<DidChangeEnvironmentEventArgs>();

            const envMgr = typeMoq.Mock.ofType<import('../../api').EnvironmentManager>();
            envMgr.setup((em) => em.name).returns(() => 'test-env-mgr');
            envMgr.setup((em) => em.preferredPackageManagerId).returns(() => pkgManagerId);
            envMgr.setup((em) => em.onDidChangeEnvironments).returns(() => onDidChangeEnvironmentsEmitter.event);
            envMgr.setup((em) => em.onDidChangeEnvironment).returns(() => onDidChangeEnvironmentEmitter.event);
            envMgr.setup((em) => em.refresh(typeMoq.It.isAny())).returns(() => Promise.resolve());
            envMgr.setup((em) => em.getEnvironments(typeMoq.It.isAny())).returns(() => Promise.resolve([]));
            envMgr.setup((em) => em.set(typeMoq.It.isAny(), typeMoq.It.isAny())).returns(() => Promise.resolve());
            envMgr.setup((em) => em.get(typeMoq.It.isAny())).returns(() => Promise.resolve(undefined));
            envMgr.setup((em) => em.resolve(typeMoq.It.isAny())).returns(() => Promise.resolve(undefined));
            setupNonThenable(envMgr);

            const envDisposable = envManagers.registerEnvironmentManager(envMgr.object);

            const envManagerId = envManagers.managers.find((em) => em.name === 'test-env-mgr')?.id;
            assert.ok(envManagerId, 'Environment manager should be registered');

            const testEnv = typeMoq.Mock.ofType<PythonEnvironment>();
            testEnv.setup((e) => e.envId).returns(() => ({ id: 'env1', managerId: envManagerId! }));
            setupNonThenable(testEnv);

            // Run
            const manager = envManagers.getPackageManager(testEnv.object);

            // Assert
            assert.ok(manager, 'Should return a package manager from environment');
            assert.strictEqual(manager?.name, 'test-pkg-mgr', 'Package manager name should match');

            envDisposable.dispose();
            onDidChangeEnvironmentsEmitter.dispose();
            onDidChangeEnvironmentEmitter.dispose();
        });

        test('Should retrieve correct package manager when multiple managers are registered', () => {
            // Mock - Register a second package manager with different name
            const secondEmitter = new EventEmitter<DidChangePackagesEventArgs>();
            const secondPackageManager = typeMoq.Mock.ofType<PackageManager>();
            secondPackageManager.setup((pm) => pm.name).returns(() => 'pip-manager');
            secondPackageManager.setup((pm) => pm.displayName).returns(() => 'Pip Package Manager');
            secondPackageManager.setup((pm) => pm.description).returns(() => 'Pip package manager');
            secondPackageManager.setup((pm) => pm.onDidChangePackages).returns(() => secondEmitter.event);
            setupNonThenable(secondPackageManager);

            const secondDisposable = envManagers.registerPackageManager(secondPackageManager.object);

            // Get both manager IDs
            const firstManagerId = envManagers.packageManagers[0].id;
            const secondManagerId = envManagers.packageManagers[1].id;

            // Run - Retrieve each manager by ID
            const firstManager = envManagers.getPackageManager(firstManagerId);
            const secondManager = envManagers.getPackageManager(secondManagerId);

            // Assert - Should retrieve correct managers
            assert.strictEqual(envManagers.packageManagers.length, 2, 'Should have two registered managers');
            assert.strictEqual(firstManager?.name, 'test-pkg-mgr', 'First manager should match');
            assert.strictEqual(secondManager?.name, 'pip-manager', 'Second manager should match');
            assert.notStrictEqual(firstManagerId, secondManagerId, 'Manager IDs should be unique');

            secondDisposable.dispose();
            secondEmitter.dispose();
        });

        test('Should return undefined for non-existent package manager ID', () => {
            // Mock - Use non-existent ID

            // Run
            const manager = envManagers.getPackageManager('non-existent-id');

            // Assert
            assert.strictEqual(manager, undefined, 'Should return undefined for non-existent ID');
        });
    });
});
