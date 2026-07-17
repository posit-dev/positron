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
import { IStartupMetrics, ITimerService } from '../../../services/timer/browser/timerService.js';
import { IDisposable, dispose } from '../../../../base/common/lifecycle.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { IExtensionService, IResponsiveStateChangeEvent } from '../../../services/extensions/common/extensions.js';
import { ExtensionHostKind } from '../../../services/extensions/common/extensionHostKind.js';
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
import {
	IRuntimeDiscoveryCache,
	RUNTIME_DISCOVERY_CACHE_ENABLED_SETTING
} from '../../../services/runtimeStartup/common/runtimeDiscoveryCacheService.js';
import { getRuntimeDisplayPath, ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IOutputService } from '../../../services/output/common/output.js';
import { IAdminPolicyService } from '../../../../platform/policy/common/adminPolicyService.js';
import * as perf from '../../../../base/common/performance.js';

/**
 * Setting that controls how long the Runtime Startup Diagnostics report waits
 * for a response from the extension host before giving up and rendering the
 * rest of the report without that data. Configurable for slower systems.
 */
export const EXTENSION_HOST_TIMEOUT_CONFIG_KEY = 'startupDiagnostics.timeout';

/** Default value (ms) for {@link EXTENSION_HOST_TIMEOUT_CONFIG_KEY}. */
export const EXTENSION_HOST_TIMEOUT_DEFAULT_MS = 10000;

export class PositronStartupDiagnosticsContrib implements IDisposable {

	static get() {
		return getWorkbenchContribution<PositronStartupDiagnosticsContrib>(PositronStartupDiagnosticsContrib.ID);
	}

	static readonly ID = 'workbench.contrib.positronStartupDiagnostics';

	private readonly _inputUri = URI.from({ scheme: 'positron-startup-diagnostics', path: 'Runtime Startup Diagnostics' });
	private readonly _registration: IDisposable;
	private readonly _provider: PositronStartupDiagnosticsContentProvider;

	constructor(
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@ITextModelService textModelResolverService: ITextModelService
	) {
		this._provider = _instaService.createInstance(PositronStartupDiagnosticsContentProvider);
		this._registration = textModelResolverService.registerTextModelContentProvider(
			'positron-startup-diagnostics',
			this._provider
		);
	}

	dispose(): void {
		this._registration.dispose();
		this._provider.dispose();
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

class PositronStartupDiagnosticsContentProvider implements ITextModelContentProvider, IDisposable {

	private _model: ITextModel | undefined;
	private _modelDisposables: IDisposable[] = [];
	private _disposables: IDisposable[] = [];

	// Latest known responsive state per extension host kind, populated by
	// onDidChangeResponsiveChange. A host that has never reported a transition
	// is omitted from the map (and we surface that as "no transitions reported").
	private readonly _hostResponsiveState = new Map<ExtensionHostKind, boolean>();

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
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IRuntimeDiscoveryCache private readonly _discoveryCache: IRuntimeDiscoveryCache,
		@IExtensionService private readonly _extensionService: IExtensionService,
	) {
		this._disposables.push(this._extensionService.onDidChangeResponsiveChange(
			(e: IResponsiveStateChangeEvent) => {
				this._hostResponsiveState.set(e.extensionHostKind, e.isResponsive);
			}));
	}

	dispose(): void {
		dispose(this._disposables);
		dispose(this._modelDisposables);
	}

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
		this._updateModel().catch(() => {
			// _updateModel is best-effort; failures leave the model showing the
			// initial placeholder rather than blocking the editor from opening.
		});
		return Promise.resolve(this._model);
	}

	private async _updateModel(): Promise<void> {
		// Wait for the timer service barrier so _addSystemInfo can read
		// startupMetrics, but cap the wait. The diagnostics report's job is to
		// surface state even when startup is wedged (which is exactly when the
		// barrier may not open), so we render best-effort if the wait expires.
		await raceTimeout(this._timerService.whenReady(), 5000);

		if (!this._model || this._model.isDisposed()) {
			return;
		}

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
		this._addAdminEnforcedSettings(md);
		md.blank();
		await this._addSessionLaunchInfo(md);
		md.blank();
		this._addDiscoveredRuntimes(md);
		md.blank();
		this._addDiscoveryCache(md);
		md.blank();
		this._addExtensionHostStatus(md);
		md.blank();
		await this._addOutputChannels(md);

		// Re-check after the awaits above; the model may have been disposed
		// while we were gathering data.
		if (this._model && !this._model.isDisposed()) {
			this._model.setValue(md.value);
		}
	}

