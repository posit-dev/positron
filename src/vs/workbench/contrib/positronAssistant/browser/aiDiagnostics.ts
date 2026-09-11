/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IExtensionManagementService, ILocalExtension } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { PlatformToString, platform } from '../../../../base/common/platform.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { parse } from '../../../../base/common/json.js';
import { Schemas } from '../../../../base/common/network.js';
import { IExtensionService, IExtensionsStatus } from '../../../services/extensions/common/extensions.js';
import { IAiProviderService } from '../../../services/positronAiProvider/common/aiProviderService.js';
import { IHeadlessLanguageModelService, IModelListingDiagnostics } from '../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IUntitledTextResourceEditorInput } from '../../../common/editor.js';
import { hasExplicitValue, matchesSensitiveKey, REDACTED_VALUE, REPORT_SENSITIVE_KEYS } from '../common/settingsInspection.js';
import { IOutputService, isMultiSourceOutputChannelDescriptor, isSingleSourceOutputChannelDescriptor } from '../../../services/output/common/output.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { ChatConfiguration } from '../../chat/common/constants.js';
import { AI_ENABLED_KEY } from '../common/positronAIConfiguration.js';
import { NES_ENABLE_SETTING } from './nextEditSuggestionsDashboard.js';
import { GIT_SUGGESTIONS_ENABLED_KEY } from './commitMessageAction.js';
import { NOTEBOOK_AI_ENABLED_KEY } from '../../positronNotebook/common/positronNotebookConfig.js';

/**
 * A single AI-related setting whose value differs from its registered default.
 */
export interface IAIDiagnosticsSetting {
	readonly key: string;
	readonly value: unknown;
}

/**
 * One model registered with the built-in language model API, projected to the
 * few fields the report shows.
 */
export interface IAIDiagnosticsBuiltinModel {
	readonly id: string;
	readonly name: string;
	/** The provider that registered it (e.g. "copilot"); groups the model in the report. */
	readonly provider: string;
}

/** One model row under a provider, from either source. */
interface IAIDiagnosticsModelRow {
	readonly id: string;
	readonly name: string;
	/** The vendor the provider branded the model as, where it reports one. */
	readonly vendor?: string;
}

/**
 * A block of collected logs for one AI surface.
 */
export interface IAIDiagnosticsLogSection {
	readonly label: string;
	readonly content: string;
}

/** Whether an AI extension is running, installed but switched off, or absent. */
export type AIDiagnosticsExtensionPresence = 'running' | 'disabled' | 'missing';

/**
 * One AI-related extension's presence/version/activation state.
 */
export interface IAIDiagnosticsExtension {
	readonly label: string;
	readonly id: string;
	readonly presence: AIDiagnosticsExtensionPresence;
	/** `undefined` when the extension is not installed. */
	readonly version: string | undefined;
	/** Activation state (e.g. "active", "not activated, 1 runtime error"); only meaningful when running. */
	readonly status?: string;
	/** Manifest/extension-point problem and runtime error text. */
	readonly messages?: readonly string[];
}

/** One AI feature's on/off state, as shown in the report. */
export interface IAIDiagnosticsFeature {
	readonly label: string;
	/** The setting key that controls this feature. */
	readonly setting: string;
	/** "Enabled", "Disabled", or a raw value for non-boolean toggles. */
	readonly state: string;
}

/** One setting a Posit Workbench admin enforced through `POSITRON_ENFORCED_SETTINGS`. */
export interface IAIDiagnosticsEnforcedSetting {
	readonly key: string;
	readonly value: string;
}

/**
 * Everything the report needs, gathered by the action and passed to the pure
 * {@link generateAIDiagnosticsReport} formatter so the formatting is testable
 * without services.
 */
export interface IAIDiagnosticsInputs {
	readonly generatedAt: string;
	/** The `ai.enabled` main switch; when false, every AI feature is off regardless of its own toggle. */
	readonly aiEnabled: boolean;
	/** Per-feature on/off state (NES, notebook AI, console Fix & Explain, Copilot chat). */
	readonly features: readonly IAIDiagnosticsFeature[];
	readonly application: string;
	readonly positronVersion: string;
	readonly positronBuildNumber: number;
	readonly vscodeVersion: string;
	readonly commit: string | undefined;
	readonly buildDate: string | undefined;
	readonly quality: string | undefined;
	readonly os: string;
	readonly remote: string | undefined;
	readonly extensions: readonly IAIDiagnosticsExtension[];
	/** Provider labels the user is authenticated with (empty when none/unknown). */
	readonly authenticatedProviders: readonly string[];
	/** Provider labels turned off in settings (empty when none/unknown). */
	readonly disabledProviders: readonly string[];
	/**
	 * What each provider actually contributed, as opposed to what providers.json
	 * declares. Reported per queried provider so a provider that returned nothing,
	 * or whose models all lost the cross-provider de-duplication, is visible rather
	 * than silently absent.
	 */
	readonly modelListing: IModelListingDiagnostics;
	/**
	 * Models registered with the built-in language model API, which is where
	 * GitHub Copilot's live. Merged into the same per-provider listing as
	 * {@link modelListing}: which of the two paths a model arrived through is
	 * Positron's plumbing, not something the report should make the reader parse.
	 */
	readonly builtinModels: readonly IAIDiagnosticsBuiltinModel[];
	/**
	 * True when a model listing timed out or failed, so the section above is
	 * partial. Kept separate from "no models" because the two look identical in
	 * the data and mean opposite things to whoever reads the report.
	 */
	readonly modelsIncomplete: boolean;
	/**
	 * Why the listing is incomplete, when the cause was an error rather than a
	 * timeout. A timeout is worth re-running; an error names what broke.
	 */
	readonly modelsIncompleteReason?: string;
	/**
	 * Contents of providers.json, redacted and rendered inside a JSON fence. A
	 * `// ...` comment line when the file is missing or the catalog is unavailable
	 * (mirrors the settings block's placeholder).
	 */
	readonly providersConfig: string;
	/** Path to providers.json, shown so support knows where the config lives; omitted when unknown. */
	readonly providersConfigPath: string | undefined;
	readonly settings: readonly IAIDiagnosticsSetting[];
	/** Settings a Workbench admin enforced. */
	readonly enforcedSettings: readonly IAIDiagnosticsEnforcedSetting[];
	readonly logs: readonly IAIDiagnosticsLogSection[];
	/** Assistant diagnostics bundle result (path or status); omitted when not requested. */
	readonly bundle?: string;
}

