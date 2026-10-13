/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { CommandsRegistry, ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { NewFolderFromGitModalDialog } from '../../newFolderFromGitModalDialog.js';

describe('NewFolderFromGitModalDialog', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const renderer = stubInterface<PositronModalReactRenderer>({ onKeyDown: Event.None, onResize: Event.None, dispose: vi.fn() });

	const parentFolder = URI.file('/Users/astrid/projects');

	// The Git extension registers 'git.clone' only when it finds Git.
	let gitClone: IDisposable | undefined;
	function registerGitClone() {
		gitClone = CommandsRegistry.registerCommand('git.clone', () => { });
	}
	afterEach(() => {
		gitClone?.dispose();
		gitClone = undefined;
	});

	/**
	 * Renders the dialog over a parent folder that holds the given folder names, so a test can set
	 * up the collision it wants to see reported.
	 */
	function renderDialog(existingFolders: readonly string[] = []) {
		const createFolder = vi.fn().mockResolvedValue(undefined);
		ctx.instantiationService.stub(IFileService, {
			exists: async (resource: URI) =>
				existingFolders.some(name => resource.path === `${parentFolder.path}/${name}`),
		});
		registerGitClone();
		rtl.render(
			<NewFolderFromGitModalDialog
				createFolder={createFolder}
				parentFolder={parentFolder}
				renderer={renderer}
			/>
		);
		return { createFolder };
	}

	const repoUrl = () => screen.getByLabelText('Git repository URL');
	const folderName = () => screen.getByLabelText('Folder name');

	it('fills the folder name in from the repository URL', async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');

		expect(folderName()).toHaveValue('positron');
	});

	it('keeps the folder name following the URL until the user names it', async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(repoUrl());
		await user.type(repoUrl(), 'https://github.com/posit-dev/ark.git');

		expect(folderName()).toHaveValue('ark');
	});

	it('leaves a name the user typed alone when the URL changes', async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(folderName());
		await user.type(folderName(), 'positron-fork');
		await user.type(repoUrl(), '/');

		expect(folderName()).toHaveValue('positron-fork');
	});

	it('hands the name back to the URL when the field is emptied', async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(folderName());
		await user.type(folderName(), 'positron-fork');
		await user.clear(folderName());
		await user.clear(repoUrl());
		await user.type(repoUrl(), 'https://github.com/posit-dev/ark.git');

		expect(folderName()).toHaveValue('ark');
	});

	it('shows no error under the field for a name that collides, even once validation has had time to run', async () => {
		const user = userEvent.setup();
		renderDialog(['positron']);

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');

		// Outlast a debounced validator's delay before asserting its absence, so the test would
		// catch an inline error appearing late rather than just outrunning it.
		await new Promise(resolve => setTimeout(resolve, 200));
		expect(screen.queryByText('A folder named \'positron\' already exists.')).not.toBeInTheDocument();
	});

	it('shows the collision error at the bottom of the dialog once the user presses OK', async () => {
		const user = userEvent.setup();
		renderDialog(['positron']);

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.click(screen.getByRole('button', { name: 'OK' }));

		expect(await screen.findByText('A folder named \'positron\' already exists.')).toBeInTheDocument();
	});

	it('shows no error under the field for a name with a path separator, even once validation has had time to run', async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(folderName());
		await user.type(folderName(), 'forks/positron');

		// Outlast a debounced validator's delay before asserting its absence, so the test would
		// catch an inline error appearing late rather than just outrunning it.
		await new Promise(resolve => setTimeout(resolve, 200));
		expect(screen.queryByText('A folder name cannot contain a path separator.')).not.toBeInTheDocument();
	});

	it('shows the path separator error at the bottom of the dialog once the user presses OK', async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(folderName());
		await user.type(folderName(), 'forks/positron');
		await user.click(screen.getByRole('button', { name: 'OK' }));

		expect(await screen.findByText('A folder name cannot contain a path separator.')).toBeInTheDocument();
	});

	it('creates the folder under the name the user typed', async () => {
		const user = userEvent.setup();
		const { createFolder } = renderDialog();

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(folderName());
		await user.type(folderName(), 'positron-fork');
		await user.click(screen.getByRole('button', { name: 'OK' }));

		expect(createFolder).toHaveBeenCalledWith(expect.objectContaining({
			repo: 'https://github.com/posit-dev/positron.git',
			folderName: 'positron-fork',
		}));
	});

	it('shows a required-field error for an empty name instead of falling back to the one the URL implies', async () => {
		const user = userEvent.setup();
		const { createFolder } = renderDialog();

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(folderName());
		await user.click(screen.getByRole('button', { name: 'OK' }));

		// An empty field used to clone under the name the URL implies, invisibly to the user. It is
		// invalid on its own now, so the folder is never created under a name never seen on screen.
		expect(createFolder).not.toHaveBeenCalled();
		expect(await screen.findByText('A folder name is required.')).toBeInTheDocument();
	});

	it('shows a required-field error for a whitespace-only name, same as for an empty one', async () => {
		const user = userEvent.setup();
		const { createFolder } = renderDialog();

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(folderName());
		await user.type(folderName(), '   ');
		await user.click(screen.getByRole('button', { name: 'OK' }));

		expect(createFolder).not.toHaveBeenCalled();
		expect(await screen.findByText('A folder name is required.')).toBeInTheDocument();
	});

	it('keeps following the URL when the name is only whitespace', async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(folderName());
		await user.type(folderName(), '   ');
		await user.clear(repoUrl());
		await user.type(repoUrl(), 'https://github.com/posit-dev/ark.git');

		expect(folderName()).toHaveValue('ark');
	});

	it('shows a required-field error for an empty name instead of checking the URL-derived name for a collision', async () => {
		const user = userEvent.setup();
		const { createFolder } = renderDialog(['positron']);

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(folderName());
		await user.click(screen.getByRole('button', { name: 'OK' }));

		expect(createFolder).not.toHaveBeenCalled();
		expect(await screen.findByText('A folder name is required.')).toBeInTheDocument();
		expect(screen.queryByText('A folder named \'positron\' already exists.')).not.toBeInTheDocument();
	});

	it('reports a failed clone as an error notification once the dialog is gone', async () => {
		const user = userEvent.setup();
		const error = vi.fn();
		ctx.instantiationService.stub(INotificationService, { error });
		const { createFolder } = renderDialog();
		createFolder.mockRejectedValue(new Error('command \'git.clone\' not found'));

		// A URL can carry credentials, so the notification must not repeat it.
		await user.type(repoUrl(), 'https://astrid:secret-token@github.com/posit-dev/positron.git');
		await user.click(screen.getByRole('button', { name: 'OK' }));

		await vi.waitFor(() => expect(error).toHaveBeenCalledWith(
			'Could not clone the repository: command \'git.clone\' not found'
		));
	});

	it('refuses to create a folder that already exists', async () => {
		const user = userEvent.setup();
		const { createFolder } = renderDialog(['positron']);

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.click(screen.getByRole('button', { name: 'OK' }));

		expect(createFolder).not.toHaveBeenCalled();
	});
	describe('when Git cannot clone', () => {
		/**
		 * Renders the dialog with the Git extension in the given state. Activation waits on
		 * `activated`, so a test can look at the dialog before the Git extension is ready.
		 */
		function renderWithGit(options: { gitEnabled?: boolean; gitMissing?: boolean; activated?: Promise<void> }) {
			const executeCommand = vi.fn().mockResolvedValue(undefined);
			ctx.instantiationService.stub(ICommandService, { executeCommand });
			ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({ git: { enabled: options.gitEnabled ?? true } }));
			ctx.instantiationService.stub(IContextKeyService, {
				getContextKeyValue: <T,>(key: string) => (key === 'git.missing' ? options.gitMissing : undefined) as T | undefined,
			});
			ctx.instantiationService.stub(IExtensionService, {
				activateById: () => options.activated ?? Promise.resolve(),
			});
			rtl.render(
				<NewFolderFromGitModalDialog
					createFolder={vi.fn()}
					parentFolder={parentFolder}
					renderer={renderer}
				/>
			);
			return { executeCommand };
		}

		it('opens straight to the form when Git is already available', () => {
			registerGitClone();
			renderWithGit({ activated: new Promise(() => { }) });

			expect(repoUrl()).toBeInTheDocument();
			expect(screen.queryByText('Checking for Git...')).not.toBeInTheDocument();
		});

		it('shows a checking state, then the form once the Git extension finds Git', async () => {
			let activate!: () => void;
			renderWithGit({ activated: new Promise<void>(resolve => { activate = resolve; }) });

			expect(screen.getByText('Checking for Git...')).toBeInTheDocument();
			expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();

			await act(async () => {
				registerGitClone();
				activate();
			});

			expect(await screen.findByLabelText('Git repository URL')).toBeInTheDocument();
		});

		it('explains that Git was not found, with the git.path setting in code font', async () => {
			const user = userEvent.setup();
			const { executeCommand } = renderWithGit({ gitMissing: true });

			expect(await screen.findByText('Git was not found.')).toBeInTheDocument();
			expect(screen.getByText('git.path', { selector: 'code' })).toBeInTheDocument();
			expect(screen.queryByLabelText('Git repository URL')).not.toBeInTheDocument();
			await user.click(screen.getByRole('button', { name: 'OK' }));

			// The dialog blocks the rest of the window, so it offers no fix of its own; OK closes it.
			expect(renderer.dispose).toHaveBeenCalled();
			expect(executeCommand).not.toHaveBeenCalled();
		});

		it('explains that Git is turned off, and closes itself to open the setting', async () => {
			const user = userEvent.setup();
			const { executeCommand } = renderWithGit({ gitEnabled: false });

			expect(screen.getByText('Git is turned off.')).toBeInTheDocument();
			await user.click(screen.getByRole('button', { name: 'Open Settings' }));

			// The dialog would otherwise cover the Settings editor.
			expect(renderer.dispose).toHaveBeenCalled();
			expect(executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', 'git.enabled');
		});

		it('says the Git extension is not ready when it never registers its commands', async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			try {
				renderWithGit({});

				await act(async () => {
					await vi.advanceTimersByTimeAsync(3000);
				});

				expect(screen.getByText('The Git extension is not ready.')).toBeInTheDocument();
				expect(screen.queryByRole('button', { name: 'Reload Window' })).not.toBeInTheDocument();
			} finally {
				vi.useRealTimers();
			}
		});
	});
});
