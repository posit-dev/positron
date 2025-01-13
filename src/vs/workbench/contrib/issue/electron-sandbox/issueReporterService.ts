/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { $, reset } from '../../../../base/browser/dom.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { IProductConfiguration } from '../../../../base/common/product.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { isRemoteDiagnosticError } from '../../../../platform/diagnostics/common/diagnostics.js';
import { IProcessMainService } from '../../../../platform/process/common/process.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { applyZoom } from '../../../../platform/window/electron-sandbox/window.js';
import { BaseIssueReporterService } from '../browser/baseIssueReporterService.js';
import { IssueReporterData as IssueReporterModelData } from '../browser/issueReporterModel.js';
import { IIssueFormService, IssueReporterData, IssueType } from '../common/issue.js';

// GitHub has let us know that we could up our limit here to 8k. We chose 7500 to play it safe.
// ref https://github.com/microsoft/vscode/issues/159191
const MAX_URL_LENGTH = 7500;

// Github API and issues on web has a limit of 65536. We chose 65500 to play it safe.
// ref https://github.com/github/issues/issues/12858
const MAX_GITHUB_API_LENGTH = 65500;


export class IssueReporter extends BaseIssueReporterService {
	private readonly processMainService: IProcessMainService;
	constructor(
		disableExtensions: boolean,
		data: IssueReporterData,
		os: {
			type: string;
			arch: string;
			release: string;
		},
		product: IProductConfiguration,
		window: Window,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IIssueFormService issueFormService: IIssueFormService,
		@IProcessMainService processMainService: IProcessMainService,
		@IThemeService themeService: IThemeService
	) {
		super(disableExtensions, data, os, product, window, false, issueFormService, themeService);
		this.processMainService = processMainService;
		this.processMainService.$getSystemInfo().then(info => {
			this.issueReporterModel.update({ systemInfo: info });
			this.receivedSystemInfo = true;

			this.updateSystemInfo(this.issueReporterModel.getData());
			this.updatePreviewButtonState();
		});
		if (this.data.issueType === IssueType.PerformanceIssue) {
			this.processMainService.$getPerformanceInfo().then(info => {
				this.updatePerformanceInfo(info as Partial<IssueReporterData>);
			});
		}

		this.setEventHandlers();
		applyZoom(this.data.zoomLevel, this.window);
		this.updateExperimentsInfo(this.data.experiments);
		this.updateRestrictedMode(this.data.restrictedMode);
		this.updateUnsupportedMode(this.data.isUnsupported);
	}

	public override setEventHandlers(): void {
		super.setEventHandlers();

		this.addEventListener('issue-type', 'change', (event: Event) => {
			const issueType = parseInt((<HTMLInputElement>event.target).value);
			this.issueReporterModel.update({ issueType: issueType });
			if (issueType === IssueType.PerformanceIssue && !this.receivedPerformanceInfo) {
				this.processMainService.$getPerformanceInfo().then(info => {
					this.updatePerformanceInfo(info as Partial<IssueReporterData>);
				});
			}

			// Resets placeholder
			const descriptionTextArea = <HTMLInputElement>this.getElementById('issue-title');
			if (descriptionTextArea) {
				descriptionTextArea.placeholder = localize('undefinedPlaceholder', "Please enter a title");
			}

			this.updatePreviewButtonState();
			this.setSourceOptions();
			this.render();
		});
	}

	public override async submitToGitHub(issueTitle: string, issueBody: string, gitHubDetails: { owner: string; repositoryName: string }): Promise<boolean> {
		if (issueBody.length > MAX_GITHUB_API_LENGTH) {
			console.error('Issue body is too long.');
			return false;
		}

		if (issueType === OldIssueType.Bug && this.receivedSystemInfo) {
			return true;
		}

		if (issueType === OldIssueType.PerformanceIssue && this.receivedSystemInfo && this.receivedPerformanceInfo) {
			return true;
		}

		if (issueType === OldIssueType.FeatureRequest) {
			return true;
		}

		return false;
	}

	private getExtensionRepositoryUrl(): string | undefined {
		const selectedExtension = this.issueReporterModel.getData().selectedExtension;
		return selectedExtension && selectedExtension.repositoryUrl;
	}

	private getExtensionBugsUrl(): string | undefined {
		const selectedExtension = this.issueReporterModel.getData().selectedExtension;
		return selectedExtension && selectedExtension.bugsUrl;
	}

	// --- Start Positron ---
	/*
	private getExtensionData(): string | undefined {
		return this.issueReporterModel.getData().selectedExtension?.extensionData;
	}

	private searchVSCodeIssues(title: string, issueDescription?: string): void {
		if (title) {
			this.searchDuplicates(title, issueDescription);
		} else {
			this.clearSearchResults();
		}
	}
	*/

	private searchPositronIssues(_title: string): void {
		// TODO: While positron repositories are private, they cannot be searched.
		// if (title) {
		// 	const gitHubInfo = this.parseGitHubUrl(this.configuration.product.reportIssueUrl!);
		// 	if (gitHubInfo) {
		// 		return this.searchGitHub(`${gitHubInfo.owner}/${gitHubInfo.repositoryName}`, title);
		// 	}
		// } else {
		// 	this.clearSearchResults();
		// }
		this.clearSearchResults();
	}
	// --- End Positron ---