/** How an extension's presence renders when there's no version to show. */
const PRESENCE_LABELS: Record<AIDiagnosticsExtensionPresence, string> = {
	running: 'Installed',
	disabled: 'Installed but disabled',
	missing: 'Not installed',
};

/**
 * Builds the markdown diagnostics report. Pure: no services, no I/O, so it can
 * be unit-tested by feeding stub inputs and snapshotting the output.
 */
export function generateAIDiagnosticsReport(inputs: IAIDiagnosticsInputs): string {
	const settingsBlock = inputs.settings.length === 0
		? '  // No non-default settings configured'
		: inputs.settings
			.map(s => `  "${s.key}": ${JSON.stringify(s.value, null, 2).split('\n').join('\n  ')}`)
			.join(',\n');

	// One line per extension, with any error text as sub-bullets beneath it.
	const extensionsBlock = inputs.extensions
		.map(e => {
			const summary = e.version
				? `Version ${e.version}${e.presence === 'disabled' ? ' (installed but disabled)' : e.status ? ` (${e.status})` : ''}`
				: PRESENCE_LABELS[e.presence];
			const messages = (e.messages ?? []).map(message => `\n  - ${message}`).join('');
			return `- ${e.label}: ${summary}${messages}`;
		})
		.join('\n');

	// Omitted when nothing is enforced.
	const enforcedBlock = inputs.enforcedSettings.length === 0
		? ''
		: `\n## Admin Enforced Settings

Enforced by a Posit Workbench administrator. These cannot be changed from Positron - the fix is a server configuration change.

${inputs.enforcedSettings.map(s => `- \`${s.key}\`: ${s.value}`).join('\n')}
`;

	const logsBlock = inputs.logs
		.map(section => `## ${section.label} Logs\n\n\`\`\`\n${section.content}\n\`\`\``)
		.join('\n\n');

	const providerList = (providers: readonly string[]) =>
		providers.length === 0 ? 'None' : providers.map(p => `- ${p}`).join('\n');

	// One list per provider, merging both places models can come from (the
	// provider sweep and the built-in language model API). Which of the two a
	// model arrived through is Positron's plumbing, not something a reader should
	// have to reason about, so it isn't shown. Group by provider rather than by
	// the model's vendor: vendor is only what the provider branded the model as,
	// and an OpenAI-compatible gateway reports "OpenAI" for a Google model.
	const byProvider = new Map<string, IAIDiagnosticsModelRow[]>();
	const groupFor = (providerId: string): IAIDiagnosticsModelRow[] => {
		let models = byProvider.get(providerId);
		if (!models) {
			models = [];
			byProvider.set(providerId, models);
		}
		return models;
	};
	// Seed every queried provider so one that returned nothing still gets a
	// heading: "signed in but contributed zero models" is worth seeing.
	for (const providerId of inputs.modelListing.queriedProviders) {
		groupFor(providerId);
	}
	for (const model of inputs.modelListing.models) {
		groupFor(model.providerId).push(model);
	}
	for (const model of inputs.builtinModels) {
		const models = groupFor(model.provider);
		// A provider reachable both ways lists the same model twice; keep the
		// sweep's copy, which carries the vendor.
		if (!models.some(existing => existing.id === model.id)) {
			models.push({ id: model.id, name: model.name });
		}
	}

	const modelsBlock = byProvider.size === 0
		? (inputs.modelsIncomplete
			? (inputs.modelsIncompleteReason
				? `Could not be retrieved: ${inputs.modelsIncompleteReason}`
				: 'Could not be retrieved in time. Re-run the report: the listing is cached once it succeeds, so a second run usually has it.')
			: 'None. No provider was queried (each was disabled, had no registered auth backend, or had no credentials) and no extension registered a chat model.')
		: [...byProvider]
			.map(([providerId, models]) => {
				if (models.length === 0) {
					return `**${providerId}** (0)\n\nQueried, but returned no models.`;
				}
				return `**${providerId}** (${models.length})\n\n${models
					.map(m => `- \`${m.id}\` (${m.name && m.name !== m.id ? `${m.name}${m.vendor ? ', ' : ''}` : ''}${m.vendor ?? ''})`)
					.join('\n')}`;
			})
			.join('\n\n');

	const totalModels = [...byProvider.values()].reduce((count, models) => count + models.length, 0);
	const incompleteNote = inputs.modelsIncomplete && byProvider.size > 0
		? (inputs.modelsIncompleteReason
			? `\n\nThis list may be incomplete: ${inputs.modelsIncompleteReason}`
			: '\n\nSome providers did not respond in time, so this list may be incomplete.')
		: '';

	const optionalLine = (label: string, value: string | undefined) => value ? `\n- ${label}: ${value}` : '';

	const featuresBlock = [
		inputs.aiEnabled
			? '- AI features (`ai.enabled`): Enabled'
			: '- AI features (`ai.enabled`): **Disabled - all AI features below are off regardless of their own settings**',
		...inputs.features.map(f => `- ${f.label} (\`${f.setting}\`): ${f.state}`),
	].join('\n');

	return `# AI Diagnostic Report

Generated: ${inputs.generatedAt}

**Privacy Notice**: This report includes extension versions, non-default configuration settings, provider connection config, system information, and recent log entries. Known secret fields are redacted: API keys, tokens, and custom header values are replaced with \`<redacted>\`, and keys/tokens are stored separately from settings and providers.json to begin with. Everything else is shown as you configured it, including base URLs (which may reveal internal endpoints) and connection settings. Please read through the whole report and remove anything sensitive before you share it.

## Version Information

- Application: ${inputs.application}
- Positron: ${inputs.positronVersion} build ${inputs.positronBuildNumber}
- Code OSS: ${inputs.vscodeVersion}${optionalLine('Commit', inputs.commit)}${optionalLine('Build date', inputs.buildDate)}${optionalLine('Quality', inputs.quality)}
- OS: ${inputs.os}${optionalLine('Remote', inputs.remote)}

### Extensions

${extensionsBlock}

## AI Features

${featuresBlock}

## Providers

### Authenticated

${providerList(inputs.authenticatedProviders)}

### Disabled

${providerList(inputs.disabledProviders)}

### Available Models

Models each provider offers (${totalModels} total).${incompleteNote}

${modelsBlock}

### Configuration

Provider configuration from \`providers.json\`${inputs.providersConfigPath ? ` (\`${inputs.providersConfigPath}\`)` : ''}:

