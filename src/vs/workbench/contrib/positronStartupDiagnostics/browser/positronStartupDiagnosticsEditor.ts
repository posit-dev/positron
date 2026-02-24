/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { TextResourceEditorInput } from '../../../common/editor/textResourceEditorInput.js';
import { ITextModelService, ITextModelContentProvider } from '../../../../editor/common/services/resolverService.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITimerService } from '../../../services/timer/browser/timerService.js';
import { IDisposable, dispose } from '../../../../base/common/lifecycle.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { writeTransientState } from '../../codeEditor/browser/toggleWordWrap.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ByteSize, IFileService } from '../../../../platform/files/common/files.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IFilesConfigurationService } from '../../../services/filesConfiguration/common/filesConfigurationService.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { getWorkbenchContribution } from '../../../common/contributions.js';
import { ICustomEditorLabelService } from '../../../services/editor/common/customEditorLabelService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { ILanguageRuntimeService, ILanguageRuntimeLaunchInfo } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IOutputService } from '../../../services/output/common/output.js';
import * as perf from '../../../../base/common/performance.js';

export class PositronStartupDiagnosticsContrib implements IDisposable {

	static get() {
		return getWorkbenchContribution<PositronStartupDiagnosticsContrib>(PositronStartupDiagnosticsContrib.ID);
	}

	static readonly ID = 'workbench.contrib.positronStartupDiagnostics';

	private readonly _inputUri = URI.from({ scheme: 'positron-startup-diagnostics', path: 'Runtime Startup Diagnostics' });
	private readonly _registration: IDisposable;

	constructor(
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@ITextModelService textModelResolverService: ITextModelService
	) {
		this._registration = textModelResolverService.registerTextModelContentProvider(
			'positron-startup-diagnostics',
			_instaService.createInstance(PositronStartupDiagnosticsContentProvider)
		);
	}

	dispose(): void {
		this._registration.dispose();
	}

	getInputUri(): URI {
		return this._inputUri;
	}

	getEditorInput(): PositronStartupDiagnosticsInput {
		return this._instaService.createInstance(PositronStartupDiagnosticsInput);
	}
}

export class PositronStartupDiagnosticsInput extends TextResourceEditorInput {

	static readonly Id = 'PositronStartupDiagnosticsInput';

	override get typeId(): string {
		return PositronStartupDiagnosticsInput.Id;
	}

	constructor(
		@ITextModelService textModelResolverService: ITextModelService,
		@ITextFileService textFileService: ITextFileService,
		@IEditorService editorService: IEditorService,
		@IFileService fileService: IFileService,
		@ILabelService labelService: ILabelService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@ICustomEditorLabelService customEditorLabelService: ICustomEditorLabelService
	) {
		super(
			PositronStartupDiagnosticsContrib.get().getInputUri(),
			localize('positronStartupDiagnostics.title', 'Runtime Startup Diagnostics'),
			undefined,
			undefined,
			undefined,
			textModelResolverService,
			textFileService,
			editorService,
			fileService,
			labelService,
			filesConfigurationService,
			textResourceConfigurationService,
			customEditorLabelService
		);
	}
}

class PositronStartupDiagnosticsContentProvider implements ITextModelContentProvider {

	private _model: ITextModel | undefined;
	private _modelDisposables: IDisposable[] = [];

	constructor(
		@IModelService private readonly _modelService: IModelService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@ITimerService private readonly _timerService: ITimerService,
		@IProductService private readonly _productService: IProductService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IRuntimeStartupService private readonly _runtimeStartupService: IRuntimeStartupService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IOutputService private readonly _outputService: IOutputService,
		@ITextModelService private readonly _textModelService: ITextModelService,
	) { }

	provideTextContent(resource: URI): Promise<ITextModel> {
		if (!this._model || this._model.isDisposed()) {
			dispose(this._modelDisposables);
			const langId = this._languageService.createById('markdown');
			this._model = this._modelService.getModel(resource) || this._modelService.createModel('Loading...', langId, resource);

			this._modelDisposables.push(langId.onDidChange(e => {
				this._model?.setLanguage(e);
			}));

			writeTransientState(this._model, { wordWrapOverride: 'off' }, this._editorService);
		}
		this._updateModel();
		return Promise.resolve(this._model);
	}

