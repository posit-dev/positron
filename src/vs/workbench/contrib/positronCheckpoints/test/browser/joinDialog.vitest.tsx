/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IFileDialogService, IOpenDialogOptions } from '../../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { showJoinDialog } from '../../browser/components/joinDialog.js';
import { IGitHubClient, parseProjectLink } from '../../browser/github/githubClient.js';
import { FORBIDDEN_WORDS } from '../../common/forbiddenWords.js';

const PARENT = URI.file('/home/maya/projects');

describe('JoinDialog', () => {
	let showOpenDialog: ReturnType<typeof vi.fn<(options: IOpenDialogOptions) => Promise<URI[] | undefined>>>;
	let executeCommand: ReturnType<typeof vi.fn<(id: string, ...args: unknown[]) => Promise<unknown>>>;
	let existing: Set<string>;

	const ctx = createTestContainer()
		.withReactServices()
		.stub(IGitHubClient, { parseProjectLink })
		.stub(IFileDialogService, {
			showOpenDialog: (options: IOpenDialogOptions) => showOpenDialog(options),
			defaultFolderPath: async () => URI.file('/home/maya'),
		})
		.stub(IFileService, { exists: async (resource: URI) => existing.has(resource.path) })
		.stub(ICommandService, { executeCommand: (id: string, ...args: unknown[]) => executeCommand(id, ...args) })
		.build();

	beforeEach(() => {
		existing = new Set();
		showOpenDialog = vi.fn(async () => [PARENT]);
		executeCommand = vi.fn(async () => '/home/maya/projects/dose-model');
		// PositronModalReactRenderer finds its container through this singleton.
		PositronReactServices.services = ctx.reactServices;
	});

	afterEach(async () => {
		// A dialog renders through its own renderer, which outlives RTL's cleanup.
		const close = screen.queryByRole('button', { name: 'Cancel' }) ?? screen.queryByRole('button', { name: 'Close' });
		if (close) {
			await userEvent.click(close);
		}
	});

	async function openDialog() {
		showJoinDialog();
		const user = userEvent.setup();
		const dialog = await screen.findByRole('dialog');
		return { user, dialog };
	}

	async function join(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, link: string) {
		await user.type(within(dialog).getByRole('textbox', { name: 'Link to the project' }), link);
		await user.click(within(dialog).getByRole('button', { name: 'Continue' }));
	}

	function expectNoGitWords(dialog: HTMLElement) {
		expect(dialog).not.toHaveTextContent(FORBIDDEN_WORDS);
	}

	test('the dialog asks for the link and cannot continue without one', async () => {
		const { dialog } = await openDialog();

		expect(within(dialog).getByText('Paste the link to the project.')).toBeInTheDocument();
		expect(within(dialog).getByRole('button', { name: 'Continue' })).toBeDisabled();
		expectNoGitWords(dialog);
	});

	test('text that is not a project link says so and opens no folder picker', async () => {
		const { user, dialog } = await openDialog();

		await join(user, dialog, 'not a link');

		expect(await within(dialog).findByText('That is not a link to a GitHub project. Paste a link such as https://github.com/owner/project, or owner/project.')).toBeInTheDocument();
		expect(showOpenDialog).not.toHaveBeenCalled();
		expect(executeCommand).not.toHaveBeenCalled();
		expectNoGitWords(dialog);
	});

	test('a link picks a parent folder and copies the project there with the clone command', async () => {
		const { user, dialog } = await openDialog();

		await join(user, dialog, 'https://github.com/maya/dose-model');

		// The finished dialog replaces the one that asked for the link.
		const ready = await screen.findByRole('dialog');
		expect(await within(ready).findByText('dose-model is ready.')).toBeInTheDocument();
		expect(within(ready).getByRole('button', { name: 'Close' })).toBeInTheDocument();
		expect(showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Choose where to put the project',
			canSelectFolders: true,
			canSelectFiles: false,
			canSelectMany: false,
			defaultUri: URI.file('/home/maya'),
		}));
		expect(executeCommand).toHaveBeenCalledWith('git.clone', 'https://github.com/maya/dose-model.git', PARENT.fsPath);
		expectNoGitWords(ready);
	});

	test('owner/name and the ssh form are accepted', async () => {
		const { user, dialog } = await openDialog();

		await join(user, dialog, 'git@github.com:maya/dose-model.git');

		expect(await screen.findByText('dose-model is ready.')).toBeInTheDocument();
		expect(executeCommand).toHaveBeenCalledWith('git.clone', 'https://github.com/maya/dose-model.git', PARENT.fsPath);
	});

	test('a cancelled folder picker copies nothing and keeps the link', async () => {
		showOpenDialog.mockResolvedValueOnce(undefined);
		const { user, dialog } = await openDialog();

		await join(user, dialog, 'maya/dose-model');

		await vi.waitFor(() => expect(showOpenDialog).toHaveBeenCalled());
		expect(executeCommand).not.toHaveBeenCalled();
		expect(within(dialog).getByRole('textbox', { name: 'Link to the project' })).toHaveValue('maya/dose-model');
	});

	test('a folder with that name is never written into, and the person can choose another place', async () => {
		existing.add('/home/maya/projects/dose-model');
		const { user, dialog } = await openDialog();

		await join(user, dialog, 'maya/dose-model');

		expect(await within(dialog).findByText(`There is already a folder named dose-model in ${PARENT.fsPath}. Choose another location.`)).toBeInTheDocument();
		expect(executeCommand).not.toHaveBeenCalled();

		showOpenDialog.mockResolvedValueOnce([URI.file('/home/maya/other')]);
		await user.click(within(dialog).getByRole('button', { name: 'Continue' }));

		expect(await screen.findByText('dose-model is ready.')).toBeInTheDocument();
		expect(executeCommand).toHaveBeenCalledWith('git.clone', 'https://github.com/maya/dose-model.git', URI.file('/home/maya/other').fsPath);
	});

	test('a copy that fails and leaves no folder says nothing was changed and keeps the link', async () => {
		executeCommand.mockResolvedValueOnce(undefined);
		const { user, dialog } = await openDialog();

		await join(user, dialog, 'maya/dose-model');

		expect(await within(dialog).findByText('Positron could not copy this project. Check the link, and check that maya has invited you to it. Nothing was changed on this computer.')).toBeInTheDocument();
		expect(within(dialog).getByRole('textbox', { name: 'Link to the project' })).toHaveValue('maya/dose-model');
		expectNoGitWords(dialog);
	});

	test('a clone command that throws is a failed copy', async () => {
		executeCommand.mockRejectedValueOnce(new Error('git exploded'));
		const { user, dialog } = await openDialog();

		await join(user, dialog, 'maya/dose-model');

		expect(await within(dialog).findByText(/Positron could not copy this project\. Check the link/)).toBeInTheDocument();
	});

	test('a failed copy that leaves a folder behind does not claim nothing was changed', async () => {
		executeCommand.mockImplementationOnce(async () => {
			existing.add('/home/maya/projects/dose-model');
			return undefined;
		});
		const { user, dialog } = await openDialog();

		await join(user, dialog, 'maya/dose-model');

		expect(await within(dialog).findByText(`Positron could not copy this project, and a partly copied folder remains at ${URI.file('/home/maya/projects/dose-model').fsPath}. Delete that folder before you try again.`)).toBeInTheDocument();
		expect(dialog).not.toHaveTextContent('Nothing was changed');
	});

	test('the dialog makes no GitHub request of its own', async () => {
		const { user, dialog } = await openDialog();

		await join(user, dialog, 'maya/dose-model');
		expect(await screen.findByText('dose-model is ready.')).toBeInTheDocument();

		// The stubbed client has no createRepository or invite, so any call would have thrown.
		expect(executeCommand).toHaveBeenCalledTimes(1);
	});
});