\`\`\`json
${inputs.providersConfig}
\`\`\`

## Configuration Settings

Non-default AI-related settings:

\`\`\`json
${settingsBlock}
\`\`\`
${enforcedBlock}
${logsBlock}
${inputs.bundle ? `\n## Assistant Diagnostics Bundle\n\n${inputs.bundle}\n` : ''}`;
}

/** Setting-key prefixes that identify AI-related settings. */
const AI_SETTING_PREFIXES = [
	'ai.',
	'notebook.ai.',
	'nextEditSuggestions.',
	'assistant.',
	'positron.assistant.',
	'authentication.',
	'console.assistantActions.',
	'git.suggestions.',
	'github.copilot.',
];

/** AI-related settings that don't share one of the AI prefixes. */
const AI_SETTING_EXACT_KEYS: string[] = [ChatConfiguration.AIDisabled];

export { hasExplicitValue, REDACTED_VALUE };

/**
 * Whether a setting's value should be redacted from the report because the key
 * suggests it holds a credential or auth token. The report's list is narrower
 * than the getConfiguredSettings payload's; see settingsInspection.ts for why.
 * @param key The full setting key.
 */
export function isSensitiveSettingKey(key: string): boolean {
	return matchesSensitiveKey(key, REPORT_SENSITIVE_KEYS);
}

/**
 * Redacts secrets from providers.json for the report, keeping the file's own
 * JSON shape. providers.json holds no secrets by design (API keys and tokens
 * live in env vars and the credential store), but `customHeaders` is free-form,
 * so a user can hand-place an auth token there. Header names are kept (so the
 * shape stays visible) and their values redacted; any `apiKey`/`token`/`secret`/
 * `password` key is redacted whole as a belt-and-suspenders guard.
 *
 * The input is parsed tolerantly (comments / trailing commas allowed), then
 * re-serialized as clean JSON. If it can't be parsed, the raw text is returned
 * unchanged - a malformed file is worth seeing, and it holds no secrets bar the
 * customHeaders edge case.
 */
export function redactProvidersConfig(raw: string): string {
	const parsed = parse(raw);
	if (parsed === undefined || typeof parsed !== 'object') {
		return raw;
	}
	return JSON.stringify(redactSensitiveValues(parsed), null, 2);
}

/** Recursively redacts sensitive values in a parsed providers.json object. */
function redactSensitiveValues(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(redactSensitiveValues);
	}
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value)) {
			out[key] = isSensitiveSettingKey(key) ? redactSensitiveValue(key, val) : redactSensitiveValues(val);
		}
		return out;
	}
	return value;
}

/**
 * Redacts one sensitive value. `customHeaders` is a name->value map, so redact
 * each value but keep the names; everything else is replaced wholesale.
 */
function redactSensitiveValue(key: string, value: unknown): unknown {
	if (key.toLowerCase().includes('customheaders') && value && typeof value === 'object' && !Array.isArray(value)) {
		return Object.fromEntries(Object.keys(value).map(name => [name, REDACTED_VALUE]));
	}
	return REDACTED_VALUE;
}

/**
 * AI surfaces that expose their buffered trace/debug logs through a bridge
 * command. Each extension registers the command from its `activate()`; the
 * command's return value crosses the extension-host boundary back to this
 * workbench action. The Posit Assistant command is implemented in the
 * posit-dev/assistant repo; this action tolerates its absence.
 */
