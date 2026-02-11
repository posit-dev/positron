import * as assert from 'assert';
import { EnvManagerTreeItem, PythonEnvTreeItem } from '../../../features/views/treeViewItems';
import { InternalEnvironmentManager, PythonEnvironmentImpl } from '../../../internal.api';
import { Uri } from 'vscode';

suite('Test TreeView Items', () => {
    suite('EnvManagerTreeItem', () => {
        test('Context Value: no-create', () => {
            const manager = new InternalEnvironmentManager('ms-python.python:test-manager', {
                name: 'test',
                description: 'test',
                preferredPackageManagerId: 'pip',
                refresh: () => Promise.resolve(),
                getEnvironments: () => Promise.resolve([]),
                resolve: () => Promise.resolve(undefined),
                set: () => Promise.resolve(),
                get: () => Promise.resolve(undefined),
            });
            const item = new EnvManagerTreeItem(manager);
            assert.equal(item.treeItem.contextValue, 'pythonEnvManager;ms-python.python:test-manager;');
        });

        test('Context Value: with create', () => {
            const manager = new InternalEnvironmentManager('ms-python.python:test-manager', {
                name: 'test',
                description: 'test',
                preferredPackageManagerId: 'pip',
                refresh: () => Promise.resolve(),
                getEnvironments: () => Promise.resolve([]),
                resolve: () => Promise.resolve(undefined),
                set: () => Promise.resolve(),
                get: () => Promise.resolve(undefined),
                create: () => Promise.resolve(undefined),
            });
            const item = new EnvManagerTreeItem(manager);
            assert.equal(item.treeItem.contextValue, 'pythonEnvManager;create;ms-python.python:test-manager;');
        });

        test('Name is used', () => {
            const manager = new InternalEnvironmentManager('ms-python.python:test-manager', {
                name: 'test',
                description: 'test',
                preferredPackageManagerId: 'pip',
                refresh: () => Promise.resolve(),
                getEnvironments: () => Promise.resolve([]),
                resolve: () => Promise.resolve(undefined),
                set: () => Promise.resolve(),
                get: () => Promise.resolve(undefined),
            });
            const item = new EnvManagerTreeItem(manager);
            assert.equal(item.treeItem.label, manager.name);
        });

        test('DisplayName is used', () => {
            const manager = new InternalEnvironmentManager('ms-python.python:test-manager', {
                name: 'test',
                displayName: 'Test',
                description: 'test',
                preferredPackageManagerId: 'pip',
                refresh: () => Promise.resolve(),
                getEnvironments: () => Promise.resolve([]),
                resolve: () => Promise.resolve(undefined),
                set: () => Promise.resolve(),
                get: () => Promise.resolve(undefined),
            });
            const item = new EnvManagerTreeItem(manager);
            assert.equal(item.treeItem.label, manager.displayName);
        });
    });

    suite('PythonEnvTreeItem', () => {
        const manager1 = new InternalEnvironmentManager('ms-python.python:test-manager', {
            name: 'test',
            displayName: 'Test',
            description: 'test',
            preferredPackageManagerId: 'pip',
            refresh: () => Promise.resolve(),
            getEnvironments: () => Promise.resolve([]),
            resolve: () => Promise.resolve(undefined),
            set: () => Promise.resolve(),
            get: () => Promise.resolve(undefined),
        });
        const managerItem1 = new EnvManagerTreeItem(manager1);

        const manager2 = new InternalEnvironmentManager('ms-python.python:test-manager', {
            name: 'test',
            displayName: 'Test',
            description: 'test',
            preferredPackageManagerId: 'pip',
            refresh: () => Promise.resolve(),
            getEnvironments: () => Promise.resolve([]),
            resolve: () => Promise.resolve(undefined),
            set: () => Promise.resolve(),
            get: () => Promise.resolve(undefined),
            create: () => Promise.resolve(undefined),
            remove: () => Promise.resolve(),
        });
        const managerItem2 = new EnvManagerTreeItem(manager2);

        test('Context Value: no-remove, no-activate', () => {
            const env = new PythonEnvironmentImpl(
                {
                    id: 'test-env',
                    managerId: manager1.id,
                },
                {
                    name: 'test-env',
                    displayName: 'Test Env',
                    description: 'This is test environment',
                    displayPath: '/home/user/envs/.venv/bin/python',
                    version: '3.12.1',
                    environmentPath: Uri.file('/home/user/envs/.venv/bin/python'),
                    execInfo: {
                        run: {
                            executable: '/home/user/envs/.venv/bin/python',
                        },
                    },
                    sysPrefix: '/home/user/envs/.venv',
                },
            );

            const item = new PythonEnvTreeItem(env, managerItem1);
            assert.equal(item.treeItem.contextValue, 'pythonEnvironment;');
        });

        test('Context Value: no-remove, with activate', () => {
            const env = new PythonEnvironmentImpl(
                {
                    id: 'test-env',
                    managerId: manager1.id,
                },
                {
                    name: 'test-env',
                    displayName: 'Test Env',
                    description: 'This is test environment',
                    displayPath: '/home/user/envs/.venv/bin/python',
                    version: '3.12.1',
                    environmentPath: Uri.file('/home/user/envs/.venv/bin/python'),
                    execInfo: {
                        run: {
                            executable: '/home/user/envs/.venv/bin/python',
                        },
                        activation: [
                            {
                                executable: '/home/user/envs/.venv/bin/activate',
                            },
                        ],
                    },
                    sysPrefix: '/home/user/envs/.venv',
                },
            );

            const item = new PythonEnvTreeItem(env, managerItem1);
            assert.equal(item.treeItem.contextValue, 'pythonEnvironment;activatable;');
        });

        test('Context Value: with remove, with activate', () => {
            const env = new PythonEnvironmentImpl(
                {
                    id: 'test-env',
                    managerId: manager2.id,
                },
                {
                    name: 'test-env',
                    displayName: 'Test Env',
                    description: 'This is test environment',
                    displayPath: '/home/user/envs/.venv/bin/python',
                    version: '3.12.1',
                    environmentPath: Uri.file('/home/user/envs/.venv/bin/python'),
                    execInfo: {
                        run: {
                            executable: '/home/user/envs/.venv/bin/python',
                        },
                        activation: [
                            {
                                executable: '/home/user/envs/.venv/bin/activate',
                            },
                        ],
                    },
                    sysPrefix: '/home/user/envs/.venv',
                },
            );

            const item = new PythonEnvTreeItem(env, managerItem2);
            assert.equal(item.treeItem.contextValue, 'pythonEnvironment;remove;activatable;');
        });

        test('Context Value: with remove, no-activate', () => {
            const env = new PythonEnvironmentImpl(
                {
                    id: 'test-env',
                    managerId: manager2.id,
                },
                {
                    name: 'test-env',
                    displayName: 'Test Env',
                    description: 'This is test environment',
                    displayPath: '/home/user/envs/.venv/bin/python',
                    version: '3.12.1',
                    environmentPath: Uri.file('/home/user/envs/.venv/bin/python'),
                    execInfo: {
                        run: {
                            executable: '/home/user/envs/.venv/bin/python',
                        },
                    },
                    sysPrefix: '/home/user/envs/.venv',
                },
            );

            const item = new PythonEnvTreeItem(env, managerItem2);
            assert.equal(item.treeItem.contextValue, 'pythonEnvironment;remove;');
        });

        test('Display Name is used', () => {
            const env = new PythonEnvironmentImpl(
                {
                    id: 'test-env',
                    managerId: manager1.id,
                },
                {
                    name: 'test-env',
                    displayName: 'Test Env',
                    description: 'This is test environment',
                    displayPath: '/home/user/envs/.venv/bin/python',
                    version: '3.12.1',
                    environmentPath: Uri.file('/home/user/envs/.venv/bin/python'),
                    execInfo: {
                        run: {
                            executable: '/home/user/envs/.venv/bin/python',
                        },
                    },
                    sysPrefix: '/home/user/envs/.venv',
                },
            );

            const item = new PythonEnvTreeItem(env, managerItem1);

            assert.equal(item.treeItem.label, env.displayName);
        });
    });
});