	private searchIssues(title: string, fileOnExtension: boolean | undefined, fileOnMarketplace: boolean | undefined): void {
		if (fileOnExtension) {
			return this.searchExtensionIssues(title);
		}

		if (fileOnMarketplace) {
			return this.searchMarketplaceIssues(title);
		}

		// --- Start Positron ---
		this.searchPositronIssues(title);
		// --- End Positron ---
	}

	private searchExtensionIssues(title: string): void {
		const url = this.getExtensionGitHubUrl();
		if (title) {
			const matches = /^https?:\/\/github\.com\/(.*)/.exec(url);
			if (matches && matches.length) {
				const repo = matches[1];
				return this.searchGitHub(repo, title);
			}

			// If the extension has no repository, display empty search results
			if (this.issueReporterModel.getData().selectedExtension) {
				this.clearSearchResults();
				return this.displaySearchResults([]);

			}
		}

		this.clearSearchResults();
	}

	private searchMarketplaceIssues(title: string): void {
		if (title) {
			const gitHubInfo = this.parseGitHubUrl(this.configuration.product.reportMarketplaceIssueUrl!);
			if (gitHubInfo) {
				return this.searchGitHub(`${gitHubInfo.owner}/${gitHubInfo.repositoryName}`, title);
			}
		}
	}

	private async close(): Promise<void> {
		await this.issueMainService.$closeReporter();
	}

	private clearSearchResults(): void {
		const similarIssues = this.getElementById('similar-issues')!;
		similarIssues.innerText = '';
		this.numberOfSearchResultsDisplayed = 0;
	}

	@debounce(300)
	private searchGitHub(repo: string, title: string): void {
		const query = `is:issue+repo:${repo}+${title}`;
		const similarIssues = this.getElementById('similar-issues')!;

		fetch(`https://api.github.com/search/issues?q=${query}`).then((response) => {
			response.json().then(result => {
				similarIssues.innerText = '';
				if (result && result.items) {
					this.displaySearchResults(result.items);
				} else {
					// If the items property isn't present, the rate limit has been hit
					const message = $('div.list-title');
					message.textContent = localize('rateLimited', "GitHub query limit exceeded. Please wait.");
					similarIssues.appendChild(message);

					const resetTime = response.headers.get('X-RateLimit-Reset');
					const timeToWait = resetTime ? parseInt(resetTime) - Math.floor(Date.now() / 1000) : 1;
					if (this.shouldQueueSearch) {
						this.shouldQueueSearch = false;
						setTimeout(() => {
							this.searchGitHub(repo, title);
							this.shouldQueueSearch = true;
						}, timeToWait * 1000);
					}
				}
			}).catch(_ => {
				// Ignore
			});
		}).catch(_ => {
			// Ignore
		});
	}

	// --- Start Positron ---
	// @debounce(300)
	// private searchDuplicates(title: string, body?: string): void {
	// 	const url = 'https://vscode-probot.westus.cloudapp.azure.com:7890/duplicate_candidates';
	// 	const init = {
	// 		method: 'POST',
	// 		body: JSON.stringify({
	// 			title,
	// 			body
	// 		}),
	// 		headers: new Headers({
	// 			'Content-Type': 'application/json'
	// 		})
	// 	};

	// 	fetch(url, init).then((response) => {
	// 		response.json().then(result => {
	// 			this.clearSearchResults();

	// 			if (result && result.candidates) {
	// 				this.displaySearchResults(result.candidates);
	// 			} else {
	// 				throw new Error('Unexpected response, no candidates property');
	// 			}
	// 		}).catch(_ => {
	// 			// Ignore
	// 		});
	// 	}).catch(_ => {
	// 		// Ignore
	// 	});
	// }
	// --- End Positron ---

	private displaySearchResults(results: SearchResult[]) {
		const similarIssues = this.getElementById('similar-issues')!;
		if (results.length) {
			const issues = $('div.issues-container');
			const issuesText = $('div.list-title');
			issuesText.textContent = localize('similarIssues', "Similar issues");

			this.numberOfSearchResultsDisplayed = results.length < 5 ? results.length : 5;
			for (let i = 0; i < this.numberOfSearchResultsDisplayed; i++) {
				const issue = results[i];
				const link = $('a.issue-link', { href: issue.html_url });
				link.textContent = issue.title;
				link.title = issue.title;
				link.addEventListener('click', (e) => this.openLink(e));
				link.addEventListener('auxclick', (e) => this.openLink(<MouseEvent>e));

				let issueState: HTMLElement;
				let item: HTMLElement;
				if (issue.state) {
					issueState = $('span.issue-state');

					const issueIcon = $('span.issue-icon');
					issueIcon.appendChild(renderIcon(issue.state === 'open' ? Codicon.issueOpened : Codicon.issueClosed));

					const issueStateLabel = $('span.issue-state.label');
					issueStateLabel.textContent = issue.state === 'open' ? localize('open', "Open") : localize('closed', "Closed");

					issueState.title = issue.state === 'open' ? localize('open', "Open") : localize('closed', "Closed");
					issueState.appendChild(issueIcon);
					issueState.appendChild(issueStateLabel);

					item = $('div.issue', undefined, issueState, link);
				} else {
					item = $('div.issue', undefined, link);
				}

				issues.appendChild(item);
			}

			similarIssues.appendChild(issuesText);
			similarIssues.appendChild(issues);
		} else {
			const message = $('div.list-title');
			message.textContent = localize('noSimilarIssues', "No similar issues found");
			similarIssues.appendChild(message);
		}
	}

