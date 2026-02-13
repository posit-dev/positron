/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IInputBox, IQuickInput, IQuickInputButton, IQuickInputService, IQuickPickItem, QuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';

interface VersionSearchResult {
	name: string;
}

interface PackageSearchResult {
	name: string;
	// description appears inline with the name
	description?: string;
	// detail appears on the second line
	detail?: string;
}

export const updatePackage = async (
	accessor: ServicesAccessor,
	performGetPackages: (q: string) => Promise<PackageSearchResult[]>,
	performLookup: (q: string) => Promise<string[]>,
	performUpdate: (pkg: string, version: string) => Promise<void>,
	packageToInstall?: string

) => {
	const title = localize('positronPackages.updatePackageTitle', 'Update Package');

	interface State {
		query: string;
		packages: PackageSearchResult[];
		versions: VersionSearchResult[];
		selectedPackage: string | undefined;
		selectedVersion: string | undefined;
	}

	async function collectInputs() {
		const state: State = {
			query: '',
			packages: [],
			versions: [],
			selectedPackage: undefined,
			selectedVersion: undefined,
		};

		if (packageToInstall) {
			state.selectedPackage = packageToInstall;
			await MultiStepInput.run(accessor, (input) => pickVersion(input, state));
		} else {
			await MultiStepInput.run(accessor, (input) => showLoading(input, state));
		}

		return state as State;
	}

	async function showLoading(input: MultiStepInput, state: State) {
		input.showQuickPick({
			title,
			step: 1,
			totalSteps: 2,
			placeholder: localize('positronPackages.updatePackagePlaceholder', 'Pick a package to update...'),
			items: state.packages.map((result) => ({
				label: result.name,
			})),
		});
		return (input: MultiStepInput) => pickPackage(input, state);
	}

	async function pickPackage(input: MultiStepInput, state: State) {
		state.packages = await performGetPackages('');
		const selection = await input.showQuickPick({
			title,
			step: 1,
			totalSteps: 2,
			placeholder: localize('positronPackages.updatePackagePlaceholder', 'Pick a package to update...'),
			items: state.packages.map((result) => ({
				label: result.name,
			})),
		});

		state.selectedPackage = selection.label;

		return (input: MultiStepInput) => pickVersion(input, state);
	}

	async function pickVersion(input: MultiStepInput, state: State) {
		const versions = await performLookup(state.selectedPackage ?? '');
		state.versions = versions.map((v) => ({ name: v }));

		const selection = await input.showQuickPick({
			title,
			step: 2,
			totalSteps: 2,
			placeholder: localize('positronPackages.pickVersionPlaceholder', "Pick a version of {0} to update", state.selectedPackage),
			items: state.versions.map((version) => ({ label: version.name })),
		});

		state.selectedVersion = selection.label;
	}


	const state = await collectInputs();
	// If there is no selected package and version, it means the user canceled the QuickPick, so we should not perform the update.
	if (state.selectedPackage && state.selectedVersion) {
		await performUpdate(state.selectedPackage, state.selectedVersion);
	}
};

export const uninstallPackage = async (
	accessor: ServicesAccessor,
	performGetPackages: (q: string) => Promise<PackageSearchResult[]>,
	performUninstall: (pkg: string, version?: string) => Promise<void>
) => {
	const title = localize('positronPackages.uninstallPackageTitle', 'Uninstall Package');

	interface State {
		packages: PackageSearchResult[];
		selectedPackage: string | undefined;
	}

	async function collectInputs() {
		const state = {
			packages: [],
			selectedPackage: undefined,
		};
		await MultiStepInput.run(accessor, (input) => showLoading(input, state));
		return state as State;
	}

	async function showLoading(input: MultiStepInput, state: State) {
		input.showQuickPick({
			title,
			step: 1,
			totalSteps: 1,
			placeholder: localize('positronPackages.uninstallPackagePlaceholder', 'Pick a package to uninstall...'),
			items: state.packages.map((result) => ({
				label: result.name,
			})),
		});
		return (input: MultiStepInput) => pickPackage(input, state);
	}

	async function pickPackage(input: MultiStepInput, state: State) {
		state.packages = await performGetPackages('');
		const selection = await input.showQuickPick({
			title,
			step: 1,
			totalSteps: 1,
			placeholder: localize('positronPackages.uninstallPackagePlaceholder', 'Pick a package to uninstall...'),
			items: state.packages.map((result) => ({
				label: result.name,
			})),
		});

		state.selectedPackage = selection.label;
	}

	const state = await collectInputs();
	if (state.selectedPackage) {
		await performUninstall(state.selectedPackage);
	}
};