const AI_LOG_SOURCES: readonly { label: string; id: string; command: string }[] = [
	{ label: 'Authentication', id: 'positron.authentication', command: 'authentication.getDiagnosticLogs' },
	{ label: 'Posit Assistant', id: 'posit.assistant', command: 'posit.assistant.getDiagnosticLogs' },
	{ label: 'Posit AI NES', id: 'positron.next-edit-suggestions', command: 'next-edit-suggestions.getDiagnosticLogs' },
];

/** The authentication extension and its bridge command reporting provider state. */
const AUTH_EXTENSION_ID = 'positron.authentication';
const AUTH_PROVIDERS_COMMAND = 'authentication.getProviderDiagnostics';

/** The Posit Assistant extension and its bridge command producing the diagnostics bundle. */
const ASSISTANT_EXTENSION_ID = 'posit.assistant';
const ASSISTANT_BUNDLE_COMMAND = 'posit.assistant.collectDiagnosticsBundle';

/** The Next Edit Suggestions extension. */
const NES_EXTENSION_ID = 'positron.next-edit-suggestions';

/** Shape returned by {@link AUTH_PROVIDERS_COMMAND}. */
interface IProviderDiagnostics {
	readonly authenticated: string[];
	readonly disabled: string[];
}

/**
 * GitHub Copilot output channels, collected only when Copilot is enabled. In
 * Positron the single `GitHub.copilot-chat` extension provides both the chat UI
 * and inline completions (it bundles completions-core and logs both to the same
 * channel), so there's no separate `github.copilot` completions extension to
 * report - upstream VS Code ships those as two marketplace extensions, but
 * Positron does not.
 */
const COPILOT_CHANNELS: readonly { label: string; extensionId: string }[] = [
	{ label: 'GitHub Copilot', extensionId: 'GitHub.copilot-chat' },
];

/** Keep reports bounded: only the most recent lines of each log. */
const MAX_LOG_LINES = 500;

/** Bound activation + bridge calls so a stuck extension can't hang the report. */
const BRIDGE_TIMEOUT_MS = 5000;

/**
 * Model listings get a longer bound than the bridge calls. They are the only
 * step that reaches the network, and the built-in listing resolves every chat
 * vendor, which can mean activating an extension and fetching its model list.
 * The bound exists to guarantee the report appears at all, not to keep the wait
 * short, so it is generous: cutting it too fine drops providers that would have
 * answered. On timeout the section says so rather than claiming there are none.
 */
const MODEL_LISTING_TIMEOUT_MS = 10000;

/** Trims log content to the most recent {@link MAX_LOG_LINES} lines. */
export function capLogLines(content: string): string {
	const lines = content.split('\n');
	return lines.length > MAX_LOG_LINES ? lines.slice(-MAX_LOG_LINES).join('\n') : content;
}

/**
 * Renders a feature toggle's on/off state. Defaults (undefined) read as Enabled
 * since Positron's AI feature settings default on; a non-boolean value is shown
 * as-is.
 */
export function describeFeatureToggle(value: unknown): string {
	if (value === false) {
		return 'Disabled';
	}
	if (value === true || value === undefined) {
		return 'Enabled';
	}
	return JSON.stringify(value);
}

/**
 * Renders an extension-backed feature's state. When the owning extension isn't
 * running the setting is unregistered (`getValue` returns undefined), so
 * report the extension's presence rather than letting {@link describeFeatureToggle}
 * default it to "Enabled".
 */
export function featureState(presence: AIDiagnosticsExtensionPresence, value: unknown): string {
	return presence === 'running' ? describeFeatureToggle(value) : PRESENCE_LABELS[presence];
}

/** The activation fields of `IExtensionsStatus` that the report renders. */
interface IActivationStatus {
	readonly activationStarted: boolean;
	readonly activationTimes: unknown;
	readonly runtimeErrors: readonly unknown[];
}

/**
 * Renders an extension's activation state for the report. Activation failures
 * are a prime thing this report should surface, so it distinguishes active,
 * still-activating, and never-activated, and counts runtime errors.
 */
export function describeExtensionStatus(status: IActivationStatus | undefined): string {
	if (!status || !status.activationStarted) {
		return 'not activated';
	}
	const state = status.activationTimes ? 'active' : 'activation started, not finished';
	const errors = status.runtimeErrors.length;
	return errors > 0 ? `${state}, ${errors} runtime error${errors === 1 ? '' : 's'}` : state;
}

/**
 * Creates an AI diagnostic report: itemizes non-default AI settings and gathers
 * trace/debug logs from Authentication, Posit Assistant, Posit AI NES, and (when
 * enabled) GitHub Copilot, then opens the report in an editor. Runs without
 * asking the user to reproduce: the Posit surfaces buffer their recent
 * trace/debug in memory and hand it over via a bridge command.
 */
export class CreateAIDiagnosticReportAction extends Action2 {
	static readonly ID = 'workbench.action.positronAssistant.createAIDiagnosticReport';

