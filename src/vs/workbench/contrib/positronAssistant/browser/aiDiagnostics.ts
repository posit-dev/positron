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
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { PlatformToString, platform } from '../../../../base/common/platform.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { parse } from '../../../../base/common/json.js';
import { Schemas } from '../../../../base/common/network.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IAiProviderService } from '../../../services/positronAiProvider/common/aiProviderService.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IOutputService, isMultiSourceOutputChannelDescriptor, isSingleSourceOutputChannelDescriptor } from '../../../services/output/common/output.js';
import { ChatConfiguration } from '../../chat/common/constants.js';
import { AI_ENABLED_KEY } from '../common/positronAIConfiguration.js';

/**
 * A single AI-related setting whose value differs from its registered default.
 */
export interface IAIDiagnosticsSetting {
	readonly key: string;
	readonly value: unknown;
}

/**
 * A block of collected logs for one AI surface.
 */
export interface IAIDiagnosticsLogSection {
	readonly label: string;
	readonly content: string;
}

/**
 * One AI-related extension's presence/version/activation state.
 */
export interface IAIDiagnosticsExtension {
	readonly label: string;
	readonly id: string;
	/** `undefined` when the extension is not installed. */
	readonly version: string | undefined;
	/** Activation state (e.g. "active", "not activated, 1 runtime error"); only meaningful when installed. */
	readonly status?: string;
}

/**
 * Everything the report needs, gathered by the action and passed to the pure
 * {@link generateAIDiagnosticsReport} formatter so the formatting is testable
 * without services.
 */