export const installPackage = async (
	accessor: ServicesAccessor,
	performSearch: (q: string) => Promise<PackageSearchResult[]>,
	performLookup: (q: string) => Promise<string[]>,
	performInstall: (pkg: string, version?: string) => Promise<void>,
) => {
	const title = localize('positronPackages.installPackageTitle', 'Install Package');

	interface State {
		query: string;
		packages: PackageSearchResult[];
		versions: VersionSearchResult[];
		selectedPackage: string | undefined;
		selectedVersion: string | undefined;
	}

	async function collectInputs() {
		const state = {
			query: '',
			packages: [],
			versions: [],
			selectedPackage: undefined,
			selectedVersion: undefined,
		};
		await MultiStepInput.run(accessor, (input) => searchPackage(input, state));
		return state as State;
	}

	async function pickVersion(input: MultiStepInput, state: State) {
		const versions = await performLookup(state.selectedPackage ?? '');
		state.versions = versions.map((v) => ({ name: v }));

		const selection = await input.showQuickPick({
			title,
			step: 3,
			totalSteps: 3,
			placeholder: localize('positronPackages.installPackageVersionPlaceholder', "Pick a version of '{0}' to install", state.selectedPackage),
			items: state.versions.map((version) => ({ label: version.name })),
		});

		state.selectedVersion = selection.label;
	}

	async function pickPackage(input: MultiStepInput, state: State) {
		const selection = await input.showQuickPick({
			title,
			step: 2,
			totalSteps: 3,
			placeholder: localize('positronPackages.installPackagePlaceholder', 'Pick a package to install...'),
			items: state.packages.map((result) => ({
				label: result.name,
			})),
		});

		state.selectedPackage = selection.label;

		return (input: MultiStepInput) => pickVersion(input, state);
	}

	async function searchPackage(input: MultiStepInput, state: State) {
		const query = await input.showInputBox({
			title,
			step: 1,
			totalSteps: 3,
			value: state.query || '',
			prompt: localize('positronPackages.installPackagePrompt', 'Search for a package to install...'),
			perform: async (value: string, input) => {
				try {
					state.packages = await performSearch(value);
				} catch (error) {
					input.validationMessage = localize('positronPackages.errorSearchingPackages', 'Error searching packages.');
					throw error;
				}

				if (state.packages.length === 0) {
					input.validationMessage = localize('positronPackages.noPackagesFound', "No packages found for '{0}'", value);
					return Promise.reject();
				}
			},
		});

		state.query = query;

		return (input: MultiStepInput) => pickPackage(input, state);
	}

	const state = await collectInputs();
	// If there is no selected package and version, it means the user canceled the QuickPick, so we should not perform the update.
	if (state.selectedPackage && state.selectedVersion) {
		await performInstall(state.selectedPackage, state.selectedVersion);
	}
};

// -------------------------------------------------------
// Helper code that wraps the API for the multi-step case.
// -------------------------------------------------------

class InputFlowAction {
	static back = new InputFlowAction();
	static cancel = new InputFlowAction();
	static resume = new InputFlowAction();
}

type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;

interface QuickPickParameters<T extends QuickPickItem> {
	title: string;
	step: number;
	totalSteps: number;
	items: T[];
	activeItem?: T;
	ignoreFocusOut?: boolean;
	placeholder: string;
	buttons?: IQuickInputButton[];
}

interface InputBoxParameters {
	title: string;
	step: number;
	totalSteps: number;
	value: string;
	prompt: string;
	validate?: (value: string) => Promise<string | undefined>;
	perform?: (value: string, input: IInputBox) => Promise<void>;
	buttons?: IQuickInputButton[];
	ignoreFocusOut?: boolean;
	placeholder?: string;
}

