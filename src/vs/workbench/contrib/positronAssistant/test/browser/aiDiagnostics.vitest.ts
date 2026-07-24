/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { capLogLines, describeExtensionStatus, describeFeatureToggle, generateAIDiagnosticsReport, hasExplicitValue, IAIDiagnosticsInputs, isSensitiveSettingKey } from '../../browser/aiDiagnostics.js';

function inputs(overrides: Partial<IAIDiagnosticsInputs> = {}): IAIDiagnosticsInputs {
	return {
		generatedAt: '2026-07-23T00:00:00.000Z',
		aiEnabled: true,
		features: [
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

			**Privacy Notice**: This report includes extension versions, non-default configuration settings, system information, and recent log entries. It does NOT include API keys or authentication tokens (those are stored separately, not in settings). However, configured base URLs may reveal internal endpoints. Please review before sharing.

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
