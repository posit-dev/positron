/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './rConfigurationStep.css';

// React.
import React, { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { useNewProjectWizardContext } from '../../newProjectWizardContext.js';
import { NewProjectWizardStepProps } from '../../interfaces/newProjectWizardStepProps.js';
import { localize } from '../../../../../nls.js';
import { PositronWizardStep } from '../wizardStep.js';
import { PositronWizardSubStep } from '../wizardSubStep.js';
import { DropDownListBox } from '../../../positronComponents/dropDownListBox/dropDownListBox.js';
import { Checkbox } from '../../../positronComponents/positronModalDialog/components/checkbox.js';
import { InterpreterEntry } from './interpreterEntry.js';
import { interpretersToDropdownItems } from '../../utilities/interpreterDropDownUtils.js';
import { ExternalLink } from '../../../../../base/browser/ui/ExternalLink/ExternalLink.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { WizardFormattedText, WizardFormattedTextType } from '../wizardFormattedText.js';

// NOTE: If you are making changes to this file, the equivalent Python component may benefit from
// similar changes. See src/vs/workbench/browser/positronNewProjectWizard/components/steps/pythonEnvironmentStep.tsx

/**
 * The RConfigurationStep component is specific to R projects in the new project wizard.
 * @param props The NewProjectWizardStepProps
 * @returns The rendered component
 */
export const RConfigurationStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	// State.
	const context = useNewProjectWizardContext();
	const {
		keybindingService,
		languageRuntimeService,
		layoutService,
		logService,
		openerService,
	} = context.services;

	// Hooks.
	const [interpreters, setInterpreters] = useState(context.interpreters);
	const [selectedInterpreter, setSelectedInterpreter] = useState(context.selectedRuntime);
	const [preferredInterpreter, setPreferredInterpreter] = useState(context.preferredInterpreter);
	const [minimumRVersion, setMinimumRVersion] = useState(context.minimumRVersion);

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onUpdateInterpreterState event handler and update the component state.
		disposableStore.add(context.onUpdateInterpreterState(() => {
			setInterpreters(context.interpreters);
			setSelectedInterpreter(context.selectedRuntime);
			setPreferredInterpreter(context.preferredInterpreter);
			setMinimumRVersion(context.minimumRVersion);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [context]);

	// Utility functions.
	const interpretersAvailable = () => Boolean(interpreters && interpreters.length);
	const interpretersLoading = () => !interpreters;

	// Handler for when the interpreter is selected.
	const onInterpreterSelected = (identifier: string) => {
		// Update the selected interpreter.
		const selectedRuntime = languageRuntimeService.getRegisteredRuntime(identifier);
		if (!selectedRuntime) {
			// This shouldn't happen, since the DropDownListBox should only allow selection of registered
			// runtimes
			logService.error(`No R runtime found for identifier: ${identifier}`);
			return;
		}
		context.selectedRuntime = selectedRuntime;
	};

	// Construct the interpreter dropdown title.
	const interpreterDropdownTitle = () => {
		// If interpreters is undefined, show a loading message.
		if (!interpreters) {
			return localize(
				'rConfigurationStep.versionSubStep.dropDown.title.loading',
				"Discovering R versions..."
			);
		}

		// If interpreters is empty, show a message that no interpreters were found.
		if (!interpretersAvailable()) {
			return localize(
				'rConfigurationStep.versionSubStep.dropDown.title.noInterpreters',
				"No interpreters found."
			);
		}

		// Otherwise, show the default title.
		return localize(
			'rConfigurationStep.versionSubStep.dropDown.title',
			"Select a version of R"
		);
	};

	// Render.
	return (
		<PositronWizardStep
			backButtonConfig={{ onClick: props.back }}
			cancelButtonConfig={{ onClick: props.cancel }}
			okButtonConfig={{
				onClick: props.accept,
				title: (() => localize(
					'positronNewProjectWizard.createButtonTitle',
					"Create"
				))(),
				disable: !selectedInterpreter
			}}
			title={(() => localize(
				'rConfigurationStep.title',
				"Set up project configuration"
			))()}
		>
			<PositronWizardSubStep
				description={(() =>
					localize(
						'rConfigurationStep.versionSubStep.description',
						'Select a version of R to launch your project with.'
					))()}
				feedback={
					!interpretersLoading() && !interpretersAvailable() ? (
						<WizardFormattedText
							type={WizardFormattedTextType.Warning}
						>
							{(() =>
								localize(
									'rConfigurationStep.versionSubStep.feedback.noSuitableInterpreters',
									'No suitable interpreters found. Please install R version {0} or later.',
									minimumRVersion
								))()}
						</WizardFormattedText>
					) : undefined
				}
				title={(() =>
					localize(
						'rConfigurationStep.versionSubStep.title',
						'R Version'
					))()}
			>
				<DropDownListBox
					createItem={(item) => (
						<InterpreterEntry
							interpreterInfo={item.options.value}
						/>
					)}
					disabled={!interpretersAvailable()}
					entries={
						interpretersAvailable()
							? interpretersToDropdownItems(
								interpreters!,
								preferredInterpreter?.runtimeId
							)
							: []
					}
					keybindingService={keybindingService}
					layoutService={layoutService}
					selectedIdentifier={selectedInterpreter?.runtimeId}
					title={interpreterDropdownTitle()}
					onSelectionChanged={(item) =>
						onInterpreterSelected(item.options.identifier)
					}
				/>
			</PositronWizardSubStep>
			<PositronWizardSubStep
				title={(() =>
					localize(
						'rConfigurationStep.advancedConfigSubStep.title',
						"Advanced Configuration"
					))()}
			>
				<div className='renv-configuration'>
					<Checkbox
						initialChecked={context.useRenv}
						label={(() =>
							localize(
								'rConfigurationStep.additionalConfigSubStep.useRenv.label',
								"Use `renv` to create a reproducible environment"
							))()}
						onChanged={(checked) => (context.useRenv = checked)}
					/>
					<ExternalLink
						className='renv-docs-external-link'
						href='https://rstudio.github.io/renv/articles/renv.html'
						openerService={openerService}
						title='https://rstudio.github.io/renv/articles/renv.html'
					>
						<div className='codicon codicon-link-external' />
					</ExternalLink>
				</div>
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