	private setUpTypes(): void {
		const makeOption = (issueType: OldIssueType, description: string) => $('option', { 'value': issueType.valueOf() }, escape(description));

		const typeSelect = this.getElementById('issue-type')! as HTMLSelectElement;
		const { issueType } = this.issueReporterModel.getData();
		reset(typeSelect,
			makeOption(OldIssueType.Bug, localize('bugReporter', "Bug Report")),
			makeOption(OldIssueType.FeatureRequest, localize('featureRequest', "Feature Request")),
			makeOption(OldIssueType.PerformanceIssue, localize('performanceIssue', "Performance Issue (freeze, slow, crash)"))
		);

		typeSelect.value = issueType.toString();

		this.setSourceOptions();
	}

	private makeOption(value: string, description: string, disabled: boolean): HTMLOptionElement {
		const option: HTMLOptionElement = document.createElement('option');
		option.disabled = disabled;
		option.value = value;
		option.textContent = description;

		return option;
	}

	private setSourceOptions(): void {
		const sourceSelect = this.getElementById('issue-source')! as HTMLSelectElement;
		const { issueType, fileOnExtension, selectedExtension, fileOnMarketplace, fileOnProduct } = this.issueReporterModel.getData();
		let selected = sourceSelect.selectedIndex;
		if (selected === -1) {
			if (fileOnExtension !== undefined) {
				selected = fileOnExtension ? 2 : 1;
			} else if (selectedExtension?.isBuiltin) {
				selected = 1;
			} else if (fileOnMarketplace) {
				selected = 3;
			} else if (fileOnProduct) {
				selected = 1;
			}
		}

		sourceSelect.innerText = '';
		sourceSelect.append(this.makeOption('', localize('selectSource', "Select source"), true));
		// --- Start Positron ---
		sourceSelect.append(this.makeOption(IssueSource.VSCode, localize('positron', "Positron"), false));
		// --- End Positron ---
		sourceSelect.append(this.makeOption(IssueSource.Extension, localize('extension', "A VS Code extension"), false));
		if (this.configuration.product.reportMarketplaceIssueUrl) {
			sourceSelect.append(this.makeOption(IssueSource.Marketplace, localize('marketplace', "Extensions Marketplace"), false));
		}

		if (issueType !== OldIssueType.FeatureRequest) {
			sourceSelect.append(this.makeOption(IssueSource.Unknown, localize('unknown', "Don't know"), false));
		}

		if (selected !== -1 && selected < sourceSelect.options.length) {
			sourceSelect.selectedIndex = selected;
		} else {
			sourceSelect.selectedIndex = 0;
			hide(this.getElementById('problem-source-help-text'));
		}
	}

