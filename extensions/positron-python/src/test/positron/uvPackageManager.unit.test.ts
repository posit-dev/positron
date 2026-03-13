/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as path from 'path';
import * as sinon from 'sinon';
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { Uri } from 'vscode';
import { IWorkspaceService } from '../../client/common/application/types';
import { IFileSystem } from '../../client/common/platform/types';
import { IServiceContainer } from '../../client/ioc/types';
import { UvPackageManager } from '../../client/positron/packages/uvPackageManager';
import { PackageSession } from '../../client/positron/packages/types';

/**
 * Interface for emitting messages to the Positron console (matches the one in uvPackageManager.ts)
 */
interface MessageEmitter {
    fire(message: positron.LanguageRuntimeMessage): void;
}

// Test class to expose protected methods
class UvPackageManagerTest extends UvPackageManager {
    public async shouldUseProjectWorkflow(): Promise<boolean> {
        // Access private method via bracket notation for testing
        return (this as any)._shouldUseProjectWorkflow();
    }
}

suite('UvPackageManager Tests', () => {
    let uvPackageManager: UvPackageManagerTest;
    let serviceContainer: IServiceContainer;
    let workspaceService: IWorkspaceService;
    let fileSystem: IFileSystem;
    let messageEmitter: MessageEmitter;
    let session: PackageSession;

    setup(() => {
        // Create mocks for services
        fileSystem = {
            fileExists: sinon.stub().resolves(false),
            readFile: sinon.stub().resolves(''),
        } as any;

        workspaceService = {
            getWorkspaceFolder: sinon.stub().returns(undefined),
            get workspaceFolders() {
                return undefined;
            },
        } as any;

        // Create service container mock
        serviceContainer = {
            get: sinon.stub(),
        } as any;

        // Configure service container to return the appropriate services
        (serviceContainer.get as sinon.SinonStub)
            .withArgs(IWorkspaceService)
            .returns(workspaceService)
            .withArgs(IFileSystem)
            .returns(fileSystem);

        // Create message emitter mock
        messageEmitter = {
            fire: sinon.stub(),
        };

        // Create session mock
        session = {
            callMethod: sinon.stub().resolves([]),
        };

        // Create package manager instance
        uvPackageManager = new UvPackageManagerTest('/path/to/python', messageEmitter, serviceContainer, session);
    });

    teardown(() => {
        sinon.restore();
    });

    suite('_shouldUseProjectWorkflow Method', () => {
        test('Should return true when pyproject.toml exists with [project] section and requirements.txt does not', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[project]
name = "test-project"
version = "0.1.0"`;

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.true;
        });

        test('Should return false when pyproject.toml exists without [project] section', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[build-system]
requires = ["setuptools"]`;

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });

        test('Should return false when pyproject.toml has [project] section but missing name', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[project]
version = "0.1.0"`;

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });

        test('Should return false when pyproject.toml has [project] section but missing version', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[project]
name = "test-project"`;

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });

        test('Should return false when pyproject.toml readFile throws error', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .rejects(new Error('Permission denied'));

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });

        test('Should return false when both pyproject.toml and requirements.txt exist', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            const pyprojectContent = `[project]
name = "test-project"
version = "0.1.0"`;

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(true);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(true);
            (fileSystem.readFile as sinon.SinonStub)
                .withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml'))
                .resolves(pyprojectContent);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });

        test('Should return false when pyproject.toml does not exist', async () => {
            const workspaceFolder = {
                uri: Uri.file('/workspace'),
                name: 'test',
                index: 0,
            };

            sinon.stub(workspaceService, 'workspaceFolders').value([workspaceFolder]);
            const fileExistsStub = fileSystem.fileExists as sinon.SinonStub;
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'pyproject.toml')).resolves(false);
            fileExistsStub.withArgs(path.join(workspaceFolder.uri.fsPath, 'requirements.txt')).resolves(false);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });

        test('Should return false when no workspace folder is available', async () => {
            sinon.stub(workspaceService, 'workspaceFolders').value(undefined);

            const result = await uvPackageManager.shouldUseProjectWorkflow();

            expect(result).to.be.false;
        });
    });
});
