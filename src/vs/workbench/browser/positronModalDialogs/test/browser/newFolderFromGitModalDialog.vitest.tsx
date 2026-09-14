/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { NewFolderFromGitModalDialog } from '../../newFolderFromGitModalDialog.js';

describe('NewFolderFromGitModalDialog', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	const renderer = stubInterface<PositronModalReactRenderer>({ onKeyDown: Event.None, onResize: Event.None, dispose: vi.fn() });

	const parentFolder = URI.file('/Users/astrid/projects');

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

	it('reports a folder that already exists instead of silently cloning beside it', async () => {
		const user = userEvent.setup();
		renderDialog(['positron']);

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');

		expect(await screen.findByText('A folder named \'positron\' already exists.')).toBeInTheDocument();
	});

	it('rejects a name that would clone into a subfolder', async () => {
		const user = userEvent.setup();
		renderDialog();

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(folderName());
		await user.type(folderName(), 'forks/positron');

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

	it('creates under the derived name when the field is left empty', async () => {
		const user = userEvent.setup();
		const { createFolder } = renderDialog();

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(folderName());
		await user.click(screen.getByRole('button', { name: 'OK' }));

		// Clearing the field asks for the default back, so the clone lands where it would have
		// without the field, rather than failing for a name the user deliberately gave up.
		expect(createFolder).toHaveBeenCalledWith(expect.objectContaining({ folderName: 'positron' }));
	});

	it('reports a conflict with the derived name while the field is still empty', async () => {
		const user = userEvent.setup();
		renderDialog(['positron']);

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.clear(folderName());

		expect(await screen.findByText('A folder named \'positron\' already exists.')).toBeInTheDocument();
	});

	it('refuses to create a folder that already exists', async () => {
		const user = userEvent.setup();
		const { createFolder } = renderDialog(['positron']);

		await user.type(repoUrl(), 'https://github.com/posit-dev/positron.git');
		await user.click(screen.getByRole('button', { name: 'OK' }));

		expect(createFolder).not.toHaveBeenCalled();
	});
});