	private renderBlocks(): void {
		// Depending on Issue Type, we render different blocks and text
		const { issueType, fileOnExtension, fileOnMarketplace, selectedExtension } = this.issueReporterModel.getData();
		const blockContainer = this.getElementById('block-container');
		const systemBlock = mainWindow.document.querySelector('.block-system');
		const processBlock = mainWindow.document.querySelector('.block-process');
		const workspaceBlock = mainWindow.document.querySelector('.block-workspace');
		const extensionsBlock = mainWindow.document.querySelector('.block-extensions');
		const experimentsBlock = mainWindow.document.querySelector('.block-experiments');
		const extensionDataBlock = mainWindow.document.querySelector('.block-extension-data');

		const problemSource = this.getElementById('problem-source')!;
		const descriptionTitle = this.getElementById('issue-description-label')!;
		const descriptionSubtitle = this.getElementById('issue-description-subtitle')!;
		const extensionSelector = this.getElementById('extension-selection')!;

		const titleTextArea = this.getElementById('issue-title-container')!;
		const descriptionTextArea = this.getElementById('description')!;
		const extensionDataTextArea = this.getElementById('extension-data')!;

		// Hide all by default
		hide(blockContainer);
		hide(systemBlock);
		hide(processBlock);
		hide(workspaceBlock);
		hide(extensionsBlock);
		hide(experimentsBlock);
		hide(extensionSelector);
		hide(extensionDataTextArea);
		hide(extensionDataBlock);

		show(problemSource);
		show(titleTextArea);
		show(descriptionTextArea);

		if (fileOnExtension) {
			show(extensionSelector);
		}


		if (selectedExtension && this.nonGitHubIssueUrl) {
			hide(titleTextArea);
			hide(descriptionTextArea);
			// --- Start Positron ---
			reset(descriptionTitle, localize('handlesIssuesElsewhere', "This extension handles issues outside of Positron"));
			// --- End Positron ---
			reset(descriptionSubtitle, localize('elsewhereDescription', "The '{0}' extension prefers to use an external issue reporter. To be taken to that issue reporting experience, click the button below.", selectedExtension.displayName));
			this.previewButton.label = localize('openIssueReporter', "Open External Issue Reporter");
			return;
		}

		if (fileOnExtension && selectedExtension?.data) {
			const data = selectedExtension?.data;
			(extensionDataTextArea as HTMLElement).innerText = data.toString();
			(extensionDataTextArea as HTMLTextAreaElement).readOnly = true;
			show(extensionDataBlock);
		}

		// only if we know comes from the open reporter command
		if (fileOnExtension && this.openReporter) {
			(extensionDataTextArea as HTMLTextAreaElement).readOnly = true;
			setTimeout(() => {
				// delay to make sure from command or not
				if (this.openReporter) {
					show(extensionDataBlock);
				}
			}, 100);
		}

		if (issueType === OldIssueType.Bug) {
			if (!fileOnMarketplace) {
				show(blockContainer);
				show(systemBlock);
				show(experimentsBlock);
				if (!fileOnExtension) {
					show(extensionsBlock);
				}
			}

			reset(descriptionTitle, localize('stepsToReproduce', "Steps to Reproduce") + ' ', $('span.required-input', undefined, '*'));
			reset(descriptionSubtitle, localize('bugDescription', "Share the steps needed to reliably reproduce the problem. Please include actual and expected results. We support GitHub-flavored Markdown. You will be able to edit your issue and add screenshots when we preview it on GitHub."));
		} else if (issueType === OldIssueType.PerformanceIssue) {
			if (!fileOnMarketplace) {
				show(blockContainer);
				show(systemBlock);
				show(processBlock);
				show(workspaceBlock);
				show(experimentsBlock);
			}

			if (fileOnExtension) {
				show(extensionSelector);
			} else if (!fileOnMarketplace) {
				show(extensionsBlock);
			}

			reset(descriptionTitle, localize('stepsToReproduce', "Steps to Reproduce") + ' ', $('span.required-input', undefined, '*'));
			reset(descriptionSubtitle, localize('performanceIssueDesciption', "When did this performance issue happen? Does it occur on startup or after a specific series of actions? We support GitHub-flavored Markdown. You will be able to edit your issue and add screenshots when we preview it on GitHub."));
		} else if (issueType === OldIssueType.FeatureRequest) {
			reset(descriptionTitle, localize('description', "Description") + ' ', $('span.required-input', undefined, '*'));
			reset(descriptionSubtitle, localize('featureRequestDescription', "Please describe the feature you would like to see. We support GitHub-flavored Markdown. You will be able to edit your issue and add screenshots when we preview it on GitHub."));
		}
	}

	private validateInput(inputId: string): boolean {
		const inputElement = (<HTMLInputElement>this.getElementById(inputId));
		const inputValidationMessage = this.getElementById(`${inputId}-empty-error`);
		const descriptionShortMessage = this.getElementById(`description-short-error`);
		if (!inputElement.value) {
			inputElement.classList.add('invalid-input');
			inputValidationMessage?.classList.remove('hidden');
			descriptionShortMessage?.classList.add('hidden');
			return false;
		} else if (inputId === 'description' && inputElement.value.length < 10) {
			inputElement.classList.add('invalid-input');
			descriptionShortMessage?.classList.remove('hidden');
			inputValidationMessage?.classList.add('hidden');
			return false;
		}
		else {
			inputElement.classList.remove('invalid-input');
			inputValidationMessage?.classList.add('hidden');
			if (inputId === 'description') {
				descriptionShortMessage?.classList.add('hidden');
			}
			return true;
		}
	}

	private validateInputs(): boolean {
		let isValid = true;
		['issue-title', 'description', 'issue-source'].forEach(elementId => {
			isValid = this.validateInput(elementId) && isValid;
		});

		if (this.issueReporterModel.fileOnExtension()) {
			isValid = this.validateInput('extension-selector') && isValid;
		}

		return isValid;
	}

	private async submitToGitHub(issueTitle: string, issueBody: string, gitHubDetails: { owner: string; repositoryName: string }): Promise<boolean> {
||||||| parent of 3ea4353e9e7 (Upstream Code OSS changes from 1.95.0 to 1.96.0)

		if (issueType === OldIssueType.Bug && this.receivedSystemInfo) {
			return true;
		}

		if (issueType === OldIssueType.PerformanceIssue && this.receivedSystemInfo && this.receivedPerformanceInfo) {
			return true;
		}

		if (issueType === OldIssueType.FeatureRequest) {
			return true;
		}

		return false;
	}

	private getExtensionRepositoryUrl(): string | undefined {
		const selectedExtension = this.issueReporterModel.getData().selectedExtension;
		return selectedExtension && selectedExtension.repositoryUrl;
	}

	private getExtensionBugsUrl(): string | undefined {
		const selectedExtension = this.issueReporterModel.getData().selectedExtension;
		return selectedExtension && selectedExtension.bugsUrl;
	}

	private searchVSCodeIssues(title: string, issueDescription?: string): void {
		if (title) {
			this.searchDuplicates(title, issueDescription);
		} else {
			this.clearSearchResults();
		}
	}

	private searchIssues(title: string, fileOnExtension: boolean | undefined, fileOnMarketplace: boolean | undefined): void {
		if (fileOnExtension) {
			return this.searchExtensionIssues(title);
		}

		if (fileOnMarketplace) {
			return this.searchMarketplaceIssues(title);
		}

		const description = this.issueReporterModel.getData().issueDescription;
		this.searchVSCodeIssues(title, description);
	}

