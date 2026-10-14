/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { useEffect } from 'react';
import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { URI } from '../../../../../base/common/uri.js';
import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronReactServices } from '../../../../../base/browser/positronReactServices.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { ILanguageRuntimeService, RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { FolderTemplate } from '../../../../services/positronNewFolder/common/positronNewFolder.js';
import { NewFolderFlowContextProvider, useNewFolderFlowContext } from '../../newFolderFlowContext.js';
import { NewFolderFlowStep } from '../../interfaces/newFolderFlowEnums.js';
import { FolderNameLocationStep } from '../../components/steps/folderNameLocationStep.js';
import { FlowDialogProvider } from '../../components/flowStep.js';
import { CAN_CREATE_FOLDER_IN_COMMAND } from '../../../utils/createFolder.js';

const PARENT_FOLDER = URI.file('/cloud');
const WRITABLE_FOLDER = URI.file('/home/astrid');
const NO_PERMISSION = 'You don\'t have permission to create a folder in this location.';

/**
 * Selects the folder template, which the step cannot set itself. The provider never disposes the
 * state it creates, so the test takes ownership of it here.
 */
const SelectTemplate = (props: { template: FolderTemplate; onState: (state: IDisposable) => void }) => {
	const context = useNewFolderFlowContext();
	useEffect(() => {
		props.onState(context);
		context.folderTemplate = props.template;
		// Set once, when the provider has built the state.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [context]);
	return null;
};

describe('FolderNameLocationStep', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(ILanguageRuntimeService, {
			startupPhase: RuntimeStartupPhase.Complete,
			onDidChangeRuntimeStartupPhase: Event.None,
			onDidRegisterRuntime: Event.None,
			registeredRuntimes: [],
		})
		// The test label service would shorten the location to a path under the home folder.
		.stub(ILabelService, { getUriLabel: (uri: URI) => uri.path })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	/**
	 * Renders the step over a location that exists. The user can always write to WRITABLE_FOLDER,
	 * which also exists.
	 * @param template The folder template.
	 * @param writable The extension host's answer to whether the user can write to the location.
	 */
	function renderStep(template: FolderTemplate, writable: boolean) {
		ctx.instantiationService.stub(IFileService, {
			exists: async (resource: URI) =>
				resource.path === PARENT_FOLDER.path || resource.path === WRITABLE_FOLDER.path,
		});
		const executeCommand = vi.fn(async (commandId: string, folder: URI) =>
			commandId === CAN_CREATE_FOLDER_IN_COMMAND ?
				folder.path === WRITABLE_FOLDER.path || writable :
				undefined
		);
		ctx.instantiationService.stub(ICommandService, {
			executeCommand: executeCommand as unknown as ICommandService['executeCommand'],
		});
		// The state manager reads the services singleton rather than the React context.
		PositronReactServices.services = ctx.reactServices;

		const next = vi.fn();
		const accept = vi.fn();
		rtl.render(
			<NewFolderFlowContextProvider
				initialStep={NewFolderFlowStep.FolderNameLocation}
				parentFolder={PARENT_FOLDER}
			>
				<SelectTemplate template={template} onState={state => ctx.disposables.add(state)} />
				{/* The step renders into a dialog, which reaches into its renderer only for key */}
				{/* and resize events. */}
				<FlowDialogProvider
					dialog={{
						renderer: stubInterface<PositronModalReactRenderer>({ onKeyDown: Event.None, onResize: Event.None }),
						onCancel: vi.fn(),
					}}
				>
					<FolderNameLocationStep accept={accept} back={vi.fn()} cancel={vi.fn()} next={next} />
				</FlowDialogProvider>
			</NewFolderFlowContextProvider>
		);
		return { next, accept, executeCommand };
	}

	const folderName = () => screen.getByRole('textbox', { name: /Enter the name of your new/ });
	const location = () => screen.getByRole('textbox', { name: /Select the location of your new/ });

	it('explains under the location, before Next, that the location is not writable, and disables Next', async () => {
		const user = userEvent.setup();
		const { next } = renderStep(FolderTemplate.PythonProject, false);

		await user.type(folderName(), 'my-project');

		expect(await screen.findByText(NO_PERMISSION)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
		await user.click(screen.getByRole('button', { name: 'Next' }));
		expect(next).not.toHaveBeenCalled();
	});

	it('goes on to the next step when the location is writable', async () => {
		const user = userEvent.setup();
		const { next, executeCommand } = renderStep(FolderTemplate.PythonProject, true);

		await user.type(folderName(), 'my-project');
		await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
		await user.click(screen.getByRole('button', { name: 'Next' }));

		await vi.waitFor(() => expect(next).toHaveBeenCalledWith(NewFolderFlowStep.PythonEnvironment));
		expect(executeCommand).toHaveBeenCalledWith(CAN_CREATE_FOLDER_IN_COMMAND, PARENT_FOLDER);
	});

	it('does not go on to a location that does not exist when Next is pressed before it is validated', async () => {
		const user = userEvent.setup();
		const { next } = renderStep(FolderTemplate.PythonProject, true);
		await user.type(folderName(), 'my-project');
		await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());

		// Pressed straight after the edit, before the debounced location validation runs.
		await user.tripleClick(location());
		await user.paste('/nowhere');
		await user.click(screen.getByRole('button', { name: 'Next' }));

		expect(await screen.findByText(/does not exist/)).toBeInTheDocument();
		expect(next).not.toHaveBeenCalled();
	});

	it('does not check the location again while only the folder name changes', async () => {
		const user = userEvent.setup();
		const { executeCommand } = renderStep(FolderTemplate.PythonProject, true);
		await vi.waitFor(() => expect(executeCommand).toHaveBeenCalledWith(CAN_CREATE_FOLDER_IN_COMMAND, PARENT_FOLDER));
		executeCommand.mockClear();

		await user.type(folderName(), 'my-project');
		// Longer than the location check's debounce.
		await new Promise(resolve => setTimeout(resolve, 300));

		expect(executeCommand).not.toHaveBeenCalledWith(CAN_CREATE_FOLDER_IN_COMMAND, expect.anything());
	});

	it('disables Create for an Empty Project in a location that is not writable', async () => {
		const user = userEvent.setup();
		renderStep(FolderTemplate.EmptyProject, false);

		await user.type(folderName(), 'my-project');

		expect(await screen.findByText(NO_PERMISSION)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
	});

	it('lets the user go on once the location is changed to one they can write to', async () => {
		const user = userEvent.setup();
		const { next } = renderStep(FolderTemplate.PythonProject, false);
		await user.type(folderName(), 'my-project');
		expect(await screen.findByText(NO_PERMISSION)).toBeInTheDocument();

		// Pasted rather than typed: a location of just '/' makes combineLabelWithPathUri throw.
		await user.tripleClick(location());
		await user.paste(WRITABLE_FOLDER.path);

		await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
		expect(screen.queryByText(NO_PERMISSION)).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Next' }));
		await vi.waitFor(() => expect(next).toHaveBeenCalledWith(NewFolderFlowStep.PythonEnvironment));
	});
});
