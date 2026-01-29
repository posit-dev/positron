/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../platform/workspace/common/workspace.js';
import * as perf from '../../../../base/common/performance.js';

export class PositronStartupDiagnosticsContrib {

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
			localize('positronStartupDiagnostics.title', 'Positron: Runtime Startup Diagnostics'),
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
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService
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
		]).then(() => {
			if (this._model && !this._model.isDisposed()) {
				const md = new MarkdownBuilder();
				md.heading(1, 'Positron Runtime Startup Diagnostics');
				md.blank();
				this._addSystemInfo(md);
				md.blank();
				this._addWorkspaceInfo(md);
				md.blank();
				this._addActiveRuntimes(md);
				md.blank();
				this._addTimeToFirstRuntime(md);
				md.blank();
				this._addStartupPhaseTiming(md);
				md.blank();
				this._addPerSessionTiming(md);
				md.blank();
				this._addAffiliatedRuntimes(md);
				md.blank();
				this._addDiscoveredRuntimes(md);
				md.blank();
				this._addRestoredSessions(md);
				md.blank();
				this._addRawPerfMarks(md);

				this._model.setValue(md.value);
			}
		});
	}

	private _addSystemInfo(md: MarkdownBuilder): void {
		const metrics = this._timerService.startupMetrics;
		md.heading(2, 'System Information');
		md.li(`${this._productService.nameShort}: ${this._productService.version} (${this._productService.commit || '0000000'})`);
		md.li(`OS: ${metrics.platform}(${metrics.release})`);
		if (metrics.cpus) {
			md.li(`CPUs: ${metrics.cpus.model}(${metrics.cpus.count} x ${metrics.cpus.speed})`);
		}
		if (typeof metrics.totalmem === 'number' && typeof metrics.freemem === 'number') {
			md.li(`Memory(System): ${(metrics.totalmem / (ByteSize.GB)).toFixed(2)} GB (${(metrics.freemem / (ByteSize.GB)).toFixed(2)}GB free)`);
		}
		md.li(`Initial Startup: ${metrics.initialStartup}`);
	}

	private _addWorkspaceInfo(md: MarkdownBuilder): void {
		md.heading(2, 'Workspace Information');

		const workbenchState = this._workspaceContextService.getWorkbenchState();
		let workspaceType: string;
		switch (workbenchState) {
			case WorkbenchState.EMPTY:
				workspaceType = 'Empty (no folder open)';
				break;
			case WorkbenchState.FOLDER:
				workspaceType = 'Single Folder';
				break;
			case WorkbenchState.WORKSPACE:
				workspaceType = 'Multi-Root Workspace';
				break;
			default:
				workspaceType = 'Unknown';
		}

		md.li(`Workspace Type: ${workspaceType}`);

		const workspace = this._workspaceContextService.getWorkspace();
		if (workspace.folders.length > 0) {
			if (workspace.folders.length === 1) {
				md.li(`Workspace Path: ${workspace.folders[0].uri.fsPath}`);
			} else {
				md.li(`Workspace Folders:`);
				for (const folder of workspace.folders) {
					md.li(`  - ${folder.uri.fsPath}`);
				}
			}
		}
	}

	private _addActiveRuntimes(md: MarkdownBuilder): void {
		md.heading(2, 'Active Runtime Sessions');

		const sessions = this._runtimeSessionService.activeSessions;
		if (sessions.length === 0) {
			md.li('No active runtime sessions');
			return;
		}

		const table: Array<Array<string>> = [];
		for (const session of sessions) {
			table.push([
				session.runtimeMetadata.runtimeName,
				session.runtimeMetadata.languageId,
				session.metadata.sessionMode,
				session.getRuntimeState().toString(),
				session.metadata.startReason || '-',
				session.metadata.createdTimestamp ? new Date(session.metadata.createdTimestamp).toLocaleTimeString() : '-'
			]);
		}
		md.table(['Runtime Name', 'Language', 'Mode', 'State', 'Start Reason', 'Created'], table);
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
				runtime.runtimeId,
				runtime.extensionId.value,
				runtime.runtimeName,
				runtime.runtimePath
			]);
		}
		md.table(['Runtime ID', 'Extension', 'Name', 'Path'], table);
	}

	private _addRestoredSessions(md: MarkdownBuilder): void {
		md.heading(2, 'Restored/Reconnected Sessions');

		this._runtimeStartupService.getRestoredSessions().then(sessions => {
			if (sessions.length === 0) {
				// Model may have been updated already, skip
				return;
			}

			// We can't easily update the model async, so just note that there were restored sessions
			// The active sessions table will show sessions that were successfully restored
		});

		// For now, just indicate if there are any restored sessions in the active sessions
		const sessions = this._runtimeSessionService.activeSessions;
		const restoredSessions = sessions.filter(s => s.metadata.startReason?.includes('Reconnect') || s.metadata.startReason?.includes('restored'));

		if (restoredSessions.length === 0) {
			md.li('No restored sessions (or sessions were restored and are shown in Active Sessions)');
			return;
		}

		const table: Array<Array<string>> = [];
		for (const session of restoredSessions) {
			table.push([
				session.dynState.sessionName,
				session.runtimeMetadata.languageId,
				session.metadata.sessionMode,
				session.getRuntimeState().toString(),
				session.metadata.createdTimestamp ? new Date(session.metadata.createdTimestamp).toLocaleString() : '-'
			]);
		}
		md.table(['Session Name', 'Language', 'Mode', 'State', 'Created'], table);
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

	private _getPositronPerfMarks(): perf.PerformanceMark[] {
		const allMarks = this._timerService.getPerformanceMarks();
		const rendererMarks = allMarks.find(e => e[0] === 'renderer')?.[1] || [];
		return rendererMarks.filter(m => m.name.startsWith('code/positron/'));
	}
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