	private _updateModel(): void {
		Promise.all([
			this._timerService.whenReady(),
		]).then(async () => {
			if (this._model && !this._model.isDisposed()) {
				const md = new MarkdownBuilder();
				md.heading(1, 'Positron Runtime Startup Diagnostics');
				md.blank();
				this._addSystemInfo(md);
				md.blank();
				this._addAffiliatedRuntimes(md);
				md.blank();
				this._addActiveRuntimes(md);
				md.blank();
				this._addTimeToFirstRuntime(md);
				md.blank();
				this._addStartupPhaseTiming(md);
				md.blank();
				this._addRawPerfMarks(md);
				md.blank();
				this._addPerSessionTiming(md);
				md.blank();
				this._addInterpreterSettings(md);
				md.blank();
				await this._addSessionLaunchInfo(md);
				md.blank();
				this._addDiscoveredRuntimes(md);
				md.blank();
				await this._addOutputChannels(md);

				this._model.setValue(md.value);
			}
		});
	}

	private _addSystemInfo(md: MarkdownBuilder): void {
		const metrics = this._timerService.startupMetrics;
		md.heading(2, 'System Information');
		md.li(`${this._productService.nameShort}: ${this._productService.positronVersion} build ${this._productService.positronBuildNumber} (Code OSS ${this._productService.version})`);
		md.li(`Commit: ${this._productService.commit || 'unknown'}`);
		md.li(`OS: ${metrics.platform}(${metrics.release})`);
		if (metrics.cpus) {
			md.li(`CPUs: ${metrics.cpus.model}(${metrics.cpus.count} x ${metrics.cpus.speed})`);
		}
		if (typeof metrics.totalmem === 'number' && typeof metrics.freemem === 'number') {
			md.li(`Memory(System): ${(metrics.totalmem / (ByteSize.GB)).toFixed(2)} GB (${(metrics.freemem / (ByteSize.GB)).toFixed(2)}GB free)`);
		}
		md.li(`Initial Startup: ${metrics.initialStartup}`);
	}

	private _addInterpreterSettings(md: MarkdownBuilder): void {
		md.heading(2, 'Interpreter Settings');

		// Helper to format a setting value for display
		const fmt = (value: unknown): string => {
			if (value === undefined || value === null) {
				return '(not set)';
			}
			if (Array.isArray(value)) {
				return value.length === 0 ? '[]' : JSON.stringify(value);
			}
			if (typeof value === 'object') {
				return JSON.stringify(value);
			}
			return String(value);
		};

		// Helper to read a setting with language-specific override
		const getLangOverride = (languageId: string, key: string): string | undefined => {
			const overridden = this._configurationService.getValue(key, {
				overrideIdentifier: languageId,
			});
			const base = this._configurationService.getValue(key);
			if (overridden !== base) {
				return fmt(overridden);
			}
			return undefined;
		};

		// Global startup behavior
		md.heading(3, 'Startup Behavior');
		const startupBehavior = this._configurationService.getValue<string>('interpreters.startupBehavior');
		md.li(`\`interpreters.startupBehavior\`: ${fmt(startupBehavior)}`);

		// Per-language overrides for startup behavior
		const pythonOverride = getLangOverride('python', 'interpreters.startupBehavior');
		if (pythonOverride) {
			md.li(`\`[python] interpreters.startupBehavior\`: ${pythonOverride}`);
		}
		const rOverride = getLangOverride('r', 'interpreters.startupBehavior');
		if (rOverride) {
			md.li(`\`[r] interpreters.startupBehavior\`: ${rOverride}`);
		}

		const restartOnCrash = this._configurationService.getValue<boolean>('interpreters.restartOnCrash');
		md.li(`\`interpreters.restartOnCrash\`: ${fmt(restartOnCrash)}`);

		// Python settings
		md.blank();
		md.heading(3, 'Python');
		const pythonSettings: Array<[string, string]> = [
			['python.defaultInterpreterPath', 'Default interpreter path'],
			['python.interpreters.include', 'Additional discovery paths'],
			['python.interpreters.exclude', 'Excluded paths'],
			['python.interpreters.override', 'Override list'],
			['python.environmentProviders.enable', 'Environment providers'],
			['python.locator', 'Locator implementation'],
		];
		for (const [key, _label] of pythonSettings) {
			const value = this._configurationService.getValue(key);
			md.li(`\`${key}\`: ${fmt(value)}`);
		}

		// R settings
		md.blank();
		md.heading(3, 'R');
		const rSettings: Array<[string, string]> = [
			['positron.r.interpreters.default', 'Default R binary'],
			['positron.r.customBinaries', 'Additional R binaries'],
			['positron.r.customRootFolders', 'Additional root folders'],
			['positron.r.interpreters.exclude', 'Excluded paths'],
			['positron.r.interpreters.override', 'Override list'],
			['positron.r.interpreters.condaDiscovery', 'Conda discovery (experimental)'],
			['positron.r.interpreters.pixiDiscovery', 'Pixi discovery (experimental)'],
		];
		for (const [key, _label] of rSettings) {
			const value = this._configurationService.getValue(key);
			md.li(`\`${key}\`: ${fmt(value)}`);
		}
	}

