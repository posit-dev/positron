/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./newProjectModalDialog';
const React = require('react');
import { localize } from 'vs/nls';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronModalDialog } from 'vs/base/browser/ui/positronModalDialog/positronModalDialog';
import { PositronModalReactRenderer } from 'vs/base/browser/ui/positronModalReactRenderer/positronModalReactRenderer';
import { NewProjectWizardContextProvider } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardContext';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { NewProjectConfiguration } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardState';
import { NewProjectWizardStepContainer } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectWizardStepContainer';
import { IRuntimeStartupService } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';

/**
 * Shows the NewProjectModalDialog.
 * @param accessor The services accessor.
 * @returns A promise that resolves when the dialog is dismissed.
 */
export const showNewProjectModalDialog = async (accessor: ServicesAccessor): Promise<NewProjectConfiguration | undefined> => {
	// Get the services we need for the dialog.
	const services = {
		fileDialogService: accessor.get(IFileDialogService),
		workbenchLayoutService: accessor.get(IWorkbenchLayoutService),
		languageRuntimeService: accessor.get(ILanguageRuntimeService),
		runtimeSessionService: accessor.get(IRuntimeSessionService),
		runtimeStartupService: accessor.get(IRuntimeStartupService)
	};

	// Return a promise that resolves when the dialog is done.
	return new Promise<NewProjectConfiguration | undefined>((resolve) => {
		// Create the modal React renderer.
		const positronModalReactRenderer =
			new PositronModalReactRenderer(services.workbenchLayoutService.mainContainer);

		// The new project modal dialog component.
		const NewProjectModalDialog = () => {
			// The accept handler.
			const acceptHandler = (projectConfig: NewProjectConfiguration) => {
				positronModalReactRenderer.dispose();
				resolve(projectConfig);
			};

			// The cancel handler.
			const cancelHandler = () => {
				positronModalReactRenderer.dispose();
				resolve(undefined);
			};

			// Render.
			return (
				<PositronModalDialog
					renderer={positronModalReactRenderer}
					width={700} height={500}
					title={localize('positronNewProjectWizard.title', "Create New Project")}
					// accept={acceptHandler}
					cancel={cancelHandler}
				>
					<NewProjectWizardContextProvider services={services}>
						<NewProjectWizardStepContainer cancel={cancelHandler} accept={acceptHandler} />
					</NewProjectWizardContextProvider>
				</PositronModalDialog>
			);
		};

		// Render the modal dialog component.
		positronModalReactRenderer.render(<NewProjectModalDialog />);
	});
};
