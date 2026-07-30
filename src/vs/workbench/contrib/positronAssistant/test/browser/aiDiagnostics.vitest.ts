/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { capLogLines, describeExtensionStatus, describeFeatureToggle, featureState, generateAIDiagnosticsReport, hasExplicitValue, IAIDiagnosticsInputs, isSensitiveSettingKey, redactProvidersConfig } from '../../browser/aiDiagnostics.js';

function inputs(overrides: Partial<IAIDiagnosticsInputs> = {}): IAIDiagnosticsInputs {
	return {
		generatedAt: '2026-07-23T00:00:00.000Z',
		aiEnabled: true,
		features: [
			{ label: 'Posit Assistant', setting: 'assistant.enabled', state: 'Enabled' },
			{ label: 'Posit AI NES', setting: 'nextEditSuggestions.enabled', state: 'Enabled' },
			{ label: 'Notebook AI', setting: 'notebook.ai.enabled', state: 'Disabled' },
			{ label: 'Console Fix & Explain', setting: 'console.assistantActions.enabled', state: 'Enabled' },
			{ label: 'GitHub Copilot Chat', setting: 'chat.disableAIFeatures', state: 'Enabled' },
		],
		application: 'Positron',
		positronVersion: '2026.07.0',
		positronBuildNumber: 42,
		vscodeVersion: '1.99.0',
		commit: 'abc123',
		buildDate: '2026-07-20T12:00:00.000Z',
		quality: 'stable',
		os: 'Mac',
		remote: undefined,
		extensions: [
			{ label: 'Authentication', id: 'positron.authentication', version: '1.0.0', status: 'active' },
			{ label: 'Posit AI NES', id: 'positron.next-edit-suggestions', version: undefined },
		],
		authenticatedProviders: ['GitHub Copilot', 'Posit AI'],
		disabledProviders: ['DeepSeek', 'Snowflake Cortex'],
		modelListing: {
			queriedProviders: ['positai', 'copilot', 'deepseek'],
			models: [
				{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', vendor: 'Anthropic', providerId: 'positai' },
				// Vendor is what the provider branded it as, so an OpenAI-compatible
				// gateway reports "OpenAI" for a Google model. It must still group
				// under the provider that returned it.
				{ id: 'google/gemma-4-26B', name: 'Gemma 4 26B', vendor: 'OpenAI', providerId: 'positai' },
				// Copilot offers a model Posit AI also offers. It loses the service's
				// dedupe, so it only reaches the report because the listing is
				// reported pre-dedupe.
				{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', vendor: 'Anthropic', providerId: 'copilot' },
				{ id: 'gpt-5', name: 'gpt-5', vendor: 'OpenAI', providerId: 'copilot' },
			],
		},
		builtinModels: [
			// `gpt-5` also came back from the provider sweep below, so it must not
			// be listed twice under copilot.
			{ id: 'gpt-5', name: 'GPT-5', provider: 'copilot' },
			{ id: 'gemini-3-pro', name: 'Gemini 3 Pro', provider: 'copilot' },
		],
		modelsIncomplete: false,
		providersConfig: '{\n  "version": 1,\n  "providers": {\n    "anthropic": {\n      "enabled": true\n    }\n  }\n}',
		providersConfigPath: '/home/user/.posit/ai/providers.json',
		settings: [
			{ key: 'ai.enabled', value: false },
			{ key: 'nextEditSuggestions.enabled', value: { python: true } },
		],
		logs: [
			{ label: 'Authentication', content: '[2026-07-23T00:00:00.000Z] TRACE signed in' },
			{ label: 'Posit AI NES', content: 'Extension not installed' },
		],
		...overrides,
	};
}

describe('generateAIDiagnosticsReport', () => {
	it('renders versions, settings, extensions, and per-surface logs', () => {
		expect(generateAIDiagnosticsReport(inputs())).toMatchInlineSnapshot(`
			"# AI Diagnostic Report

			Generated: 2026-07-23T00:00:00.000Z

			**Privacy Notice**: This report includes extension versions, non-default configuration settings, provider connection config, system information, and recent log entries. Known secret fields are redacted: API keys, tokens, and custom header values are replaced with \`<redacted>\`, and keys/tokens are stored separately from settings and providers.json to begin with. Everything else is shown as you configured it, including base URLs (which may reveal internal endpoints) and connection settings. Please read through the whole report and remove anything sensitive before you share it.

			## Version Information

			- Application: Positron
			- Positron: 2026.07.0 build 42
			- Code OSS: 1.99.0
			- Commit: abc123
			- Build date: 2026-07-20T12:00:00.000Z
			- Quality: stable
			- OS: Mac

			### Extensions

			- Authentication: Version 1.0.0 (active)
			- Posit AI NES: Not installed

			## AI Features

			- AI features (\`ai.enabled\`): Enabled
			- Posit Assistant (\`assistant.enabled\`): Enabled
			- Posit AI NES (\`nextEditSuggestions.enabled\`): Enabled
			- Notebook AI (\`notebook.ai.enabled\`): Disabled
			- Console Fix & Explain (\`console.assistantActions.enabled\`): Enabled
			- GitHub Copilot Chat (\`chat.disableAIFeatures\`): Enabled

			## Providers

			### Authenticated

			- GitHub Copilot
			- Posit AI

			### Disabled

			- DeepSeek
			- Snowflake Cortex

			### Available Models

			Models each provider offers (5 total).

			**positai** (2)

			- \`claude-sonnet-4-5\` (Claude Sonnet 4.5, Anthropic)
			- \`google/gemma-4-26B\` (Gemma 4 26B, OpenAI)

			**copilot** (3)

			- \`claude-sonnet-4-5\` (Claude Sonnet 4.5, Anthropic)
			- \`gpt-5\` (OpenAI)
			- \`gemini-3-pro\` (Gemini 3 Pro)

			**deepseek** (0)

			Queried, but returned no models.

			### Configuration

			Provider configuration from \`providers.json\` (\`/home/user/.posit/ai/providers.json\`):

			\`\`\`json
			{
			  "version": 1,
			  "providers": {
			    "anthropic": {
			      "enabled": true
			    }
			  }
			}
			\`\`\`

			## Configuration Settings

			Non-default AI-related settings:

			\`\`\`json
			  "ai.enabled": false,
			  "nextEditSuggestions.enabled": {
			    "python": true
			  }
			\`\`\`

			## Authentication Logs

			\`\`\`
			[2026-07-23T00:00:00.000Z] TRACE signed in
			\`\`\`

			## Posit AI NES Logs

			\`\`\`
			Extension not installed
			\`\`\`
			"
		`);
	});

	it('notes when no non-default settings are configured', () => {
		const report = generateAIDiagnosticsReport(inputs({ settings: [] }));
		expect(report).toContain('// No non-default settings configured');
	});

	it('includes the remote line only when a remote authority is present', () => {
		expect(generateAIDiagnosticsReport(inputs({ remote: 'ssh-remote+host' }))).toContain('- Remote: ssh-remote+host');
		expect(generateAIDiagnosticsReport(inputs())).not.toContain('- Remote:');
	});

	it('omits optional version lines when their values are absent', () => {
		const report = generateAIDiagnosticsReport(inputs({ commit: undefined, buildDate: undefined, quality: undefined }));
		expect(report).not.toContain('- Commit:');
		expect(report).not.toContain('- Build date:');
		expect(report).not.toContain('- Quality:');
	});

	it('shows "None" for authenticated and disabled providers when both are empty', () => {
		const report = generateAIDiagnosticsReport(inputs({ authenticatedProviders: [], disabledProviders: [] }));
		expect(report).toContain('### Authenticated\n\nNone');
		expect(report).toContain('### Disabled\n\nNone');
	});

	it('explains the empty case rather than showing a bare "None" for available models', () => {
		const report = generateAIDiagnosticsReport(inputs({ modelListing: { queriedProviders: [], models: [] }, builtinModels: [] }));
		expect(report).toContain('None. No provider was queried (each was disabled, had no registered auth backend, or had no credentials) and no extension registered a chat model.');
	});

	it('shows a queried provider that returned nothing instead of omitting it', () => {
		const report = generateAIDiagnosticsReport(inputs({
			modelListing: { queriedProviders: ['positai', 'copilot'], models: [] },
			builtinModels: [],
		}));
		expect(report).toContain('**copilot** (0)\n\nQueried, but returned no models.');
	});

	it('lists a model under every provider that offers it, not just the one that wins de-duplication', () => {
		const report = generateAIDiagnosticsReport(inputs());
		expect(report.split('`claude-sonnet-4-5`')).toHaveLength(3);
	});

	it('lists built-in language model API models under the same provider heading, without duplicating a model both sources report', () => {
		const report = generateAIDiagnosticsReport(inputs());
		// One copilot group holding both sources' models, and `gpt-5` once.
		expect(report).toContain('**copilot** (3)\n\n- `claude-sonnet-4-5` (Claude Sonnet 4.5, Anthropic)\n- `gpt-5` (OpenAI)\n- `gemini-3-pro` (Gemini 3 Pro)');
		expect(report.split('`gpt-5`')).toHaveLength(2);
	});

	it('gives a provider only the built-in API knows about its own heading', () => {
		const report = generateAIDiagnosticsReport(inputs({
			modelListing: { queriedProviders: [], models: [] },
			builtinModels: [{ id: 'gpt-5', name: 'GPT-5', provider: 'copilot' }],
		}));
		expect(report).toContain('**copilot** (1)\n\n- `gpt-5` (GPT-5)');
	});

	it('says the model listing could not be retrieved rather than claiming there are none', () => {
		const report = generateAIDiagnosticsReport(inputs({
			modelListing: { queriedProviders: [], models: [] },
			builtinModels: [],
			modelsIncomplete: true,
		}));
		expect(report).toContain('Could not be retrieved in time. Re-run the report: the listing is cached once it succeeds, so a second run usually has it.');
	});

	it('flags a partial model listing while still showing what came back', () => {
		const report = generateAIDiagnosticsReport(inputs({ modelsIncomplete: true }));
		expect(report).toContain('Some providers did not respond in time, so this list may be incomplete.');
		expect(report).toContain('**positai** (2)');
	});

	it('renders a placeholder in the JSON fence and omits the path when providers.json is unavailable', () => {
		const report = generateAIDiagnosticsReport(inputs({ providersConfig: '// Provider catalog unavailable', providersConfigPath: undefined }));
		expect(report).toContain('Provider configuration from `providers.json`:\n\n```json\n// Provider catalog unavailable\n```');
	});

	it('adds the Assistant bundle section only when a bundle was requested', () => {
		expect(generateAIDiagnosticsReport(inputs())).not.toContain('## Assistant Diagnostics Bundle');
		expect(generateAIDiagnosticsReport(inputs({ bundle: 'Requested (with attachments).' })))
			.toContain('## Assistant Diagnostics Bundle\n\nRequested (with attachments).');
	});

	it('flags when the ai.enabled main switch is off', () => {
		expect(generateAIDiagnosticsReport(inputs({ aiEnabled: false })))
			.toContain('- AI features (`ai.enabled`): **Disabled - all AI features below are off regardless of their own settings**');
		expect(generateAIDiagnosticsReport(inputs())).toContain('- AI features (`ai.enabled`): Enabled');
	});
});

describe('describeFeatureToggle', () => {
	it('maps booleans and defaults to Enabled/Disabled, shows other values raw', () => {
		expect({
			on: describeFeatureToggle(true),
			off: describeFeatureToggle(false),
			def: describeFeatureToggle(undefined),
			object: describeFeatureToggle({ '*': true, markdown: false }),
		}).toEqual({ on: 'Enabled', off: 'Disabled', def: 'Enabled', object: '{"*":true,"markdown":false}' });
	});
});

describe('featureState', () => {
	it('reports "not installed" when the owning extension is absent, else the toggle', () => {
		expect({
			absent: featureState(false, undefined),
			absentIgnoresValue: featureState(false, true),
			installedOn: featureState(true, true),
			installedOff: featureState(true, false),
			installedDefault: featureState(true, undefined),
		}).toEqual({
			absent: 'Not installed',
			absentIgnoresValue: 'Not installed',
			installedOn: 'Enabled',
			installedOff: 'Disabled',
			installedDefault: 'Enabled',
		});
	});
});

describe('isSensitiveSettingKey', () => {
	it('flags credential and auth-token keys for redaction, leaves others alone', () => {
		const sensitive = [
			'authentication.anthropic.customHeaders',
			'authentication.openai-api.apiKey',
			'provider.accessToken',
			'foo.clientSecret',
			'db.password',
		];
		const safe = [
			'ai.enabled',
			'authentication.anthropic.baseUrl',
			// Named "credentials" but holds non-secret config vars (profile, region, account).
			'authentication.aws.credentials',
			'authentication.snowflake.credentials',
			'nextEditSuggestions.enabled',
			'console.assistantActions.enabled',
		];
		expect({
			sensitive: sensitive.filter(isSensitiveSettingKey),
			safe: safe.filter(isSensitiveSettingKey),
		}).toEqual({ sensitive, safe: [] });
	});
});

describe('redactProvidersConfig', () => {
	it('keeps non-secret config verbatim, redacts custom header values (keeping names) and whole secret keys', () => {
		const raw = JSON.stringify({
			version: 1,
			providers: {
				anthropic: { enabled: true, baseUrl: 'https://api.anthropic.com/v1' },
				gateway: {
					enabled: true,
					baseUrl: 'https://gateway.example.com/v1',
					customHeaders: { Authorization: 'Bearer sk-secret', 'x-org': 'acme' },
					apiKey: 'sk-should-not-be-here',
				},
			},
		});
		expect(redactProvidersConfig(raw)).toMatchInlineSnapshot(`
			"{
			  "version": 1,
			  "providers": {
			    "anthropic": {
			      "enabled": true,
			      "baseUrl": "https://api.anthropic.com/v1"
			    },
			    "gateway": {
			      "enabled": true,
			      "baseUrl": "https://gateway.example.com/v1",
			      "customHeaders": {
			        "Authorization": "<redacted>",
			        "x-org": "<redacted>"
			      },
			      "apiKey": "<redacted>"
			    }
			  }
			}"
		`);
	});

	it('parses tolerantly (comments / trailing commas) and returns the raw text when it cannot parse', () => {
		expect(redactProvidersConfig('{\n  // a comment\n  "version": 1,\n}')).toBe('{\n  "version": 1\n}');
		expect(redactProvidersConfig('not json at all')).toBe('not json at all');
	});
});

describe('hasExplicitValue', () => {
	it('is true when a value is set at any scope, false when everything is default', () => {
		expect({
			default: hasExplicitValue({}),
			user: hasExplicitValue({ userValue: false }),
			workspace: hasExplicitValue({ workspaceValue: { a: 1 } }),
			policy: hasExplicitValue({ policyValue: true }),
		}).toEqual({ default: false, user: true, workspace: true, policy: true });
	});

	it('treats an explicit falsy value as set', () => {
		// `false` / `''` / `0` are real values, not "unset" - the ?? chain must keep them.
		expect(hasExplicitValue({ userValue: false })).toBe(true);
		expect(hasExplicitValue({ workspaceValue: '' })).toBe(true);
	});
});

describe('describeExtensionStatus', () => {
	it('summarizes activation state and runtime errors', () => {
		expect({
			missing: describeExtensionStatus(undefined),
			notStarted: describeExtensionStatus({ activationStarted: false, activationTimes: undefined, runtimeErrors: [] }),
			active: describeExtensionStatus({ activationStarted: true, activationTimes: {}, runtimeErrors: [] }),
			activating: describeExtensionStatus({ activationStarted: true, activationTimes: undefined, runtimeErrors: [] }),
			withErrors: describeExtensionStatus({ activationStarted: true, activationTimes: {}, runtimeErrors: [new Error('a'), new Error('b')] }),
			oneError: describeExtensionStatus({ activationStarted: true, activationTimes: undefined, runtimeErrors: [new Error('a')] }),
		}).toEqual({
			missing: 'not activated',
			notStarted: 'not activated',
			active: 'active',
			activating: 'activation started, not finished',
			withErrors: 'active, 2 runtime errors',
			oneError: 'activation started, not finished, 1 runtime error',
		});
	});
});

describe('capLogLines', () => {
	it('keeps content under the cap and trims to the most recent lines over it', () => {
		const under = 'a\nb\nc';
		const over = Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n');
		const capped = capLogLines(over).split('\n');
		expect({
			underUnchanged: capLogLines(under) === under,
			cappedLineCount: capped.length,
			keptMostRecent: capped[capped.length - 1],
		}).toEqual({ underUnchanged: true, cappedLineCount: 500, keptMostRecent: 'line 599' });
	});
});