	private _addActiveRuntimes(md: MarkdownBuilder): void {
		md.heading(2, 'Active Sessions');

		const sessions = this._runtimeSessionService.activeSessions;
		if (sessions.length === 0) {
			md.li('No active runtime sessions');
			return;
		}

		const table: Array<Array<string>> = [];
		for (const session of sessions) {
			table.push([
				session.runtimeMetadata.runtimeName,
				session.dynState.sessionName || '-',
				session.metadata.sessionMode,
				session.getRuntimeState().toString(),
				session.metadata.startReason || '-',
				session.metadata.createdTimestamp ? new Date(session.metadata.createdTimestamp).toLocaleTimeString() : '-'
			]);
		}
		md.table(['Runtime', 'Name', 'Mode', 'State', 'Start Reason', 'Created'], table);
	}

	private async _addSessionLaunchInfo(md: MarkdownBuilder): Promise<void> {
		md.heading(2, 'Session Launch Parameters');

		const sessions = this._runtimeSessionService.activeSessions;
		if (sessions.length === 0) {
			md.li('No active sessions');
			return;
		}

		for (const session of sessions) {
			if (!session.getLaunchInfo) {
				continue;
			}

			let launchInfo: ILanguageRuntimeLaunchInfo | undefined;
			try {
				launchInfo = await session.getLaunchInfo();
			} catch {
				// Session may not support launch info; skip it.
				continue;
			}

			if (!launchInfo) {
				continue;
			}

			md.heading(3, session.runtimeMetadata.runtimeName);

			// Command line
			md.li(`**argv**: \`${launchInfo.argv.join(' ')}\``);

			// Startup command (e.g. conda activate)
			if (launchInfo.startupCommand) {
				md.li(`**Startup command**: \`${launchInfo.startupCommand}\``);
			}

			// Protocol and interrupt mode
			if (launchInfo.protocolVersion) {
				md.li(`**Protocol version**: ${launchInfo.protocolVersion}`);
			}
			if (launchInfo.interruptMode) {
				md.li(`**Interrupt mode**: ${launchInfo.interruptMode}`);
			}

			// Environment variables
			const envKeys = Object.keys(launchInfo.env);
			if (envKeys.length > 0) {
				md.li(`**Environment variables** (${envKeys.length}):`);
				const envTable: Array<Array<string>> = [];
				for (const key of envKeys.sort()) {
					envTable.push([key, maskEnvValue(key, launchInfo.env[key])]);
				}
				md.blank();
				md.table(['Variable', 'Value'], envTable);
			} else {
				md.li('**Environment variables**: (none)');
			}
			md.blank();
		}
	}

	private _addTimeToFirstRuntime(md: MarkdownBuilder): void {
		md.heading(2, 'Time to First Runtime Ready');

		const marks = this._getPositronPerfMarks();
		const startupBegin = marks.find(m => m.name === 'code/positron/runtimeStartupBegin');
		const firstReady = marks.find(m => m.name === 'code/positron/firstRuntimeReady');

		if (startupBegin && firstReady) {
			const duration = Math.round(firstReady.startTime - startupBegin.startTime);
			md.li(`First runtime ready: ${duration}ms after runtime startup began`);
		} else if (!firstReady) {
			md.li('No runtime has reached ready state yet');
		} else {
			md.li('Unable to calculate (missing perf marks)');
		}
	}