	private _addSystemInfo(md: MarkdownBuilder): void {
		md.heading(2, 'System Information');
		md.li(`${this._productService.nameShort}: ${this._productService.positronVersion} build ${this._productService.positronBuildNumber} (Code OSS ${this._productService.version})`);
		md.li(`Commit: ${this._productService.commit || 'unknown'}`);

		// startupMetrics throws if accessed before the timer service barrier opens.
		// Tolerate that: emit a note and continue so the rest of the report renders.
		let metrics: IStartupMetrics | undefined;
		try {
			metrics = this._timerService.startupMetrics;
		} catch {
			md.li('Startup metrics: not yet available (timer service not ready)');
			return;
		}
		md.li(`OS: ${metrics.platform}(${metrics.release})`);
		if (metrics.cpus) {
			md.li(`CPUs: ${metrics.cpus.model}(${metrics.cpus.count} x ${metrics.cpus.speed})`);
		}
		if (typeof metrics.totalmem === 'number' && typeof metrics.freemem === 'number') {
			md.li(`Memory(System): ${(metrics.totalmem / (ByteSize.GB)).toFixed(2)} GB (${(metrics.freemem / (ByteSize.GB)).toFixed(2)}GB free)`);
		}
		md.li(`Initial Startup: ${metrics.initialStartup}`);
	}

