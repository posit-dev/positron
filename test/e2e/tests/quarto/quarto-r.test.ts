/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra';
import { test, expect, tags } from '../_test.setup';
import { join } from 'path';
const path = require('path');
const fs = require('fs-extra');

test.use({
	suiteId: __filename
});

test.describe('Quarto - R', { tag: [tags.WEB, tags.WIN, tags.QUARTO, tags.ARK] }, () => {
	test.beforeAll(async function ({ openFile }) {
		await openFile(path.join('workspaces', 'quarto_basic', 'quarto_basic.qmd'));
	});

	test.afterEach(async function ({ hotKeys, cleanup }) {
		await hotKeys.killAllTerminals();
		await cleanup.removeTestFiles(['quarto_basic.pdf', 'quarto_basic.html', 'quarto_basic.docx']);
	});

	test('Verify Quarto can render html', { tag: [tags.WORKBENCH] }, async function ({ app, runDockerCommand }, testInfo) {
		await renderQuartoDocument(app, 'html');
		await expectFileToExist(app, testInfo, runDockerCommand, 'html');
	});

	test('Verify Quarto can render docx ', { tag: [tags.WORKBENCH] }, async function ({ app, runDockerCommand }, testInfo) {
		await renderQuartoDocument(app, 'docx');
		await expectFileToExist(app, testInfo, runDockerCommand, 'docx');
	});

	test('Verify Quarto can render pdf (LaTeX)', async function ({ app, runDockerCommand }, testInfo) {
		await expect(async () => {
			await renderQuartoDocument(app, 'pdf');
			await expectFileToExist(app, testInfo, runDockerCommand, 'pdf');
		}).toPass({ timeout: 60000 });
	});

	test('Verify Quarto can render pdf (typst)', { tag: [tags.WORKBENCH] }, async function ({ app, runDockerCommand }, testInfo) {
		await renderQuartoDocument(app, 'typst');
		await expectFileToExist(app, testInfo, runDockerCommand, 'pdf');
	});

	test('Verify Quarto can generate preview', async function ({ app }) {
		await app.code.driver.currentPage.getByRole('button', { name: 'Preview' }).click();
		const viewerFrame = app.workbench.viewer.getViewerFrame().frameLocator('iframe');

		// verify preview displays
		await expect(viewerFrame.locator('h1')).toHaveText('Diamond sizes', { timeout: 30000 });
	});

	test('Quarto Shiny App renders correctly', async ({ app, openFile }) => {
		await openFile(join('workspaces', 'quarto_shiny', 'mini-app.qmd'));
		await app.code.driver.currentPage.getByRole('button', { name: 'Preview' }).click();
		await app.code.driver.currentPage
			.frameLocator('iframe[name]')
			.frameLocator('#active-frame')
			.frameLocator('iframe')
			.getByRole('heading', { name: 'Old Faithful' })
			.waitFor({ state: 'visible', timeout: 30000 });
	});
});


type DockerCommandFn = (command: string, description: string) => Promise<{ stdout: string; stderr: string }>;

const renderQuartoDocument = async (app: Application, fileExtension: string) => {
	await test.step(`render quarto document`, async () => {
		await app.workbench.quickaccess.runCommand('quarto.render.document', { keepOpen: true });
		await app.workbench.quickInput.selectQuickInputElementContaining(fileExtension);
	});
};

const expectFileToExist = async (app: Application, testInfo: { project: { name: string } }, runDockerCommand: DockerCommandFn, fileExtension: string) => {
	const dockerCommand = testInfo.project.name === 'e2e-workbench' ? runDockerCommand : undefined;
	await expect(async () => {
		expect(await fileExists(app, `quarto_basic.${fileExtension}`, dockerCommand)).toBe(true);
	}).toPass({ timeout: 20000 });
};

const fileExists = async (app: Application, file: string, runDockerCommand?: DockerCommandFn) => {
	if (runDockerCommand) {
		// Check inside the container at the known workbench workspace path
		const containerPath = `/home/user1/qa-example-content/workspaces/quarto_basic/${file}`;
		try {
			const { stdout } = await runDockerCommand(
				`docker exec test bash -lc 'if test -f "${containerPath}"; then echo FOUND; else echo MISSING; fi'`,
				`Check existence of ${containerPath}`
			);
			return stdout.trim() === 'FOUND';
		} catch {
			return false;
		}
	}

	// Default: check local filesystem for non-workbench projects
	const filePath = path.join(app.workspacePathOrFolder, 'workspaces', 'quarto_basic', file);
	return fs.pathExists(filePath);
};