	private _addStartupPhaseTiming(md: MarkdownBuilder): void {
		md.heading(2, 'Startup Phase Progression');

		const currentPhase = this._languageRuntimeService.startupPhase;
		// RuntimeStartupPhase is a string enum, so currentPhase is already the string value
		// Capitalize the first letter for display
		const phaseName = currentPhase.charAt(0).toUpperCase() + currentPhase.slice(1);
		md.li(`Current Phase: ${phaseName}`);
		md.blank();

		const marks = this._getPositronPerfMarks();
		const phaseMarks = marks.filter(m => m.name.startsWith('code/positron/runtimeStartupPhase/'));

		if (phaseMarks.length === 0) {
			md.li('No startup phase marks recorded');
			return;
		}

		const table: Array<Array<string | number>> = [];
		let lastTime = phaseMarks[0].startTime;

		for (const mark of phaseMarks) {
			const phaseName = mark.name.replace('code/positron/runtimeStartupPhase/', '');
			const duration = mark === phaseMarks[0] ? '-' : Math.round(mark.startTime - lastTime);
			table.push([phaseName, Math.round(mark.startTime), duration]);
			lastTime = mark.startTime;
		}
		md.table(['Phase', 'Timestamp (ms)', 'Duration (ms)'], table);
	}

	private _addPerSessionTiming(md: MarkdownBuilder): void {
		md.heading(2, 'Individual Session Startup Times');

		const marks = this._getPositronPerfMarks();
		const sessionMarks = marks.filter(m => m.name.startsWith('code/positron/runtimeSessionStart/'));

		if (sessionMarks.length === 0) {
			md.li('No session start marks recorded');
			return;
		}

		const startupBegin = marks.find(m => m.name === 'code/positron/runtimeStartupBegin');
		const baseTime = startupBegin?.startTime || 0;

		const table: Array<Array<string | number>> = [];
		for (const mark of sessionMarks) {
			const sessionId = mark.name.replace('code/positron/runtimeSessionStart/', '');
			// Try to find the session to get the runtime name
			const session = this._runtimeSessionService.getSession(sessionId);
			const runtimeName = session?.runtimeMetadata.runtimeName || 'Unknown';
			const relativeTime = Math.round(mark.startTime - baseTime);
			table.push([runtimeName, sessionId.substring(0, 12) + '...', relativeTime]);
		}
		md.table(['Runtime', 'Session ID', 'Start Time (ms)'], table);
	}

	private _addAffiliatedRuntimes(md: MarkdownBuilder): void {
		md.heading(2, 'Workspace-Affiliated Runtimes');

		const affiliatedRuntimes = this._runtimeStartupService.getAffiliatedRuntimes();

		if (affiliatedRuntimes.length === 0) {
			md.li('No affiliated runtimes for this workspace');
			return;
		}

		const activeSessions = this._runtimeSessionService.activeSessions;

		const table: Array<Array<string>> = [];
		for (const runtime of affiliatedRuntimes) {
			// Find sessions that match this runtime
			const matchingSessions = activeSessions.filter(
				session => session.runtimeMetadata.runtimeId === runtime.runtimeId
			);
			const hasSession = matchingSessions.length > 0;
			const sessionIds = hasSession
				? matchingSessions.map(s => s.sessionId).join(', ')
				: '-';

			table.push([
				runtime.runtimeName,
				runtime.languageId,
				runtime.languageVersion,
				runtime.runtimeSource || '-',
				hasSession ? 'Yes' : 'No',
				sessionIds
			]);
		}
		md.table(['Name', 'Language', 'Version', 'Source', 'Has Session', 'Session ID(s)'], table);
	}

	private _addDiscoveredRuntimes(md: MarkdownBuilder): void {
		md.heading(2, 'Discovered Runtimes');

		const runtimes = this._languageRuntimeService.registeredRuntimes;

		if (runtimes.length === 0) {
			md.li('No runtimes have been discovered');
			return;
		}

		const table: Array<Array<string>> = [];
		for (const runtime of runtimes) {
			table.push([
				runtime.extensionId.value,
				runtime.runtimeName,
				runtime.runtimePath
			]);
		}
		md.table(['Extension', 'Name', 'Path'], table);
	}

	private _addRawPerfMarks(md: MarkdownBuilder): void {
		md.heading(2, 'Positron Runtime Performance Marks');

		const marks = this._getPositronPerfMarks();

		if (marks.length === 0) {
			md.li('No Positron runtime perf marks recorded');
			return;
		}

		const table: Array<Array<string | number>> = [];
		let lastStartTime = -1;
		let total = 0;
		for (const { name, startTime } of marks) {
			const delta = lastStartTime !== -1 ? startTime - lastStartTime : 0;
			total += delta;
			table.push([name, Math.round(startTime), Math.round(delta), Math.round(total)]);
			lastStartTime = startTime;
		}
		md.table(['Name', 'Timestamp', 'Delta', 'Total'], table);
	}