	private searchExtensionIssues(title: string): void {
		const url = this.getExtensionGitHubUrl();
		if (title) {
			const matches = /^https?:\/\/github\.com\/(.*)/.exec(url);
			if (matches && matches.length) {
				const repo = matches[1];
				return this.searchGitHub(repo, title);
			}

			// If the extension has no repository, display empty search results
			if (this.issueReporterModel.getData().selectedExtension) {
				this.clearSearchResults();
				return this.displaySearchResults([]);

			}
		}

		this.clearSearchResults();
	}

	private searchMarketplaceIssues(title: string): void {
		if (title) {
			const gitHubInfo = this.parseGitHubUrl(this.configuration.product.reportMarketplaceIssueUrl!);
			if (gitHubInfo) {
				return this.searchGitHub(`${gitHubInfo.owner}/${gitHubInfo.repositoryName}`, title);
			}
		}
	}

	private async close(): Promise<void> {
		await this.issueMainService.$closeReporter();
	}

	private clearSearchResults(): void {
		const similarIssues = this.getElementById('similar-issues')!;
		similarIssues.innerText = '';
		this.numberOfSearchResultsDisplayed = 0;
	}

	@debounce(300)
	private searchGitHub(repo: string, title: string): void {
		const query = `is:issue+repo:${repo}+${title}`;
		const similarIssues = this.getElementById('similar-issues')!;

		fetch(`https://api.github.com/search/issues?q=${query}`).then((response) => {
			response.json().then(result => {
				similarIssues.innerText = '';
				if (result && result.items) {
					this.displaySearchResults(result.items);
				} else {
					// If the items property isn't present, the rate limit has been hit
					const message = $('div.list-title');
					message.textContent = localize('rateLimited', "GitHub query limit exceeded. Please wait.");
					similarIssues.appendChild(message);

					const resetTime = response.headers.get('X-RateLimit-Reset');
					const timeToWait = resetTime ? parseInt(resetTime) - Math.floor(Date.now() / 1000) : 1;
					if (this.shouldQueueSearch) {
						this.shouldQueueSearch = false;
						setTimeout(() => {
							this.searchGitHub(repo, title);
							this.shouldQueueSearch = true;
						}, timeToWait * 1000);
					}
				}
			}).catch(_ => {
				// Ignore
			});
		}).catch(_ => {
			// Ignore
		});
	}

	@debounce(300)
	private searchDuplicates(title: string, body?: string): void {
		const url = 'https://vscode-probot.westus.cloudapp.azure.com:7890/duplicate_candidates';
		const init = {
			method: 'POST',
			body: JSON.stringify({
				title,
				body
			}),
			headers: new Headers({
				'Content-Type': 'application/json'
			})
		};

		fetch(url, init).then((response) => {
			response.json().then(result => {
				this.clearSearchResults();

				if (result && result.candidates) {
					this.displaySearchResults(result.candidates);
				} else {
					throw new Error('Unexpected response, no candidates property');
				}
			}).catch(_ => {
				// Ignore
			});
		}).catch(_ => {
			// Ignore
		});
	}

	private displaySearchResults(results: SearchResult[]) {
		const similarIssues = this.getElementById('similar-issues')!;
		if (results.length) {
			const issues = $('div.issues-container');
			const issuesText = $('div.list-title');
			issuesText.textContent = localize('similarIssues', "Similar issues");

			this.numberOfSearchResultsDisplayed = results.length < 5 ? results.length : 5;
			for (let i = 0; i < this.numberOfSearchResultsDisplayed; i++) {
				const issue = results[i];
				const link = $('a.issue-link', { href: issue.html_url });
				link.textContent = issue.title;
				link.title = issue.title;
				link.addEventListener('click', (e) => this.openLink(e));
				link.addEventListener('auxclick', (e) => this.openLink(<MouseEvent>e));

				let issueState: HTMLElement;
				let item: HTMLElement;
				if (issue.state) {
					issueState = $('span.issue-state');

					const issueIcon = $('span.issue-icon');
					issueIcon.appendChild(renderIcon(issue.state === 'open' ? Codicon.issueOpened : Codicon.issueClosed));

					const issueStateLabel = $('span.issue-state.label');
					issueStateLabel.textContent = issue.state === 'open' ? localize('open', "Open") : localize('closed', "Closed");

					issueState.title = issue.state === 'open' ? localize('open', "Open") : localize('closed', "Closed");
					issueState.appendChild(issueIcon);
					issueState.appendChild(issueStateLabel);

					item = $('div.issue', undefined, issueState, link);
				} else {
					item = $('div.issue', undefined, link);
				}

				issues.appendChild(item);
			}

			similarIssues.appendChild(issuesText);
			similarIssues.appendChild(issues);
		} else {
			const message = $('div.list-title');
			message.textContent = localize('noSimilarIssues', "No similar issues found");
			similarIssues.appendChild(message);
		}
	}