class MultiStepInput {
	quickPickService: IQuickInputService;
	static async run(accessor: ServicesAccessor, start: InputStep) {
		const quickPickService = accessor.get(IQuickInputService);
		const input = new MultiStepInput(quickPickService);
		return input.stepThrough(start);
	}



	constructor(quickPickService: IQuickInputService) {
		this.quickPickService = quickPickService;
	}

	private current?: IQuickInput;
	private steps: InputStep[] = [];

	private async stepThrough(start: InputStep) {
		let step: InputStep | void = start;
		while (step) {
			this.steps.push(step);
			if (this.current) {
				this.current.enabled = false;
				this.current.busy = true;
			}
			try {
				step = await step(this);
			} catch (err) {
				if (err === InputFlowAction.back) {
					this.steps.pop();
					step = this.steps.pop();
				} else if (err === InputFlowAction.resume) {
					step = this.steps.pop();
				} else if (err === InputFlowAction.cancel) {
					step = undefined;
				} else {
					throw err;
				}
			}
		}
		if (this.current) {
			this.current.dispose();
		}
	}

	async showQuickPick<T extends IQuickPickItem, P extends QuickPickParameters<T>>({
		title,
		step,
		totalSteps,
		items,
		activeItem,
		ignoreFocusOut,
		placeholder,
		buttons,
	}: P) {
		const disposables: IDisposable[] = [];
		try {
			return await new Promise<T | (P extends { buttons: (infer I)[] } ? I : never)>(
				(resolve, reject) => {
					const input = this.quickPickService.createQuickPick<T>();
					input.title = title;
					input.step = step;
					input.totalSteps = totalSteps;
					input.ignoreFocusOut = ignoreFocusOut ?? false;
					input.placeholder = placeholder;
					input.items = items;
					if (activeItem) {
						input.activeItems = [activeItem];
					}
					input.buttons = [
						...(this.steps.length > 1 ? [this.quickPickService.backButton] : []),
						...(buttons || []),
					];
					disposables.push(
						input.onDidTriggerButton((item) => {
							if (item === this.quickPickService.backButton) {
								reject(InputFlowAction.back);
							} else {
								reject(item);
							}
						}),
						input.onDidChangeSelection((items) => resolve(items[0])),
						input.onDidHide(() => reject(InputFlowAction.cancel)),
					);
					if (this.current) {
						this.current.dispose();
					}
					this.current = input;
					this.current.show();
				},
			);
		} finally {
			disposables.forEach((d) => d.dispose());
		}
	}

	async showInputBox<P extends InputBoxParameters>({
		title,
		step,
		totalSteps,
		value,
		prompt,
		validate,
		perform,
		buttons,
		ignoreFocusOut,
		placeholder,
	}: P) {
		const disposables: IDisposable[] = [];
		try {
			return await new Promise<
				string | (P extends { buttons: (infer I)[] } ? I : never)
			>((resolve, reject) => {
				const input = this.quickPickService.createInputBox();
				input.title = title;
				input.step = step;
				input.totalSteps = totalSteps;
				input.value = value || '';
				input.prompt = prompt;
				input.ignoreFocusOut = ignoreFocusOut ?? false;
				input.placeholder = placeholder;
				input.buttons = [
					...(this.steps.length > 1 ? [this.quickPickService.backButton] : []),
					...(buttons || []),
				];
				let validating = validate?.('');
				disposables.push(
					input.onDidTriggerButton(async (item) => {
						if (item === this.quickPickService.backButton) {
							reject(InputFlowAction.back);
						} else {
							reject(item);
						}
					}),
					input.onDidAccept(async () => {
						const value = input.value;
						input.enabled = false;
						input.busy = true;
						try {
							if (!(await validate?.(value))) {
								await perform?.(value, input);
								resolve(value);
							}
						} finally {
							input.enabled = true;
							input.busy = false;
						}
					}),
					input.onDidChangeValue(async (text) => {
						const current = validate?.(text);
						validating = current;
						const validationMessage = await current;
						if (current === validating) {
							input.validationMessage = validationMessage;
						}
					}),
					input.onDidHide(async () => {
						reject(InputFlowAction.cancel);
					}),
				);
				if (this.current) {
					this.current.dispose();
				}
				this.current = input;
				this.current?.show();
			});
		} finally {
			disposables.forEach((d) => d.dispose());
		}
	}
}
