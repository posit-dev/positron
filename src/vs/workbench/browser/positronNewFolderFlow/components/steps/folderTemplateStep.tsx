/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './folderTemplateStep.css';

// React.
import React, { PropsWithChildren, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { FolderTemplateGroup } from '../folderTemplateGroup.js';
import { checkFolderName } from '../../utilities/folderNameUtils.js';
import { useNewFolderFlowContext } from '../../newFolderFlowContext.js';
import { NewFolderFlowStep } from '../../interfaces/newFolderFlowEnums.js';
import { NewFolderFlowStepProps } from '../../interfaces/newFolderFlowStepProps.js';
import { FolderTemplate } from '../../../../services/positronNewFolder/common/positronNewFolder.js';
import { OKCancelBackNextActionBar } from '../../../positronComponents/positronModalDialog/components/okCancelBackNextActionBar.js';

/**
 * Generates a default folder name in kebab case based on the provided project type.
 *
 * @param projectType - The type of the project for which to generate a default name.
 * @returns The default folder name as a string.
 */
const getDefaultFolderName = (projectType: FolderTemplate) => {
	return localize(
		'positron.newFolderWizard.projectTypeStep.defaultFolderNamePrefix',
		"my"
	) + '-' + projectType.toLowerCase().replace(/\s/g, '-');
};

/**
 * The FolderTemplateStep component is the first step in the New Folder Flow, used to
 * determine the type of folder to create.
 * @param props The NewFolderFlowStepProps
 * @returns The rendered component
 */
export const FolderTemplateStep = (props: PropsWithChildren<NewFolderFlowStepProps>) => {
	// State.
	const context = useNewFolderFlowContext();

	// Hooks.
	const [selectedProjectType, setSelectedProjectType] = useState(context.folderTemplate);

	// Set the projectType and initialize the default project name if applicable,
	// then navigate to the ProjectNameLocation step.
	const nextStep = async () => {
		if (!selectedProjectType) {
			// If no project type is selected, return. This shouldn't happen since the Next button should
			// be disabled if no project type is selected.
			return;
		}
		// If the project type has changed or the project name is empty, initialize the project name.
		if (
			context.folderTemplate !== selectedProjectType ||
			context.folderName === ''
		) {
			const defaultProjectName = getDefaultFolderName(selectedProjectType);
			context.folderTemplate = selectedProjectType;
			context.folderName = defaultProjectName;
			context.folderNameFeedback = await checkFolderName(
				defaultProjectName,
				context.parentFolder,
				context.services.fileService
			);
		}
		props.next(NewFolderFlowStep.FolderNameLocation);
	};

	// Render.
	return (
		<div className='folder-template-selection-step'>
			<div
				className='folder-template-selection-step-title'
				id='folder-template-selection-step-title'
			>
				{(() =>
					localize(
						'positron.folderTemplate',
						"Folder Template"
					))()}
			</div>
			<FolderTemplateGroup
				describedBy='folder-template-selection-step-description'
				labelledBy='folder-template-selection-step-title'
				name='projectType'
				selectedFolderTemplate={selectedProjectType}
				onSelectionChanged={(projectType) =>
					setSelectedProjectType(projectType)
				}
			/>
			<OKCancelBackNextActionBar
				cancelButtonConfig={{
					onClick: props.cancel,
				}}
				nextButtonConfig={{
					onClick: nextStep,
					disable: !selectedProjectType,
				}}
			/>
		</div>
	);
};