/** One AI feature's on/off state, as shown in the report. */
export interface IAIDiagnosticsFeature {
	readonly label: string;
	/** The setting key that controls this feature. */
	readonly setting: string;
	/** "Enabled", "Disabled", or a raw value for non-boolean toggles. */
	readonly state: string;
}

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
	 * Contents of providers.json, redacted and rendered inside a JSON fence. A
	 * `// ...` comment line when the file is missing or the catalog is unavailable
	 * (mirrors the settings block's placeholder).
	 */
	readonly providersConfig: string;
	/** Path to providers.json, shown so support knows where the config lives; omitted when unknown. */
	readonly providersConfigPath: string | undefined;
	readonly settings: readonly IAIDiagnosticsSetting[];
	readonly logs: readonly IAIDiagnosticsLogSection[];
	/** Assistant diagnostics bundle result (path or status); omitted when not requested. */
	readonly bundle?: string;
}

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

	const extensionsBlock = inputs.extensions
		.map(e => e.version
			? `- ${e.label}: Version ${e.version}${e.status ? ` (${e.status})` : ''}`
			: `- ${e.label}: Not installed`)
		.join('\n');

	const logsBlock = inputs.logs
		.map(section => `## ${section.label} Logs\n\n\`\`\`\n${section.content}\n\`\`\``)
		.join('\n\n');

	const providerList = (providers: readonly string[]) =>
		providers.length === 0 ? 'None' : providers.map(p => `- ${p}`).join('\n');

	const optionalLine = (label: string, value: string | undefined) => value ? `\n- ${label}: ${value}` : '';

	const featuresBlock = [
		inputs.aiEnabled
			? '- AI features (`ai.enabled`): Enabled'
			: '- AI features (`ai.enabled`): **Disabled - all AI features below are off regardless of their own settings**',
		...inputs.features.map(f => `- ${f.label} (\`${f.setting}\`): ${f.state}`),
	].join('\n');

	return `# AI Diagnostic Report

Generated: ${inputs.generatedAt}

**Privacy Notice**: This report includes extension versions, non-default configuration settings, provider connection config, system information, and recent log entries. It does NOT include API keys or authentication tokens (those are stored separately, not in settings or providers.json), and custom header values are redacted. However, configured base URLs may reveal internal endpoints. Please review before sharing.

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
	'github.copilot',
];

/** AI-related settings that don't share one of the AI prefixes. */
const AI_SETTING_EXACT_KEYS: string[] = [ChatConfiguration.AIDisabled];

/**
 * Setting-key final segments whose value may hold a secret (custom request
 * headers carrying auth tokens, API keys, etc.). Their values are redacted in
 * the report so it never leaks keys or tokens the user stored in settings.json.
 * Matched case-insensitively against the key's last segment.
 *
 * Note `credentials` is deliberately NOT here: the `authentication.*.credentials`
 * settings hold non-secret config vars (AWS_PROFILE/AWS_REGION, SNOWFLAKE_ACCOUNT,
 * GOOGLE_VERTEX_PROJECT, etc.), not the actual secrets, which resolve from the
 * environment or credential chain. Those values are useful in a report.
 */
const SENSITIVE_KEY_SEGMENTS = ['customheaders', 'apikey', 'token', 'secret', 'password'];

/** Placeholder shown in place of a redacted setting value. */
export const REDACTED_VALUE = '<redacted>';

/**
 * Whether a setting's value should be redacted from the report because the key
 * suggests it holds a credential or auth token.
 */
export function isSensitiveSettingKey(key: string): boolean {
	const segment = key.split('.').pop()?.toLowerCase() ?? '';
	return SENSITIVE_KEY_SEGMENTS.some(sensitive => segment.includes(sensitive));
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

/** Trims log content to the most recent {@link MAX_LOG_LINES} lines. */
export function capLogLines(content: string): string {
	const lines = content.split('\n');
	return lines.length > MAX_LOG_LINES ? lines.slice(-MAX_LOG_LINES).join('\n') : content;
}

/** The scopes at which a configuration value can be explicitly set. */
interface IExplicitScopes {
	readonly userValue?: unknown;
	readonly userLocalValue?: unknown;
	readonly userRemoteValue?: unknown;
	readonly workspaceValue?: unknown;
	readonly workspaceFolderValue?: unknown;
	readonly policyValue?: unknown;
}

/**
 * Whether a setting has an explicit value at any scope (user, workspace, folder,
 * or policy). Policy covers Posit Workbench's enforced settings. A setting left
 * at its registered default reads `undefined` at every scope.
 */
export function hasExplicitValue(inspected: IExplicitScopes): boolean {
	return (inspected.userValue ?? inspected.userLocalValue ?? inspected.userRemoteValue
		?? inspected.workspaceValue ?? inspected.workspaceFolderValue ?? inspected.policyValue) !== undefined;
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
 * installed the setting is unregistered (`getValue` returns undefined), so
 * report "not installed" rather than letting {@link describeFeatureToggle}
 * default it to "Enabled".
 */
export function featureState(installed: boolean, value: unknown): string {
	return installed ? describeFeatureToggle(value) : 'Not installed';
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
		const productService = accessor.get(IProductService);
		const environmentService = accessor.get(IWorkbenchEnvironmentService);
		const outputService = accessor.get(IOutputService);
		const fileService = accessor.get(IFileService);
		const aiProviderService = accessor.get(IAiProviderService);
		const editorService = accessor.get(IEditorService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		// When Posit Assistant is installed, ask up front whether to also produce
		// its diagnostics bundle. The report is always generated; the bundle is
		// opt-in. Escaping the prompt cancels the command.
		const assistantInstalled = !!await extensionService.getExtension(ASSISTANT_EXTENSION_ID);
		let includeBundle = false;
		if (assistantInstalled) {
			const choice = await promptForBundle(quickInputService);
			if (choice === undefined) {
				return;
			}
			includeBundle = choice;
		}

		const settings = collectNonDefaultAISettings(configurationService);

		const statuses = extensionService.getExtensionsStatus();
		const statusFor = (id: string): string =>
			describeExtensionStatus(Object.entries(statuses).find(([key]) => ExtensionIdentifier.equals(key, id))?.[1]);

		const extensions: IAIDiagnosticsExtension[] = [];
		const logs: IAIDiagnosticsLogSection[] = [];

		// Posit-owned surfaces: bridge command per extension.
		for (const source of AI_LOG_SOURCES) {
			const extension = await extensionService.getExtension(source.id);
			extensions.push({ label: source.label, id: source.id, version: extension?.version, status: extension ? statusFor(source.id) : undefined });
			if (!extension) {
				logs.push({ label: source.label, content: 'Extension not installed' });
				continue;
			}
			logs.push({ label: source.label, content: await collectBridgedLogs(source, extensionService, commandService) });
		}

		// GitHub Copilot: third-party, so no bridge command. Read its log file(s)
		// directly, and only when Copilot is enabled (`chat.disableAIFeatures` off).
		const copilotEnabled = configurationService.getValue(ChatConfiguration.AIDisabled) !== true;
		for (const channel of COPILOT_CHANNELS) {
			const extension = await extensionService.getExtension(channel.extensionId);
			extensions.push({ label: channel.label, id: channel.extensionId, version: extension?.version, status: extension ? statusFor(channel.extensionId) : undefined });
			if (!copilotEnabled) {
				logs.push({ label: channel.label, content: 'Skipped (GitHub Copilot is disabled)' });
				continue;
			}
			logs.push({ label: channel.label, content: await collectCopilotLogs(channel, extensionService, outputService, fileService) });
		}

		const providers = await collectProviderDiagnostics(extensionService, commandService);
		const providerConfig = await collectProvidersConfig(aiProviderService, fileService);

		const bundle = includeBundle
			? localize('positron.ai.diagnostics.bundleRequested', "Requested. Posit Assistant saves the bundle and shows its location in a notification.")
			: undefined;

		// Extension-backed toggles (Posit Assistant, NES, Copilot chat) read as
		// "not installed" when their extension is absent, since the setting is then
		// unregistered and would otherwise default to "Enabled" - contradicting the
		// Extensions list. Notebook AI and console actions are core, so always show.
		const nesInstalled = !!await extensionService.getExtension('positron.next-edit-suggestions');
		const copilotChatInstalled = !!await extensionService.getExtension('GitHub.copilot-chat');
		// NES's `enabled` is a per-language-type map; the `*` wildcard is the overall on/off.
		const nesEnabled = configurationService.getValue<Record<string, boolean>>('nextEditSuggestions.enabled')?.['*'];
		const features: IAIDiagnosticsFeature[] = [
			{ label: 'Posit Assistant', setting: 'assistant.enabled', state: featureState(assistantInstalled, configurationService.getValue('assistant.enabled')) },
			{ label: 'Posit AI NES', setting: 'nextEditSuggestions.enabled', state: featureState(nesInstalled, nesEnabled) },
			{ label: 'Notebook AI', setting: 'notebook.ai.enabled', state: describeFeatureToggle(configurationService.getValue('notebook.ai.enabled')) },
			{ label: 'Console Fix & Explain', setting: 'console.assistantActions.enabled', state: describeFeatureToggle(configurationService.getValue('console.assistantActions.enabled')) },
			{ label: 'GitHub Copilot Chat', setting: ChatConfiguration.AIDisabled, state: featureState(copilotChatInstalled, copilotEnabled) },
		];

		const report = generateAIDiagnosticsReport({
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
			providersConfig: providerConfig.content,
			providersConfigPath: providerConfig.path,
			settings,
			logs,
			bundle,
		});

		await editorService.openEditor({ resource: undefined, contents: report, languageId: 'markdown' });

		// Fire the bundle after the report is open, and don't await it: the
		// Assistant's command shows its own notification (and reveal/download),
		// which would otherwise block the report from appearing until dismissed.
		if (includeBundle) {
			collectAssistantBundle(extensionService, commandService, false).catch(error => {
				notificationService.warn(localize('positron.ai.diagnostics.bundleFailed', "Could not produce the Posit Assistant diagnostics bundle: {0}", error instanceof Error ? error.message : String(error)));
			});
		}
	}
}

function collectNonDefaultAISettings(configurationService: IConfigurationService): IAIDiagnosticsSetting[] {
	const properties = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
	const keys = Object.keys(properties)
		.filter(key => AI_SETTING_EXACT_KEYS.includes(key) || AI_SETTING_PREFIXES.some(prefix => key.startsWith(prefix)))
		.sort();

	const settings: IAIDiagnosticsSetting[] = [];
	for (const key of keys) {
		const inspected = configurationService.inspect(key);
		if (hasExplicitValue(inspected)) {
			settings.push({ key, value: isSensitiveSettingKey(key) ? REDACTED_VALUE : inspected.value });
		}
	}
	return settings;
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
	const collect = async (): Promise<string> => {
		await activateWithTimeout(extensionService, source.id);
		const content = await commandService.executeCommand<string>(source.command);
		return capLogLines(content ?? 'No log entries available');
	};
	try {
		const result = await raceTimeout(collect(), BRIDGE_TIMEOUT_MS);
		return result ?? `Logs unavailable: timed out after ${BRIDGE_TIMEOUT_MS}ms (extension may be stuck activating)`;
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
	const collect = async (): Promise<IProviderDiagnostics> => {
		await activateWithTimeout(extensionService, AUTH_EXTENSION_ID);
		return (await commandService.executeCommand<IProviderDiagnostics>(AUTH_PROVIDERS_COMMAND)) ?? empty;
	};
	try {
		return (await raceTimeout(collect(), BRIDGE_TIMEOUT_MS)) ?? empty;
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
	} catch {
		// Most often the file doesn't exist yet: provider config falls back to
		// built-in defaults until the user configures a provider.
		return { content: '// No providers.json found (provider configuration is using defaults)', path };
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
	includeAttachments: boolean,
): Promise<void> {
	await activateWithTimeout(extensionService, ASSISTANT_EXTENSION_ID);
	await commandService.executeCommand(ASSISTANT_BUNDLE_COMMAND, { includeAttachments });
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
