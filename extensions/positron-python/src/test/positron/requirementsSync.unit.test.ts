/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { IFileSystem } from '../../client/common/platform/types';
import { IPersistentStateFactory } from '../../client/common/types';
import { IServiceContainer } from '../../client/ioc/types';
import {
    promptToEnable,
    RequirementsChange,
    syncWorkspaceRequirements,
} from '../../client/positron/packages/requirementsSync';

const REQUIREMENTS_PATH = '/w/requirements.txt';
const INSTALL_PANDAS: RequirementsChange = { kind: 'install', packageNames: ['pandas'] };
const PENDING_PANDAS = () => [{ requirementsPath: REQUIREMENTS_PATH, change: INSTALL_PANDAS }];

suite('requirementsSync Tests', () => {
    let fileContent: string;
    let fileSystem: { readFile: sinon.SinonStub; writeFile: sinon.SinonStub };
    let dismissed: boolean;
    let settingValues: { globalValue?: boolean; workspaceValue?: boolean; workspaceFolderValue?: boolean };
    let updateSetting: sinon.SinonStub;
    let configScope: vscode.Uri | undefined;
    let showInformationMessage: sinon.SinonStub;
    let showWarningMessage: sinon.SinonStub;
    let serviceContainer: IServiceContainer;
    let originalGetConfiguration: typeof vscode.workspace.getConfiguration;
    let originalShowInformationMessage: typeof vscode.window.showInformationMessage;
    let originalShowWarningMessage: typeof vscode.window.showWarningMessage;

    const installed =
        (...names: string[]) =>
        () =>
            Promise.resolve(names);

    setup(() => {
        fileContent = 'flask==2.2.0\n';
        fileSystem = {
            readFile: sinon.stub().callsFake(() => Promise.resolve(fileContent)),
            writeFile: sinon.stub().callsFake((_path: string, text: string) => {
                fileContent = text;
                return Promise.resolve();
            }),
        };

        dismissed = false;
        const persistentStateFactory = {
            createWorkspacePersistentState: () => ({
                get value() {
                    return dismissed;
                },
                updateValue: (value: boolean) => {
                    dismissed = value;
                    return Promise.resolve();
                },
            }),
        };
        serviceContainer = { get: sinon.stub() } as any;
        (serviceContainer.get as sinon.SinonStub)
            .withArgs(IFileSystem)
            .returns(fileSystem)
            .withArgs(IPersistentStateFactory)
            .returns(persistentStateFactory);

        settingValues = {};
        updateSetting = sinon.stub().resolves();
        originalGetConfiguration = vscode.workspace.getConfiguration;
        configScope = undefined;
        vscode.workspace.getConfiguration = (_section?: string, scope?: vscode.ConfigurationScope | null) => {
            configScope = scope as vscode.Uri | undefined;
            return {
                inspect: () => settingValues,
                get: () =>
                    settingValues.workspaceFolderValue ?? settingValues.workspaceValue ?? settingValues.globalValue,
                update: updateSetting,
            } as unknown as vscode.WorkspaceConfiguration;
        };

        // Default: the user closes the prompt without choosing.
        showInformationMessage = sinon.stub().resolves(undefined);
        showWarningMessage = sinon.stub().resolves(undefined);
        originalShowInformationMessage = vscode.window.showInformationMessage;
        originalShowWarningMessage = vscode.window.showWarningMessage;
        vscode.window.showInformationMessage = showInformationMessage;
        vscode.window.showWarningMessage = showWarningMessage;
    });

    teardown(() => {
        sinon.restore();
        vscode.workspace.getConfiguration = originalGetConfiguration;
        vscode.window.showInformationMessage = originalShowInformationMessage;
        vscode.window.showWarningMessage = originalShowWarningMessage;
    });

    suite('when the setting is enabled', () => {
        setup(() => {
            settingValues = { globalValue: true };
        });

        test('appends an installed package without prompting', async () => {
            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));

            expect(fileContent).to.equal('flask==2.2.0\npandas  # added by Positron\n');
            expect(showInformationMessage.called).to.equal(false);
        });

        test('comments out an uninstalled package', async () => {
            fileContent = 'flask==2.2.0\nrequests==2.28.2\n';

            await syncWorkspaceRequirements(
                serviceContainer,
                REQUIREMENTS_PATH,
                { kind: 'uninstall', packageNames: ['requests'] },
                installed('flask'),
            );

            expect(fileContent).to.equal('flask==2.2.0\n# requests removed by Positron\n');
        });

        test('skips an install the kernel does not confirm (the command failed)', async () => {
            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('flask'));

            expect(fileSystem.writeFile.called).to.equal(false);
        });

        test('skips an uninstall of a package that is still installed', async () => {
            fileContent = 'requests\n';

            await syncWorkspaceRequirements(
                serviceContainer,
                REQUIREMENTS_PATH,
                { kind: 'uninstall', packageNames: ['requests'] },
                installed('requests'),
            );

            expect(fileSystem.writeFile.called).to.equal(false);
        });

        test('only syncs the confirmed packages of a multi-package install', async () => {
            await syncWorkspaceRequirements(
                serviceContainer,
                REQUIREMENTS_PATH,
                { kind: 'install', packageNames: ['pandas', 'nonexistent-pkg'] },
                installed('pandas'),
            );

            expect(fileContent).to.equal('flask==2.2.0\npandas  # added by Positron\n');
        });

        test('does not query the kernel when the file would not change', async () => {
            const getInstalledNames = sinon.stub().resolves(['flask']);

            await syncWorkspaceRequirements(
                serviceContainer,
                REQUIREMENTS_PATH,
                { kind: 'install', packageNames: ['flask'] },
                getInstalledNames,
            );

            expect(getInstalledNames.called).to.equal(false);
            expect(fileSystem.writeFile.called).to.equal(false);
        });

        test('keeps edits saved to the file while the kernel is queried', async () => {
            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, () => {
                fileContent = 'flask==2.2.0\nnumpy\n';
                return Promise.resolve(['pandas']);
            });

            expect(fileContent).to.equal('flask==2.2.0\nnumpy\npandas  # added by Positron\n');
        });

        test("reads the setting for the requirements file's folder", async () => {
            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));

            expect(configScope?.fsPath).to.equal(vscode.Uri.file(REQUIREMENTS_PATH).fsPath);
        });

        test('warns instead of throwing when the file cannot be written', async () => {
            fileSystem.writeFile.rejects(new Error('EACCES: permission denied'));

            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));

            expect(showWarningMessage.calledOnce).to.equal(true);
            expect(showWarningMessage.firstCall.args[0]).to.contain('EACCES: permission denied');
        });

        test('warns instead of throwing when the installed packages cannot be read', async () => {
            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, () =>
                Promise.reject(new Error('kernel is busy')),
            );

            expect(fileSystem.writeFile.called).to.equal(false);
            expect(showWarningMessage.firstCall.args[0]).to.contain('kernel is busy');
        });
    });

    test('a workspace-level false overrides a global true', async () => {
        settingValues = { globalValue: true, workspaceValue: false };

        await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));

        expect(fileSystem.writeFile.called).to.equal(false);
        expect(showInformationMessage.called).to.equal(false);
    });

    test('does nothing and never prompts when the user disabled the setting', async () => {
        settingValues = { globalValue: false };

        await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));

        expect(fileSystem.writeFile.called).to.equal(false);
        expect(showInformationMessage.called).to.equal(false);
    });

    suite('when the setting is not set', () => {
        test('prompts instead of editing the file', async () => {
            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));

            expect(showInformationMessage.calledOnce).to.equal(true);
            expect(fileSystem.writeFile.called).to.equal(false);
        });

        test('returns before the prompt is answered, and shows one prompt at a time', async () => {
            let answer: (choice: string | undefined) => void = () => undefined;
            showInformationMessage.returns(new Promise((resolve) => (answer = resolve)));

            // Resolves while the prompt is still unanswered.
            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));
            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));
            expect(showInformationMessage.callCount).to.equal(1);

            answer(undefined);
            await new Promise((resolve) => setImmediate(resolve));
            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));
            expect(showInformationMessage.callCount).to.equal(2);
        });

        test('"Enable" applies every change made while the prompt was showing, in order', async () => {
            fileContent = 'flask==2.2.0\nrequests==2.28.2\n';
            let answer: (choice: string | undefined) => void = () => undefined;
            showInformationMessage.returns(new Promise((resolve) => (answer = resolve)));

            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));
            await syncWorkspaceRequirements(
                serviceContainer,
                REQUIREMENTS_PATH,
                { kind: 'install', packageNames: ['numpy'] },
                installed('pandas', 'numpy'),
            );
            await syncWorkspaceRequirements(
                serviceContainer,
                REQUIREMENTS_PATH,
                { kind: 'uninstall', packageNames: ['requests'] },
                installed('pandas', 'numpy'),
            );
            // The first install is undone before the user answers.
            await syncWorkspaceRequirements(
                serviceContainer,
                REQUIREMENTS_PATH,
                { kind: 'uninstall', packageNames: ['pandas'] },
                installed('numpy'),
            );
            expect(fileSystem.writeFile.called).to.equal(false);

            answer('Enable');
            await new Promise((resolve) => setImmediate(resolve));

            expect(fileContent).to.equal('flask==2.2.0\n# requests removed by Positron\nnumpy  # added by Positron\n');
        });

        test('applies a change directly when "Enable" is chosen while the kernel is queried', async () => {
            let answer: (choice: string | undefined) => void = () => undefined;
            showInformationMessage.returns(new Promise((resolve) => (answer = resolve)));
            updateSetting.callsFake(() => {
                settingValues = { globalValue: true };
                return Promise.resolve();
            });

            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));
            await syncWorkspaceRequirements(
                serviceContainer,
                REQUIREMENTS_PATH,
                { kind: 'install', packageNames: ['numpy'] },
                async () => {
                    answer('Enable');
                    await new Promise((resolve) => setImmediate(resolve));
                    return ['pandas', 'numpy'];
                },
            );

            expect(showInformationMessage.callCount).to.equal(1);
            expect(fileContent).to.equal('flask==2.2.0\npandas  # added by Positron\nnumpy  # added by Positron\n');
        });

        test('respects "Not Now" chosen while the kernel is queried', async () => {
            let answer: (choice: string | undefined) => void = () => undefined;
            showInformationMessage.returns(new Promise((resolve) => (answer = resolve)));

            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));
            await syncWorkspaceRequirements(
                serviceContainer,
                REQUIREMENTS_PATH,
                { kind: 'install', packageNames: ['numpy'] },
                async () => {
                    answer('Not Now');
                    await new Promise((resolve) => setImmediate(resolve));
                    return ['pandas', 'numpy'];
                },
            );

            expect(showInformationMessage.callCount).to.equal(1);
            expect(fileSystem.writeFile.called).to.equal(false);
        });

        test('does not prompt when the change would not edit the file', async () => {
            await syncWorkspaceRequirements(
                serviceContainer,
                REQUIREMENTS_PATH,
                { kind: 'uninstall', packageNames: ['undeclared'] },
                installed('flask'),
            );

            expect(showInformationMessage.called).to.equal(false);
        });

        test('does not prompt for an install the kernel does not confirm', async () => {
            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('flask'));

            expect(showInformationMessage.called).to.equal(false);
        });

        test('does not prompt after "Not Now" in this workspace', async () => {
            dismissed = true;

            await syncWorkspaceRequirements(serviceContainer, REQUIREMENTS_PATH, INSTALL_PANDAS, installed('pandas'));

            expect(showInformationMessage.called).to.equal(false);
        });
    });

    suite('promptToEnable', () => {
        test('"Enable" turns the setting on for the user and applies the change', async () => {
            showInformationMessage.resolves('Enable');

            await promptToEnable(serviceContainer, PENDING_PANDAS());

            expect(updateSetting.calledOnceWith('autoUpdateRequirements', true, vscode.ConfigurationTarget.Global)).to
                .be.true;
            expect(fileContent).to.equal('flask==2.2.0\npandas  # added by Positron\n');
        });

        test('"Enable" applies the change to the file as it is after the prompt', async () => {
            showInformationMessage.callsFake(() => {
                fileContent = 'flask==2.2.0\nnumpy\n';
                return Promise.resolve('Enable');
            });

            await promptToEnable(serviceContainer, PENDING_PANDAS());

            expect(fileContent).to.equal('flask==2.2.0\nnumpy\npandas  # added by Positron\n');
        });

        test('"Not Now" remembers the choice and leaves the file alone', async () => {
            showInformationMessage.resolves('Not Now');

            await promptToEnable(serviceContainer, PENDING_PANDAS());

            expect(dismissed).to.equal(true);
            expect(updateSetting.called).to.equal(false);
            expect(fileSystem.writeFile.called).to.equal(false);
        });

        test('warns instead of rejecting when the setting cannot be saved', async () => {
            showInformationMessage.resolves('Enable');
            updateSetting.rejects(new Error('settings.json is read-only'));

            await promptToEnable(serviceContainer, PENDING_PANDAS());

            expect(showWarningMessage.firstCall.args[0]).to.contain('settings.json is read-only');
            expect(fileSystem.writeFile.called).to.equal(false);
        });

        test('"Enable" still applies later queued changes when one file fails', async () => {
            showInformationMessage.resolves('Enable');
            const otherPath = '/other/requirements.txt';
            fileSystem.readFile.withArgs(otherPath).rejects(new Error('ENOENT: no such file'));

            await promptToEnable(serviceContainer, [
                { requirementsPath: otherPath, change: INSTALL_PANDAS },
                ...PENDING_PANDAS(),
            ]);

            expect(showWarningMessage.firstCall.args[0]).to.contain('ENOENT: no such file');
            expect(fileContent).to.equal('flask==2.2.0\npandas  # added by Positron\n');
        });

        test('closing the prompt changes nothing, so it asks again next time', async () => {
            await promptToEnable(serviceContainer, PENDING_PANDAS());

            expect(dismissed).to.equal(false);
            expect(updateSetting.called).to.equal(false);
            expect(fileSystem.writeFile.called).to.equal(false);
        });
    });
});
