/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// React.
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react';  // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { useNewProjectWizardContext } from 'vs/workbench/browser/positronNewProjectWizard/newProjectWizardContext';
import { NewProjectWizardStepProps } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectWizardStepProps';
import { localize } from 'vs/nls';
import { RuntimeStartupPhase } from 'vs/workbench/services/runtimeStartup/common/runtimeStartupService';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronWizardStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardStep';
import { PositronWizardSubStep } from 'vs/workbench/browser/positronNewProjectWizard/components/wizardSubStep';
import { DropDownListBox } from 'vs/workbench/browser/positronComponents/dropDownListBox/dropDownListBox';
import { Checkbox } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/checkbox';
import { getRInterpreterEntries, getSelectedRInterpreterId } from 'vs/workbench/browser/positronNewProjectWizard/utilities/rConfigurationStepUtils';
import { InterpreterEntry } from 'vs/workbench/browser/positronNewProjectWizard/components/steps/pythonInterpreterEntry';

/**
 * The RConfigurationStep component is specific to R projects in the new project wizard.
 * @param props The NewProjectWizardStepProps
 * @returns The rendered component
 */
export const RConfigurationStep = (props: PropsWithChildren<NewProjectWizardStepProps>) => {
	// Retrieve the wizard state and project configuration.
	const newProjectWizardState = useNewProjectWizardContext();
	const setProjectConfig = newProjectWizardState.setProjectConfig;
	const projectConfig = newProjectWizardState.projectConfig;
	const keybindingService = newProjectWizardState.keybindingService;
	const layoutService = newProjectWizardState.layoutService;
	const logService = newProjectWizardState.logService;
	const runtimeStartupService = newProjectWizardState.runtimeStartupService;
	const languageRuntimeService = newProjectWizardState.languageRuntimeService;

	// Hooks to manage the startup phase and interpreter entries.
	const [startupPhase, setStartupPhase] = useState(runtimeStartupService.startupPhase);
	const [selectedInterpreter, setSelectedInterpreter] = useState<string | undefined>(
		// get selected R interpreter
		'my r interpreter'
	);
	const [interpreterEntries, setInterpreterEntries] =
		useState(
			// It's possible that the runtime discovery phase is not complete, so we need to check
			// for that before creating the interpreter entries.
			startupPhase !== RuntimeStartupPhase.Complete ?
				[] :
				getRInterpreterEntries(runtimeStartupService, languageRuntimeService)
		);

	// Handler for when the interpreter is selected. The project configuration is updated with the
	// selected interpreter.
	const onInterpreterSelected = (identifier: string) => {
		setSelectedInterpreter(identifier);
		const selectedRuntime = languageRuntimeService.getRegisteredRuntime(identifier);
		if (!selectedRuntime) {
			// This shouldn't happen, since the DropDownListBox should only allow selection of registered
			// runtimes
			logService.error(`No runtime found for identifier: ${identifier}`);
			return;
		}
		setProjectConfig({ ...projectConfig, selectedRuntime });
	};

	// Hook to update the interpreter entries when the runtime discovery phase is complete
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeRuntimeStartupPhase event handler; when the runtime discovery phase
		// is complete, update the interpreter entries.
		disposableStore.add(
			runtimeStartupService.onDidChangeRuntimeStartupPhase(
				phase => {
					if (phase === RuntimeStartupPhase.Complete) {
						const entries = getRInterpreterEntries(
							runtimeStartupService,
							languageRuntimeService
						);
						setInterpreterEntries(entries);
						setSelectedInterpreter(
							getSelectedRInterpreterId(selectedInterpreter, runtimeStartupService)
						);
					}
					setStartupPhase(phase);
				}
			)
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	});

	return (
		<PositronWizardStep
			title={(() => localize(
				'rConfigurationStep.title',
				'Set up project configuration'
			))()}
			backButtonConfig={{ onClick: props.back }}
			cancelButtonConfig={{ onClick: props.cancel }}
			okButtonConfig={{
				onClick: props.accept,
				title: (() => localize(
					'positronNewProjectWizard.createButtonTitle',
					"Create"
				))()
			}}
		>
			<PositronWizardSubStep
				title={(() => localize(
					'rConfigurationStep.versionSubStep.title',
					'R Version'
				))()}
				description={(() => localize(
					'rConfigurationStep.versionSubStep.description',
					'Select a version of R to launch your project with. You can modify this later if you change your mind.'
				))()}
			>
				<DropDownListBox
					keybindingService={keybindingService}
					layoutService={layoutService}
					disabled={startupPhase !== RuntimeStartupPhase.Complete}
					title={(() => startupPhase !== RuntimeStartupPhase.Complete ?
						localize(
							'rConfigurationStep.versionSubStep.dropDown.title.loading',
							'Discovering R versions...'
						) :
						localize(
							'rConfigurationStep.versionSubStep.dropDown.title',
							'Select a version of R'
						)
					)()}
					// TODO: if the runtime startup phase is complete, but there are no suitable
					// interpreters, show a message that no suitable interpreters were found and the
					// user should install an interpreter with minimum version
					entries={startupPhase !== RuntimeStartupPhase.Complete ? [] : interpreterEntries}
					selectedIdentifier={selectedInterpreter}
					createItem={item =>
						<InterpreterEntry interpreterInfo={item.options.value} />
					}
					onSelectionChanged={item =>
						onInterpreterSelected(item.options.identifier)
					}
				/>
			</PositronWizardSubStep>
			<PositronWizardSubStep
				title={(() => localize(
					'rConfigurationStep.additionalConfigSubStep.title',
					'Additional Configuration'
				))()}
			>
				<Checkbox
					label={(() => localize(
						'rConfigurationStep.additionalConfigSubStep.useRenv.label',
						'Use `renv` to create a reproducible environment'
					))()}
					onChanged={checked => setProjectConfig({ ...projectConfig, useRenv: checked })}
				/>
			</PositronWizardSubStep>
		</PositronWizardStep>
	);
};