	private static readonly OUTPUT_CHANNEL_LABELS = [
		'Kernel Supervisor',
		'Python Language Pack',
		'Python Kernel',
		'Python Supervisor',
		'R Language Pack',
		'R Kernel',
		'R Supervisor',
	];

	private static readonly OUTPUT_CHANNEL_MAX_LINES = 50;

	private async _addOutputChannels(md: MarkdownBuilder): Promise<void> {
		md.heading(2, 'Output Channels');

		const descriptors = this._outputService.getChannelDescriptors();
		let hasContent = false;

		for (const label of PositronStartupDiagnosticsContentProvider.OUTPUT_CHANNEL_LABELS) {
			const descriptor = descriptors.find(d => d.label === label);
			if (!descriptor) {
				continue;
			}

			const channel = this._outputService.getChannel(descriptor.id);
			if (!channel) {
				continue;
			}

			try {
				const modelRef = await this._textModelService.createModelReference(channel.uri);
				try {
					const content = modelRef.object.textEditorModel.getValue();
					if (!content) {
						continue;
					}

					const lines = content.split('\n');
					const maxLines = PositronStartupDiagnosticsContentProvider.OUTPUT_CHANNEL_MAX_LINES;
					const truncatedLines = lines.length > maxLines
						? lines.slice(-maxLines)
						: lines;
					const truncatedContent = truncatedLines.join('\n');

					hasContent = true;
					md.heading(3, label);
					if (lines.length > maxLines) {
						md.li(`Showing last ${maxLines} of ${lines.length} lines`);
						md.blank();
					}
					md.codeFence(truncatedContent);
					md.blank();
				} finally {
					modelRef.dispose();
				}
			} catch {
				// Channel content not available; skip it.
			}
		}

		if (!hasContent) {
			md.li('No output channel content available');
		}
	}

	private _getPositronPerfMarks(): perf.PerformanceMark[] {
		// Read marks directly from the performance API rather than from the
		// timer service snapshot, which is captured early during startup and
		// misses marks recorded after that point.
		return perf.getMarks().filter(m => m.name.startsWith('code/positron/'));
	}
}

/**
 * Masks the value of an environment variable if its name or value suggests it
 * contains sensitive material (secrets, certificates, or private keys).
 */
function maskEnvValue(name: string, value: string): string {
	const upperName = name.toUpperCase();
	if (upperName.includes('SECRET') || upperName.includes('CERT') || upperName.includes('KEY')) {
		return '***';
	}
	if (value.includes('BEGIN CERTIFICATE') || value.includes('BEGIN PRIVATE KEY')) {
		return '***';
	}
	return value;
}

class MarkdownBuilder {

	value: string = '';

	heading(level: number, value: string): this {
		this.value += `${'#'.repeat(level)} ${value}\n\n`;
		return this;
	}

	blank() {
		this.value += '\n';
		return this;
	}

	li(value: string) {
		this.value += `* ${value}\n`;
		return this;
	}

	codeFence(content: string) {
		this.value += '```\n' + content + '\n```\n';
		return this;
	}

	table(header: string[], rows: Array<Array<{ toString(): string } | undefined>>) {
		this.value += this.toMarkdownTable(header, rows);
	}

	private toMarkdownTable(header: string[], rows: Array<Array<{ toString(): string } | undefined>>): string {
		let result = '';

		const lengths: number[] = [];
		header.forEach((cell, ci) => {
			lengths[ci] = cell.length;
		});
		rows.forEach(row => {
			row.forEach((cell, ci) => {
				if (typeof cell === 'undefined') {
					cell = row[ci] = '-';
				}
				const len = cell.toString().length;
				lengths[ci] = Math.max(len, lengths[ci]);
			});
		});

		// header
		header.forEach((cell, ci) => { result += `| ${cell + ' '.repeat(lengths[ci] - cell.toString().length)} `; });
		result += '|\n';
		header.forEach((_cell, ci) => { result += `| ${'-'.repeat(lengths[ci])} `; });
		result += '|\n';

		// cells
		rows.forEach(row => {
			row.forEach((cell, ci) => {
				if (typeof cell !== 'undefined') {
					result += `| ${cell + ' '.repeat(lengths[ci] - cell.toString().length)} `;
				}
			});
			result += '|\n';
		});

		return result;
	}
}