	constructor() {
		super({
			id: CreateAIDiagnosticReportAction.ID,
			title: localize2('positron.ai.createDiagnosticReport', "Create Diagnostic Report"),
			category: localize2('positron.ai.category', "AI"),
			f1: true,
			// No precondition: the command must work even when AI features are off,
			// since one reason to run it is to debug why something is disabled.
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const commandService = accessor.get(ICommandService);
		const extensionService = accessor.get(IExtensionService);
		const extensionManagementService = accessor.get(IExtensionManagementService);
		const productService = accessor.get(IProductService);
		const environmentService = accessor.get(IWorkbenchEnvironmentService);
		const outputService = accessor.get(IOutputService);
		const fileService = accessor.get(IFileService);
		const aiProviderService = accessor.get(IAiProviderService);
		const headlessLanguageModelService = accessor.get(IHeadlessLanguageModelService);
		const languageModelsService = accessor.get(ILanguageModelsService);
		const editorService = accessor.get(IEditorService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const progressService = accessor.get(IProgressService);
		const logService = accessor.get(ILogService);

		// Resolved once; the Extensions list, log sections, and feature rows all read it.
		const presenceOf = await resolveExtensionPresence(extensionService, extensionManagementService, [
			...AI_LOG_SOURCES.map(source => source.id),
			...COPILOT_CHANNELS.map(channel => channel.extensionId),
		]);

		// When Posit Assistant is installed, ask up front whether to also produce
		// its diagnostics bundle. The report is always generated; the bundle is
		// opt-in. Escaping the prompt cancels the command.
		const assistantPresence = presenceOf(ASSISTANT_EXTENSION_ID).presence;
		let includeBundle = false;
		if (assistantPresence === 'running') {
			const choice = await promptForBundle(quickInputService);
			if (choice === undefined) {
				return;
			}
			includeBundle = choice;
		}

		// Collection is a handful of bounded steps, each waiting on an extension
		// bridge, a file read, or a provider listing. Usually a second or two, but
		// a stuck extension can push it to the sum of the timeouts, so report which
		// step is running rather than leaving the window silent.
		const report = await progressService.withProgress({
			location: ProgressLocation.Notification,
			title: localize('positron.ai.diagnostics.generating', "Generating AI diagnostic report"),
		}, async progress => {
			const { settings, enforced: enforcedSettings } = collectAISettings(configurationService);

			// Canonical ids can differ in casing from ours (e.g. `GitHub.copilot-chat`).
			const statuses = new Map(Object.entries(extensionService.getExtensionsStatus())
				.map(([key, status]) => [key.toLowerCase(), status]));
			const describe = (label: string, id: string): IAIDiagnosticsExtension =>
				describeExtension(label, id, presenceOf(id), statuses.get(id.toLowerCase()));

			const extensions: IAIDiagnosticsExtension[] = [];
			const logs: IAIDiagnosticsLogSection[] = [];

			// Posit-owned surfaces: bridge command per extension.
			progress.report({ message: localize('positron.ai.diagnostics.collectingLogs', "Collecting extension logs") });
			for (const source of AI_LOG_SOURCES) {
				extensions.push(describe(source.label, source.id));
				const presence = presenceOf(source.id).presence;
				if (presence !== 'running') {
					logs.push({ label: source.label, content: PRESENCE_LABELS[presence] });
					continue;
				}
				logs.push({ label: source.label, content: await collectBridgedLogs(source, extensionService, commandService) });
			}

			// GitHub Copilot: third-party, so no bridge command. Read its log file(s)
			// directly, and only when Copilot is enabled (`chat.disableAIFeatures` off).
			const copilotEnabled = configurationService.getValue(ChatConfiguration.AIDisabled) !== true;
			for (const channel of COPILOT_CHANNELS) {
				extensions.push(describe(channel.label, channel.extensionId));
				logs.push({
					label: channel.label,
					content: await copilotLogSection(channel, presenceOf(channel.extensionId).presence, copilotEnabled, extensionService, outputService, fileService),
				});
			}

			progress.report({ message: localize('positron.ai.diagnostics.collectingProviders', "Reading provider configuration") });
			const providers = await collectProviderDiagnostics(extensionService, commandService);
			const providerConfig = await collectProvidersConfig(aiProviderService, fileService);

			// Independent sources, so run them together: the section's worst case is
			// one timeout, not two. Either coming back undefined leaves the report
			// intact and marks the listing incomplete.
			progress.report({ message: localize('positron.ai.diagnostics.listingModels', "Listing available models") });
			const listingFailure: IListingFailure = {};
			const [listing, builtin] = await Promise.all([
				collectAvailableModels(headlessLanguageModelService, logService, listingFailure),
				collectBuiltinModels(languageModelsService, logService, listingFailure),
			]);

			const bundle = includeBundle
				? localize('positron.ai.diagnostics.bundleRequested', "Requested. Posit Assistant saves the bundle and shows its location in a notification.")
				: undefined;

			// Extension-backed toggles (Posit Assistant, NES, Copilot chat) read as
			// "not installed" when their extension is absent, since the setting is then
			// unregistered and would otherwise default to "Enabled" - contradicting the
			// Extensions list. Notebook AI, console actions, and Git suggestions are
			// core, so always show.
			// NES's `enabled` is a per-language-type map; the `*` wildcard is the overall on/off.
			const nesEnabled = configurationService.getValue<Record<string, boolean>>(NES_ENABLE_SETTING)?.['*'];
			const features: IAIDiagnosticsFeature[] = [
				{ label: 'Posit Assistant', setting: 'assistant.enabled', state: featureState(assistantPresence, configurationService.getValue('assistant.enabled')) },
				{ label: 'Posit AI NES', setting: NES_ENABLE_SETTING, state: featureState(presenceOf(NES_EXTENSION_ID).presence, nesEnabled) },
				{ label: 'Notebook AI', setting: NOTEBOOK_AI_ENABLED_KEY, state: describeFeatureToggle(configurationService.getValue(NOTEBOOK_AI_ENABLED_KEY)) },
				{ label: 'Console Fix & Explain', setting: 'console.assistantActions.enabled', state: describeFeatureToggle(configurationService.getValue('console.assistantActions.enabled')) },
				{ label: 'Git Suggestions', setting: GIT_SUGGESTIONS_ENABLED_KEY, state: describeFeatureToggle(configurationService.getValue(GIT_SUGGESTIONS_ENABLED_KEY)) },
				{ label: 'GitHub Copilot Chat', setting: ChatConfiguration.AIDisabled, state: featureState(presenceOf(COPILOT_CHANNELS[0].extensionId).presence, copilotEnabled) },
			];

			return generateAIDiagnosticsReport({
				generatedAt: new Date().toISOString(),
				aiEnabled: configurationService.getValue<boolean>(AI_ENABLED_KEY) !== false,
				features,
				application: productService.nameLong,
				positronVersion: productService.positronVersion,
				positronBuildNumber: productService.positronBuildNumber,
				vscodeVersion: productService.version,
				commit: productService.commit,
				buildDate: productService.date,
				quality: productService.quality,
				os: PlatformToString(platform),
				remote: environmentService.remoteAuthority,
				extensions,
				authenticatedProviders: providers.authenticated,
				disabledProviders: providers.disabled,
				modelListing: listing ?? { queriedProviders: [], models: [] },
				builtinModels: builtin ?? [],
				modelsIncomplete: listing === undefined || builtin === undefined,
				modelsIncompleteReason: listingFailure.reason,
				providersConfig: providerConfig.content,
				providersConfigPath: providerConfig.path,
				settings,
				enforcedSettings,
				logs,
				bundle,
			});
		});

		// Pinned so the next editor the user opens doesn't replace the report.
		await editorService.openEditor({
			resource: undefined,
			contents: report,
			languageId: 'markdown',
			options: { pinned: true },
		} satisfies IUntitledTextResourceEditorInput);

		// Fire the bundle after the report is open, and don't await it: the
		// Assistant's command shows its own notification (and reveal/download),
		// which would otherwise block the report from appearing until dismissed.
		if (includeBundle) {
			collectAssistantBundle(extensionService, commandService).catch(error => {
				notificationService.warn(localize('positron.ai.diagnostics.bundleFailed', "Could not produce the Posit Assistant diagnostics bundle: {0}", error instanceof Error ? error.message : String(error)));
			});
		}
	}
}

/**
 * The AI settings that aren't at their default, and the subset a Posit Workbench
 * admin enforced. An enforced setting arrives as `policyValue`, so the two come
 * from one walk over the AI keys.
 */
function collectAISettings(configurationService: IConfigurationService): {
	settings: IAIDiagnosticsSetting[];
	enforced: IAIDiagnosticsEnforcedSetting[];
} {
	const properties = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
	const keys = Object.keys(properties)
		.filter(key => AI_SETTING_EXACT_KEYS.includes(key) || AI_SETTING_PREFIXES.some(prefix => key.startsWith(prefix)))
		.sort();

	const settings: IAIDiagnosticsSetting[] = [];
	const enforced: IAIDiagnosticsEnforcedSetting[] = [];
	for (const key of keys) {
		const inspected = configurationService.inspect(key);
		if (hasExplicitValue(inspected)) {
			settings.push({ key, value: isSensitiveSettingKey(key) ? REDACTED_VALUE : inspected.value });
		}
		if (inspected.policyValue !== undefined) {
			enforced.push({
				key,
				value: isSensitiveSettingKey(key)
					? REDACTED_VALUE
					: typeof inspected.policyValue === 'object' ? JSON.stringify(inspected.policyValue) : String(inspected.policyValue),
			});
		}
	}
	return { settings, enforced };
}

/**
 * Looks up whether each extension is running, installed but disabled, or absent.
 * `IExtensionService.getExtension` only sees running extensions, so the installed
 * set is needed too.
 */
async function resolveExtensionPresence(
	extensionService: IExtensionService,
	extensionManagementService: IExtensionManagementService,
	ids: readonly string[],
): Promise<(id: string) => IExtensionPresence> {
	// No type filter: the Posit AI extensions ship built-in (System), so restricting
	// to User would miss all of them. A failure here must not lose the report.
	let installed: readonly ILocalExtension[] = [];
	try {
		installed = await extensionManagementService.getInstalled();
	} catch {
		installed = [];
	}

	const presence = new Map<string, IExtensionPresence>();
	for (const id of ids) {
		const running = await extensionService.getExtension(id);
		if (running) {
			presence.set(id, { presence: 'running', version: running.version });
			continue;
		}
		// Installed but not running: usually disabled, but an extension-kind
		// mismatch or untrusted workspace lands here too.
		const local = installed.find(e => ExtensionIdentifier.equals(e.identifier.id, id));
		presence.set(id, local
			? { presence: 'disabled', version: local.manifest.version }
			: { presence: 'missing', version: undefined });
	}
	return id => presence.get(id) ?? { presence: 'missing', version: undefined };
}

/** One extension's resolved presence and version. */
interface IExtensionPresence {
	readonly presence: AIDiagnosticsExtensionPresence;
	readonly version: string | undefined;
}

/** The report row for one extension. */
function describeExtension(
	label: string,
	id: string,
	{ presence, version }: IExtensionPresence,
	status: IExtensionsStatus | undefined,
): IAIDiagnosticsExtension {
	const messages = [
		...status?.messages.map(message => message.message) ?? [],
		...status?.runtimeErrors.map(error => error instanceof Error ? (error.stack ?? error.message) : String(error)) ?? [],
	];
	return {
		label,
		id,
		presence,
		version,
		status: presence === 'running' ? describeExtensionStatus(status) : undefined,
		messages: messages.length > 0 ? messages : undefined,
	};
}

/**
 * Best-effort activation, bounded by {@link BRIDGE_TIMEOUT_MS} so a stuck
 * extension can't hang the report. Resolves whether or not activation finished.
 */
async function activateWithTimeout(extensionService: IExtensionService, id: string): Promise<void> {
	const identifier = new ExtensionIdentifier(id);
	await raceTimeout(
		extensionService.activateById(identifier, { startup: false, extensionId: identifier, activationEvent: 'api' }),
		BRIDGE_TIMEOUT_MS,
	);
}

/** Collects the error message from a failed listing, left unset on a timeout. */
interface IListingFailure {
	reason?: string;
}

/**
 * Asks the headless language model service what the configured providers
 * actually list. This is a live call, so it can hit the network - that's the
 * point, since it reports reality rather than what providers.json declares. The
 * result is cached by the service, so it's free when a feature already listed
 * this session.
 *
 * Returns `undefined` when the listing didn't come back, which the report shows
 * as "could not be retrieved". Distinct from an empty listing: a slow provider
 * must not be reported as "you have no models".
 */
async function collectAvailableModels(service: IHeadlessLanguageModelService, logService: ILogService, failure: IListingFailure): Promise<IModelListingDiagnostics | undefined> {
	try {
		const listing = await raceTimeout(service.getModelListingDiagnostics(), MODEL_LISTING_TIMEOUT_MS);
		if (!listing) {
			logService.warn(`[ai-diagnostics] Model listing timed out after ${MODEL_LISTING_TIMEOUT_MS}ms; report omits it.`);
		}
		return listing;
	} catch (error) {
		failure.reason = error instanceof Error ? error.message : String(error);
		logService.warn(`[ai-diagnostics] Model listing failed; report omits it: ${error}`);
		return undefined;
	}
}

/**
 * Lists the built-in language model API's models. An empty selector matches
 * everything and resolves each vendor lazily, so this can activate a chat
 * extension that hasn't started yet - acceptable for a report the user asked
 * for, and the same thing the bridge log collection already does.
 *
 * Returns `undefined` when the listing didn't come back, for the same reason as
 * {@link collectAvailableModels}.
 */
async function collectBuiltinModels(service: ILanguageModelsService, logService: ILogService, failure: IListingFailure): Promise<readonly IAIDiagnosticsBuiltinModel[] | undefined> {
	try {
		const identifiers = await raceTimeout(service.selectLanguageModels({}), MODEL_LISTING_TIMEOUT_MS);
		if (!identifiers) {
			logService.warn(`[ai-diagnostics] Built-in model listing timed out after ${MODEL_LISTING_TIMEOUT_MS}ms; report omits it.`);
			return undefined;
		}
		return identifiers.flatMap(identifier => {
			const metadata = service.lookupLanguageModel(identifier);
			return metadata
				? [{ id: metadata.id, name: metadata.name, provider: metadata.vendor }]
				: [];
		});
	} catch (error) {
		failure.reason = error instanceof Error ? error.message : String(error);
		logService.warn(`[ai-diagnostics] Built-in model listing failed; report omits it: ${error}`);
		return undefined;
	}
}

async function collectBridgedLogs(
	source: { label: string; id: string; command: string },
	extensionService: IExtensionService,
	commandService: ICommandService,
): Promise<string> {
	// Activate first so the extension's bridge command is registered before we
	// call it, which avoids CommandService's fallback of star-activating every
	// extension while waiting for the command to appear. The bridge command is
	// registered at the very start of activate(), so it resolves even if the
	// rest of activation is still pending. Bounded so a stuck extension can't
	// hang the whole report.
	//
	// A failed or hung activation still leaves the command registered, and those
	// logs are the ones that explain it, so ask for them anyway. The bridge call
	// gets its own budget: sharing one with the activation means a hang consumes it
	// all and the command never runs.
	try {
		await activateWithTimeout(extensionService, source.id);
	} catch {
		// Fall through to the bridge call.
	}
	try {
		let timedOut = false;
		const content = await raceTimeout(commandService.executeCommand<string>(source.command), BRIDGE_TIMEOUT_MS, () => { timedOut = true; });
		return timedOut
			? `Logs unavailable: timed out after ${BRIDGE_TIMEOUT_MS}ms (extension may be stuck activating)`
			: capLogLines(content ?? 'No log entries available');
	} catch (error) {
		return `Logs unavailable: ${error instanceof Error ? error.message : String(error)}`;
	}
}

/**
 * Asks the authentication extension which providers the user is authenticated
 * with and which are disabled, via its bridge command. Returns empty lists when
 * auth isn't installed or the call fails, so the report shows "None" rather than
 * erroring.
 */
async function collectProviderDiagnostics(
	extensionService: IExtensionService,
	commandService: ICommandService,
): Promise<IProviderDiagnostics> {
	const empty: IProviderDiagnostics = { authenticated: [], disabled: [] };
	if (!await extensionService.getExtension(AUTH_EXTENSION_ID)) {
		return empty;
	}
	// The bridge call gets its own budget, for the same reason as the log
	// collection above: one shared with the activation is spent by a hang.
	try {
		await activateWithTimeout(extensionService, AUTH_EXTENSION_ID);
	} catch {
		// Fall through to the bridge call.
	}
	try {
		return (await raceTimeout(commandService.executeCommand<IProviderDiagnostics>(AUTH_PROVIDERS_COMMAND), BRIDGE_TIMEOUT_MS)) ?? empty;
	} catch {
		return empty;
	}
}

/**
 * Reads providers.json for the report. Resolves its location from the catalog
 * service (which re-homes the path onto the remote authority when connected),
 * then reads the file fresh and redacts secrets. Reading the file directly -
 * rather than the catalog's warmed snapshot - means the first invocation sees
 * the real config even if the snapshot hasn't caught up yet. Returns a `// ...`
 * placeholder (rendered inside the JSON fence) when the file is missing or the
 * catalog is unreachable.
 */
async function collectProvidersConfig(
	aiProviderService: IAiProviderService,
	fileService: IFileService,
): Promise<{ content: string; path: string | undefined }> {
	let uri;
	try {
		uri = await aiProviderService.getConfigFileUri();
	} catch {
		return { content: '// Provider catalog unavailable', path: undefined };
	}
	const path = uri.scheme === Schemas.file ? uri.fsPath : uri.toString(true);
	try {
		const file = await fileService.readFile(uri);
		return { content: redactProvidersConfig(file.value.toString()), path };
	} catch (error) {
		// Most often the file doesn't exist yet: provider config falls back to
		// built-in defaults until the user configures a provider. Permission and
		// remote filesystem errors are real findings, so report those.
		if (toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
			return { content: '// No providers.json found (provider configuration is using defaults)', path };
		}
		return { content: `// Could not read providers.json: ${error instanceof Error ? error.message : String(error)}`, path };
	}
}

/**
 * When Posit Assistant is installed, asks whether to also produce its diagnostics
 * bundle - the extra artifact that carries the chat conversation. Returns the
 * choice, or `undefined` if the user cancels (Escape), which aborts the command.
 */
async function promptForBundle(quickInputService: IQuickInputService): Promise<boolean | undefined> {
	const items: (IQuickPickItem & { includeBundle: boolean })[] = [
		{
			label: localize('positron.ai.diagnostics.reportOnly', "Report only"),
			detail: localize('positron.ai.diagnostics.reportOnly.detail', "Auth providers, feature enablement, settings, and recent logs."),
			includeBundle: false,
		},
		{
			label: localize('positron.ai.diagnostics.reportAndBundle', "Report and diagnostics bundle"),
			detail: localize('positron.ai.diagnostics.reportAndBundle.detail', "A zip with detailed Assistant logs, recent model requests and errors, and the open conversation (if any)."),
			includeBundle: true,
		},
	];
	const picked = await quickInputService.pick(items, {
		placeHolder: localize('positron.ai.diagnostics.bundlePrompt', "Include the diagnostics bundle? Add it if you need to share the chat conversation."),
	});
	return picked && picked.includeBundle;
}

/**
 * Asks Posit Assistant to produce its diagnostics bundle via a bridge command.
 * The Assistant writes the zip and handles its own reveal/download and progress
 * UI, so this just kicks it off - the caller fires it after the report opens and
 * doesn't await it, so the report isn't blocked behind the Assistant's UI.
 */
async function collectAssistantBundle(
	extensionService: IExtensionService,
	commandService: ICommandService,
): Promise<void> {
	await activateWithTimeout(extensionService, ASSISTANT_EXTENSION_ID);
	await commandService.executeCommand(ASSISTANT_BUNDLE_COMMAND, { includeAttachments: false });
}

/**
 * The Copilot log section. {@link collectCopilotLogs} activates the extension
 * first, so an absent, disabled, or unactivatable Copilot is guarded here rather
 * than rejecting out of the whole report.
 */
async function copilotLogSection(
	channel: { label: string; extensionId: string },
	presence: AIDiagnosticsExtensionPresence,
	copilotEnabled: boolean,
	extensionService: IExtensionService,
	outputService: IOutputService,
	fileService: IFileService,
): Promise<string> {
	if (presence === 'missing') {
		return 'Extension not installed';
	}
	if (presence === 'disabled') {
		return 'Extension installed but disabled';
	}
	if (!copilotEnabled) {
		return 'Skipped (GitHub Copilot is disabled)';
	}
	try {
		return await collectCopilotLogs(channel, extensionService, outputService, fileService);
	} catch (error) {
		return `Logs unavailable: ${error instanceof Error ? error.message : String(error)}`;
	}
}

async function collectCopilotLogs(
	channel: { label: string; extensionId: string },
	extensionService: IExtensionService,
	outputService: IOutputService,
	fileService: IFileService,
): Promise<string> {
	// Copilot registers its output channel during activation, so activate it
	// first (we only get here when Copilot is enabled) or the descriptor lookup
	// finds nothing when Copilot hasn't been used yet this session.
	await activateWithTimeout(extensionService, channel.extensionId);

	const descriptor = outputService.getChannelDescriptors().find(d => d.extensionId === channel.extensionId);
	if (!descriptor) {
		return 'Output channel not available';
	}

	const resources = isSingleSourceOutputChannelDescriptor(descriptor)
		? [descriptor.source.resource]
		: isMultiSourceOutputChannelDescriptor(descriptor)
			? descriptor.source.map(s => s.resource)
			: [];
	if (resources.length === 0) {
		return 'No log file available';
	}

	const parts: string[] = [];
	for (const resource of resources) {
		try {
			const file = await fileService.readFile(resource);
			parts.push(file.value.toString());
		} catch (error) {
			parts.push(`Could not read ${resource.toString()}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return capLogLines(parts.join('\n'));
}