	private setUpTypes(): void {
		const makeOption = (issueType: OldIssueType, description: string) => $('option', { 'value': issueType.valueOf() }, escape(description));

		const typeSelect = this.getElementById('issue-type')! as HTMLSelectElement;
		const { issueType } = this.issueReporterModel.getData();
		reset(typeSelect,
			makeOption(OldIssueType.Bug, localize('bugReporter', "Bug Report")),
			makeOption(OldIssueType.FeatureRequest, localize('featureRequest', "Feature Request")),
			makeOption(OldIssueType.PerformanceIssue, localize('performanceIssue', "Performance Issue (freeze, slow, crash)"))
		);

		typeSelect.value = issueType.toString();

		this.setSourceOptions();
	}

	private makeOption(value: string, description: string, disabled: boolean): HTMLOptionElement {
		const option: HTMLOptionElement = document.createElement('option');
		option.disabled = disabled;
		option.value = value;
		option.textContent = description;

		return option;
	}

	private setSourceOptions(): void {
		const sourceSelect = this.getElementById('issue-source')! as HTMLSelectElement;
		const { issueType, fileOnExtension, selectedExtension, fileOnMarketplace, fileOnProduct } = this.issueReporterModel.getData();
		let selected = sourceSelect.selectedIndex;
		if (selected === -1) {
			if (fileOnExtension !== undefined) {
				selected = fileOnExtension ? 2 : 1;
			} else if (selectedExtension?.isBuiltin) {
				selected = 1;
			} else if (fileOnMarketplace) {
				selected = 3;
			} else if (fileOnProduct) {
				selected = 1;
			}
		}

		sourceSelect.innerText = '';
		sourceSelect.append(this.makeOption('', localize('selectSource', "Select source"), true));
		sourceSelect.append(this.makeOption(IssueSource.VSCode, localize('vscode', "Visual Studio Code"), false));
		sourceSelect.append(this.makeOption(IssueSource.Extension, localize('extension', "A VS Code extension"), false));
		if (this.configuration.product.reportMarketplaceIssueUrl) {
			sourceSelect.append(this.makeOption(IssueSource.Marketplace, localize('marketplace', "Extensions Marketplace"), false));
		}

		if (issueType !== OldIssueType.FeatureRequest) {
			sourceSelect.append(this.makeOption(IssueSource.Unknown, localize('unknown', "Don't know"), false));
		}

		if (selected !== -1 && selected < sourceSelect.options.length) {
			sourceSelect.selectedIndex = selected;
		} else {
			sourceSelect.selectedIndex = 0;
			hide(this.getElementById('problem-source-help-text'));
		}
	}

	private renderBlocks(): void {
		// Depending on Issue Type, we render different blocks and text
		const { issueType, fileOnExtension, fileOnMarketplace, selectedExtension } = this.issueReporterModel.getData();
		const blockContainer = this.getElementById('block-container');
		const systemBlock = mainWindow.document.querySelector('.block-system');
		const processBlock = mainWindow.document.querySelector('.block-process');
		const workspaceBlock = mainWindow.document.querySelector('.block-workspace');
		const extensionsBlock = mainWindow.document.querySelector('.block-extensions');
		const experimentsBlock = mainWindow.document.querySelector('.block-experiments');
		const extensionDataBlock = mainWindow.document.querySelector('.block-extension-data');

		const problemSource = this.getElementById('problem-source')!;
		const descriptionTitle = this.getElementById('issue-description-label')!;
		const descriptionSubtitle = this.getElementById('issue-description-subtitle')!;
		const extensionSelector = this.getElementById('extension-selection')!;

		const titleTextArea = this.getElementById('issue-title-container')!;
		const descriptionTextArea = this.getElementById('description')!;
		const extensionDataTextArea = this.getElementById('extension-data')!;

		// Hide all by default
		hide(blockContainer);
		hide(systemBlock);
		hide(processBlock);
		hide(workspaceBlock);
		hide(extensionsBlock);
		hide(experimentsBlock);
		hide(extensionSelector);
		hide(extensionDataTextArea);
		hide(extensionDataBlock);

		show(problemSource);
		show(titleTextArea);
		show(descriptionTextArea);

		if (fileOnExtension) {
			show(extensionSelector);
		}


		if (selectedExtension && this.nonGitHubIssueUrl) {
			hide(titleTextArea);
			hide(descriptionTextArea);
			reset(descriptionTitle, localize('handlesIssuesElsewhere', "This extension handles issues outside of VS Code"));
			reset(descriptionSubtitle, localize('elsewhereDescription', "The '{0}' extension prefers to use an external issue reporter. To be taken to that issue reporting experience, click the button below.", selectedExtension.displayName));
			this.previewButton.label = localize('openIssueReporter', "Open External Issue Reporter");
			return;
		}

		if (fileOnExtension && selectedExtension?.data) {
			const data = selectedExtension?.data;
			(extensionDataTextArea as HTMLElement).innerText = data.toString();
			(extensionDataTextArea as HTMLTextAreaElement).readOnly = true;
			show(extensionDataBlock);
		}

		// only if we know comes from the open reporter command
		if (fileOnExtension && this.openReporter) {
			(extensionDataTextArea as HTMLTextAreaElement).readOnly = true;
			setTimeout(() => {
				// delay to make sure from command or not
				if (this.openReporter) {
					show(extensionDataBlock);
				}
			}, 100);
		}

		if (issueType === OldIssueType.Bug) {
			if (!fileOnMarketplace) {
				show(blockContainer);
				show(systemBlock);
				show(experimentsBlock);
				if (!fileOnExtension) {
					show(extensionsBlock);
				}
			}

			reset(descriptionTitle, localize('stepsToReproduce', "Steps to Reproduce") + ' ', $('span.required-input', undefined, '*'));
			reset(descriptionSubtitle, localize('bugDescription', "Share the steps needed to reliably reproduce the problem. Please include actual and expected results. We support GitHub-flavored Markdown. You will be able to edit your issue and add screenshots when we preview it on GitHub."));
		} else if (issueType === OldIssueType.PerformanceIssue) {
			if (!fileOnMarketplace) {
				show(blockContainer);
				show(systemBlock);
				show(processBlock);
				show(workspaceBlock);
				show(experimentsBlock);
			}

			if (fileOnExtension) {
				show(extensionSelector);
			} else if (!fileOnMarketplace) {
				show(extensionsBlock);
			}

			reset(descriptionTitle, localize('stepsToReproduce', "Steps to Reproduce") + ' ', $('span.required-input', undefined, '*'));
			reset(descriptionSubtitle, localize('performanceIssueDesciption', "When did this performance issue happen? Does it occur on startup or after a specific series of actions? We support GitHub-flavored Markdown. You will be able to edit your issue and add screenshots when we preview it on GitHub."));
		} else if (issueType === OldIssueType.FeatureRequest) {
			reset(descriptionTitle, localize('description', "Description") + ' ', $('span.required-input', undefined, '*'));
			reset(descriptionSubtitle, localize('featureRequestDescription', "Please describe the feature you would like to see. We support GitHub-flavored Markdown. You will be able to edit your issue and add screenshots when we preview it on GitHub."));
		}
	}

