/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { FlowButton, FolderTemplate } from '../../infra';
import { test, tags, expect } from '../_test.setup';
import { addRandomNumSuffix, createNewFolder, verifyCondaEnvStarts, verifyCondaFilesArePresent, verifyConsoleReady, verifyFolderCreation, verifyGitFilesArePresent, verifyGitStatus, verifyUvEnvStarts, verifyVenvEnvStarts, verifyPyprojectTomlCreated, verifyPyprojectTomlNotCreated } from './helpers/new-folder-flow.js';

test.use({
	suiteId: __filename
});

// Not running conda test on windows because conda reeks havoc on selecting the correct python interpreter
test.describe('New Folder Flow: Python Project', {
	tag: [tags.MODAL, tags.NEW_FOLDER_FLOW, tags.WEB]
}, () => {
	const folderTemplate = FolderTemplate.PYTHON_PROJECT;

	// Base interpreter to build new venvs on. The primary interpreter
	// (POSITRON_PY_VER_SEL) is a uv-managed base on some runners (e.g. Linux),
	// which would classify the resulting environment as uv instead of venv. The
	// alternate interpreter is a non-uv global (pyenv / setup-python) on every
	// runner. Its path embeds the full patch version, whereas uv base paths carry
	// only major.minor (e.g. cpython-3.13-linux), so matching the patch version
	// string via selectInterpreterByPath selects it and never a uv base.
	const venvBaseInterpreter = process.env.POSITRON_PY_ALT_VER_SEL;

	test.beforeAll(async function ({ settings }) {
		await settings.set({ 'interpreters.startupBehavior': 'auto' }, { waitMs: 1000 });
	});

	test('Existing env: ipykernel already installed', { tag: [tags.WIN], }, async function ({ app, sessions, python, settings }) {
		const folderName = addRandomNumSuffix('ipykernel-installed');

		await createNewFolder(app, {
			folderTemplate,
			folderName,
			status: 'existing',
			ipykernelFeedback: 'hide',
			interpreterPath: (await sessions.getSelectedSessionInfo()).path,
			createPyprojectToml: false,
		});

		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
		await verifyPyprojectTomlNotCreated(app);
	});

	// untagged windows because we cannot find any way to copy text from the terminal now that its a canvas
	// passing in python to ensure a valid version is used
	test('New env: Git initialized', { tag: [tags.CRITICAL] }, async function ({ app, settings, python }) {
		const folderName = addRandomNumSuffix('git-init');
		await settings.set({ 'files.exclude': { '**/.git': false, '**/.gitignore': false } }, { waitMs: 1000 });

		await createNewFolder(app, {
			folderTemplate,
			folderName,
			initGitRepo: true,
			status: 'new',
			pythonEnv: 'venv',
			interpreterPath: venvBaseInterpreter,
			createPyprojectToml: true,
		});

		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
		await verifyGitFilesArePresent(app);
		await verifyVenvEnvStarts(app);
		await verifyGitStatus(app);
		await verifyPyprojectTomlCreated(app);
	});

	test('New env: Conda environment', async function ({ app }) {
		const folderName = addRandomNumSuffix('conda-installed');
		await createNewFolder(app, {
			folderTemplate,
			folderName,
			status: 'new',
			pythonEnv: 'conda', // test relies on conda already installed on machine
			createPyprojectToml: true,
		});

		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
		await verifyCondaFilesArePresent(app);
		await verifyCondaEnvStarts(app);
		await verifyPyprojectTomlCreated(app);
	});

	// passing in python to ensure a valid version is used
	test('New env: Venv environment', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app, python }) {
		const folderName = addRandomNumSuffix('new-venv');

		await createNewFolder(app, {
			folderTemplate,
			folderName,
			status: 'new',
			pythonEnv: 'venv',
			interpreterPath: venvBaseInterpreter,
			createPyprojectToml: false,
		});

		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
		await verifyVenvEnvStarts(app);
		await verifyPyprojectTomlNotCreated(app);
	});

	test('New env: interpreter dropdown orders by category, not alphabetically', { tag: [tags.INTERPRETER] }, async function ({ app, python }) {
		const folderName = addRandomNumSuffix('venv-category-order');

		await createNewFolder(app, {
			folderTemplate,
			folderName,
			status: 'new',
			pythonEnv: 'venv',
			interpreterPath: venvBaseInterpreter,
			createPyprojectToml: false,
		});

		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
		await verifyVenvEnvStarts(app);

		// Open a second New Folder Flow dialog on top of the just-created project (still
		// the active workspace). Its interpreter dropdown for "Use an existing environment"
		// lists every registered Python runtime, unfiltered, ordered by category (Project ->
		// Global -> Base -> Externally Managed -- see _getFilteredInterpreters in
		// newFolderFlowState.ts). The project .venv just created above now categorizes as
		// "Project Environments" (it's under the open workspace folder) and must sort ahead
		// of the base interpreter that seeded it, even though alphabetically the base
		// interpreter's manager token (e.g. "pyenv") often precedes "venv". Cancel out
		// without creating a second folder.
		await app.workbench.quickaccess.runCommand('positron.workbench.action.newFolderFromTemplate', { keepOpen: false });
		await app.workbench.newFolderFlow.setFolderTemplate(folderTemplate);
		await app.workbench.newFolderFlow.setFolderNameLocation({
			folderTemplate,
			folderName: addRandomNumSuffix('unused'),
			createPyprojectToml: false,
		});
		await app.workbench.newFolderFlow.selectExistingEnvironment();

		const order = await app.workbench.newFolderFlow.getInterpreterDropdownOrder();
		await app.workbench.newFolderFlow.clickFlowButton(FlowButton.CANCEL);

		const categoryRank: Record<string, number> = {
			'Project Environments': 0,
			'Global Environments': 1,
			'Base Interpreters': 2,
			'Externally Managed': 3,
		};

		const ranks = order
			.map(entry => categoryRank[entry.group])
			.filter((rank): rank is number => rank !== undefined);
		expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

		expect(order.some(entry => entry.group === 'Project Environments')).toBe(true);
	});

	test('New env: uv environment', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app }) {
		const folderName = addRandomNumSuffix('new-uv');

		await createNewFolder(app, {
			folderTemplate,
			folderName,
			status: 'new',
			pythonEnv: 'uv',  // test relies on uv already installed on machine
			createPyprojectToml: true,
		});

		await verifyFolderCreation(app, folderName);
		await verifyConsoleReady(app, folderTemplate);
		await verifyUvEnvStarts(app);
		await verifyPyprojectTomlCreated(app);
	});
});