	private _addExtensionHostStatus(md: MarkdownBuilder): void {
		md.heading(2, 'Extension Host Status');

		// Registered extension count. Synchronous local data; if the extension
		// host never finished registering (e.g. it's hung), this will be empty
		// and is itself a useful diagnostic signal.
		const registered = this._extensionService.extensions;
		md.li(`Registered extensions: ${registered.length}`);

		// Determine which extension host kinds are actually in use by looking
		// at where each registered extension is running. Hosts default to
		// "Responsive": onDidChangeResponsiveChange only fires on transitions,
		// so the absence of an event means the host has stayed responsive
		// since startup.
		const status = this._extensionService.getExtensionsStatus();
		const kindsInUse = new Set<ExtensionHostKind>();
		for (const id of Object.keys(status)) {
			const loc = status[id].runningLocation;
			if (loc) {
				kindsInUse.add(loc.kind);
			}
		}

		md.blank();
		if (kindsInUse.size === 0) {
			md.li('No extension hosts running');
		} else {
			const stateRows: Array<Array<string>> = [];
			for (const kind of kindsInUse) {
				const isResponsive = this._hostResponsiveState.get(kind) ?? true;
				stateRows.push([extensionHostKindLabel(kind), isResponsive ? 'Responsive' : 'Unresponsive']);
			}
			md.table(['Extension Host', 'State'], stateRows);
		}
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

	private _addAdminEnforcedSettings(md: MarkdownBuilder): void {
		let adminPolicyService: IAdminPolicyService | undefined;
		try {
			adminPolicyService = this._instantiationService.invokeFunction(accessor => accessor.get(IAdminPolicyService));
		} catch {
			// Service not available in this environment.
			return;
		}
		const policies = adminPolicyService.getAllSettings();
		if (policies.length === 0) {
			return;
		}

		md.heading(2, 'Admin Enforced Settings');

		const table: Array<Array<string>> = [];
		for (const policy of policies) {
			const value = typeof policy.value === 'object'
				? JSON.stringify(policy.value)
				: String(policy.value);
			table.push([policy.key, value]);
		}
		md.table(['Setting', 'Value'], table);
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

		// Kick off all getLaunchInfo() calls in parallel against a single shared
		// timeout window. Awaiting them sequentially would multiply the wait by
		// the number of active sessions when the extension host is unresponsive.
		const timeoutMs = this._configurationService.getValue<number>(EXTENSION_HOST_TIMEOUT_CONFIG_KEY);
		const results = await Promise.all(sessions.map(async session => {
			if (!session.getLaunchInfo) {
				return undefined;
			}

			let timedOut: boolean = false;
			try {
				const launchInfo = await raceTimeout(
					Promise.resolve(session.getLaunchInfo()),
					timeoutMs,
					() => { timedOut = true; }
				);
				return { session, launchInfo, timedOut };
			} catch {
				// Session may not support launch info; skip it.
				return undefined;
			}
		}));

		for (const result of results) {
			if (!result) {
				continue;
			}
			const { session, launchInfo, timedOut } = result;

			if (timedOut) {
				md.heading(3, session.runtimeMetadata.runtimeName);
				md.li(`(Could not retrieve launch info: extension host did not respond within ${timeoutMs / 1000}s)`);
				md.blank();
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

	private _addDiscoveryCache(md: MarkdownBuilder): void {
		md.heading(2, 'Discovery Cache');

		const enabled = this._configurationService.getValue<boolean>(RUNTIME_DISCOVERY_CACHE_ENABLED_SETTING);

		if (enabled === false) {
			md.blank();
			md.li('_Discovery cache disabled by setting -- no entries are read or written this session._');
			return;
		}

		const counters = this._discoveryCache.sessionCounters;
		md.blank();
		md.heading(3, 'This-session counters');
		md.li(`Foreground cache-hit registrations: ${counters.foregroundHits}`);
		md.li(`Background revalidations attempted / succeeded / failed: ${counters.revalidationsAttempted} / ${counters.revalidationsSucceeded} / ${counters.revalidationsFailed}`);
		md.li(`Evictions this session: ${counters.evictions}`);
		md.li(`Full-discovery passes this session: ${counters.fullDiscoveryRuns.length}`);
		md.li(`Full-discovery passes triggered by root changes: ${counters.rootsChangedFullDiscoveries}`);
		if (counters.fullDiscoveryRuns.length > 0) {
			const reasonTable: Array<Array<string>> = counters.fullDiscoveryRuns.map(r => [
				r.extensionId, r.languageId, r.reason, new Date(r.at).toISOString(),
			]);
			md.table(['Extension', 'Language', 'Reason', 'At'], reasonTable);
		}

		const buckets = this._discoveryCache.getAllBuckets();
		md.blank();
		md.heading(3, 'Per-bucket state');
		if (buckets.length === 0) {
			md.li('No cached entries.');
			return;
		}

		const fmtAge = (ts: number): string => {
			if (!ts) { return '-'; }
			const ageMs = Date.now() - ts;
			if (ageMs < 0) { return '-'; }
			const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
			const hours = Math.floor((ageMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
			if (days > 0) { return `${days}d ${hours}h ago`; }
			if (hours > 0) { return `${hours}h ago`; }
			const minutes = Math.floor(ageMs / (60 * 1000));
			return `${minutes}m ago`;
		};

		const rows: Array<Array<string>> = [];
		for (const bucket of buckets) {
			let oldestFirstSeen = 0;
			let newestValidated = 0;
			for (const entry of bucket.entries) {
				if (oldestFirstSeen === 0 || entry.firstSeen < oldestFirstSeen) {
					oldestFirstSeen = entry.firstSeen;
				}
				if (entry.lastValidated > newestValidated) {
					newestValidated = entry.lastValidated;
				}
			}
			rows.push([
				bucket.extensionId,
				bucket.languageId,
				String(bucket.entries.length),
				fmtAge(oldestFirstSeen),
				fmtAge(newestValidated),
				fmtAge(bucket.lastFullDiscovery),
			]);
		}
		md.table(
			['Extension', 'Language', 'Entries', 'Oldest firstSeen', 'Newest lastValidated', 'lastFullDiscovery'],
			rows);

		// Per-bucket root-signature breakdown. Renders the persisted snapshot
		// of "the directories this manager scans for interpreters" so support
		// can see whether a warm-start root-change check would have fired.
		md.blank();
		md.heading(3, 'Discovery Root Signatures');
		const bucketsWithSignatures = buckets.filter(b => b.discoveryRootSignature);
		if (bucketsWithSignatures.length === 0) {
			md.li('No persisted root signatures. Either the cache predates the v2 schema, or no manager implements `getDiscoveryRootSignature`.');
		} else {
			for (const bucket of bucketsWithSignatures) {
				const sig = bucket.discoveryRootSignature!;
				md.blank();
				md.heading(4, `${bucket.extensionId} / ${bucket.languageId}`);
				md.li(`Roots: ${sig.entries.length}${sig.opaque ? ' (with opaque blob)' : ''}`);
				if (sig.entries.length > 0) {
					const sigRows: Array<Array<string>> = sig.entries.map(e => [
						e.path,
						e.exists ? 'yes' : 'no',
						e.exists ? new Date(e.mtimeMs).toISOString() : '-',
					]);
					md.table(['Path', 'Exists', 'mtime'], sigRows);
				}
			}
		}
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
				getRuntimeDisplayPath(runtime)
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

function extensionHostKindLabel(kind: ExtensionHostKind): string {
	switch (kind) {
		case ExtensionHostKind.LocalProcess: return 'Local Process';
		case ExtensionHostKind.LocalWebWorker: return 'Local Web Worker';
		case ExtensionHostKind.Remote: return 'Remote';
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