	private validateInput(inputId: string): boolean {
		const inputElement = (<HTMLInputElement>this.getElementById(inputId));
		const inputValidationMessage = this.getElementById(`${inputId}-empty-error`);
		const descriptionShortMessage = this.getElementById(`description-short-error`);
		if (!inputElement.value) {
			inputElement.classList.add('invalid-input');
			inputValidationMessage?.classList.remove('hidden');
			descriptionShortMessage?.classList.add('hidden');
			return false;
		} else if (inputId === 'description' && inputElement.value.length < 10) {
			inputElement.classList.add('invalid-input');
			descriptionShortMessage?.classList.remove('hidden');
			inputValidationMessage?.classList.add('hidden');
			return false;
		}
		else {
			inputElement.classList.remove('invalid-input');
			inputValidationMessage?.classList.add('hidden');
			if (inputId === 'description') {
				descriptionShortMessage?.classList.add('hidden');
			}
			return true;
		}
	}

	private validateInputs(): boolean {
		let isValid = true;
		['issue-title', 'description', 'issue-source'].forEach(elementId => {
			isValid = this.validateInput(elementId) && isValid;
		});

		if (this.issueReporterModel.fileOnExtension()) {
			isValid = this.validateInput('extension-selector') && isValid;
		}

		return isValid;
	}

	private async submitToGitHub(issueTitle: string, issueBody: string, gitHubDetails: { owner: string; repositoryName: string }): Promise<boolean> {
=======
>>>>>>> 3ea4353e9e7 (Upstream Code OSS changes from 1.95.0 to 1.96.0)
		const url = `https://api.github.com/repos/${gitHubDetails.owner}/${gitHubDetails.repositoryName}/issues`;
		const init = {
			method: 'POST',
			body: JSON.stringify({
				title: issueTitle,
				body: issueBody
			}),
			headers: new Headers({
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.data.githubAccessToken}`
			})
		};

		const response = await fetch(url, init);
		if (!response.ok) {
			console.error('Invalid GitHub URL provided.');
			return false;
		}
		const result = await response.json();
		await this.nativeHostService.openExternal(result.html_url);
		this.close();
		return true;
	}

	public override async createIssue(): Promise<boolean> {
		const selectedExtension = this.issueReporterModel.getData().selectedExtension;
		const hasUri = this.nonGitHubIssueUrl;
		// Short circuit if the extension provides a custom issue handler
		if (hasUri) {
			const url = this.getExtensionBugsUrl();
			if (url) {
				this.hasBeenSubmitted = true;
				await this.nativeHostService.openExternal(url);
				return true;
			}
		}

		if (!this.validateInputs()) {
			// If inputs are invalid, set focus to the first one and add listeners on them
			// to detect further changes
			const invalidInput = this.window.document.getElementsByClassName('invalid-input');
			if (invalidInput.length) {
				(<HTMLInputElement>invalidInput[0]).focus();
			}

			this.addEventListener('issue-title', 'input', _ => {
				this.validateInput('issue-title');
			});

			this.addEventListener('description', 'input', _ => {
				this.validateInput('description');
			});

			this.addEventListener('issue-source', 'change', _ => {
				this.validateInput('issue-source');
			});

			if (this.issueReporterModel.fileOnExtension()) {
				this.addEventListener('extension-selector', 'change', _ => {
					this.validateInput('extension-selector');
					this.validateInput('description');
				});
			}

			return false;
		}

		this.hasBeenSubmitted = true;

		const issueTitle = (<HTMLInputElement>this.getElementById('issue-title')).value;
		const issueBody = this.issueReporterModel.serialize();

		let issueUrl = this.getIssueUrl();
		if (!issueUrl) {
			console.error('No issue url found');
			return false;
		}

		if (selectedExtension?.uri) {
			const uri = URI.revive(selectedExtension.uri);
			issueUrl = uri.toString();
		}

		const gitHubDetails = this.parseGitHubUrl(issueUrl);

		const baseUrl = this.getIssueUrlWithTitle((<HTMLInputElement>this.getElementById('issue-title')).value, issueUrl);
		let url = baseUrl + `&body=${encodeURIComponent(issueBody)}`;

		if (this.data.githubAccessToken && gitHubDetails) {
			if (await this.submitToGitHub(issueTitle, issueBody, gitHubDetails)) {
				return true;
			}
		}

		try {
			if (url.length > MAX_URL_LENGTH || issueBody.length > MAX_GITHUB_API_LENGTH) {
				url = await this.writeToClipboard(baseUrl, issueBody);
			}
		} catch (_) {
			console.error('Writing to clipboard failed');
			return false;
		}

		await this.nativeHostService.openExternal(url);
		return true;
	}

	public override async writeToClipboard(baseUrl: string, issueBody: string): Promise<string> {
		const shouldWrite = await this.issueFormService.showClipboardDialog();
		if (!shouldWrite) {
			throw new CancellationError();
		}

		await this.nativeHostService.writeClipboardText(issueBody);

		return baseUrl + `&body=${encodeURIComponent(localize('pasteData', "We have written the needed data into your clipboard because it was too large to send. Please paste."))}`;
	}

	private updateSystemInfo(state: IssueReporterModelData) {
		const target = this.window.document.querySelector<HTMLElement>('.block-system .block-info');

		if (target) {
			const systemInfo = state.systemInfo!;
			const renderedDataTable = $('table', undefined,
				$('tr', undefined,
					$('td', undefined, 'CPUs'),
					$('td', undefined, systemInfo.cpus || '')
				),
				$('tr', undefined,
					$('td', undefined, 'GPU Status' as string),
					$('td', undefined, Object.keys(systemInfo.gpuStatus).map(key => `${key}: ${systemInfo.gpuStatus[key]}`).join('\n'))
				),
				$('tr', undefined,
					$('td', undefined, 'Load (avg)' as string),
					$('td', undefined, systemInfo.load || '')
				),
				$('tr', undefined,
					$('td', undefined, 'Memory (System)' as string),
					$('td', undefined, systemInfo.memory)
				),
				$('tr', undefined,
					$('td', undefined, 'Process Argv' as string),
					$('td', undefined, systemInfo.processArgs)
				),
				$('tr', undefined,
					$('td', undefined, 'Screen Reader' as string),
					$('td', undefined, systemInfo.screenReader)
				),
				$('tr', undefined,
					$('td', undefined, 'VM'),
					$('td', undefined, systemInfo.vmHint)
				)
			);
			reset(target, renderedDataTable);

			systemInfo.remoteData.forEach(remote => {
				target.appendChild($<HTMLHRElement>('hr'));
				if (isRemoteDiagnosticError(remote)) {
					const remoteDataTable = $('table', undefined,
						$('tr', undefined,
							$('td', undefined, 'Remote'),
							$('td', undefined, remote.hostName)
						),
						$('tr', undefined,
							$('td', undefined, ''),
							$('td', undefined, remote.errorMessage)
						)
					);
					target.appendChild(remoteDataTable);
				} else {
					const remoteDataTable = $('table', undefined,
						$('tr', undefined,
							$('td', undefined, 'Remote'),
							$('td', undefined, remote.latency ? `${remote.hostName} (latency: ${remote.latency.current.toFixed(2)}ms last, ${remote.latency.average.toFixed(2)}ms average)` : remote.hostName)
						),
						$('tr', undefined,
							$('td', undefined, 'OS'),
							$('td', undefined, remote.machineInfo.os)
						),
						$('tr', undefined,
							$('td', undefined, 'CPUs'),
							$('td', undefined, remote.machineInfo.cpus || '')
						),
						$('tr', undefined,
							$('td', undefined, 'Memory (System)' as string),
							$('td', undefined, remote.machineInfo.memory)
						),
						$('tr', undefined,
							$('td', undefined, 'VM'),
							$('td', undefined, remote.machineInfo.vmHint)
						)
					);
					target.appendChild(remoteDataTable);
				}
			});
		}
	}

	private updateRestrictedMode(restrictedMode: boolean) {
		this.issueReporterModel.update({ restrictedMode });
	}

	private updateUnsupportedMode(isUnsupported: boolean) {
		this.issueReporterModel.update({ isUnsupported });
	}

	private updateExperimentsInfo(experimentInfo: string | undefined) {
		this.issueReporterModel.update({ experimentInfo });
		const target = this.window.document.querySelector<HTMLElement>('.block-experiments .block-info');
		if (target) {
			target.textContent = experimentInfo ? experimentInfo : localize('noCurrentExperiments', "No current experiments.");
		}
	}
}
