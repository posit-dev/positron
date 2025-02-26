/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IStringDictionary } from '../../../../../base/common/collections.js';
import { localize } from '../../../../../nls.js';
import type { IConfigurationPropertySchema } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { TerminalSettingId } from '../../../../../platform/terminal/common/terminal.js';

export const enum TerminalSuggestSettingId {
	Enabled = 'terminal.integrated.suggest.enabled',
	QuickSuggestions = 'terminal.integrated.suggest.quickSuggestions',
	SuggestOnTriggerCharacters = 'terminal.integrated.suggest.suggestOnTriggerCharacters',
	RunOnEnter = 'terminal.integrated.suggest.runOnEnter',
	BuiltinCompletions = 'terminal.integrated.suggest.builtinCompletions',
	WindowsExecutableExtensions = 'terminal.integrated.suggest.windowsExecutableExtensions',
	Providers = 'terminal.integrated.suggest.providers',
	ShowStatusBar = 'terminal.integrated.suggest.showStatusBar',
}

export const windowsDefaultExecutableExtensions: string[] = [
	'exe',   // Executable file
	'bat',   // Batch file
	'cmd',   // Command script
	'com',   // Command file

	'msi',   // Windows Installer package

	'ps1',   // PowerShell script

	'vbs',   // VBScript file
	'js',    // JScript file
	'jar',   // Java Archive (requires Java runtime)
	'py',    // Python script (requires Python interpreter)
	'rb',    // Ruby script (requires Ruby interpreter)
	'pl',    // Perl script (requires Perl interpreter)
	'sh',    // Shell script (via WSL or third-party tools)
];

export const terminalSuggestConfigSection = 'terminal.integrated.suggest';

export interface ITerminalSuggestConfiguration {
	enabled: boolean;
	quickSuggestions: boolean;
	suggestOnTriggerCharacters: boolean;
	runOnEnter: 'never' | 'exactMatch' | 'exactMatchIgnoreExtension' | 'always';
	builtinCompletions: {
		'pwshCode': boolean;
		'pwshGit': boolean;
	};
	providers: {
		'terminal-suggest': boolean;
		'pwsh-shell-integration': boolean;
	};
}

export const terminalSuggestConfiguration: IStringDictionary<IConfigurationPropertySchema> = {
	[TerminalSuggestSettingId.Enabled]: {
		restricted: true,
		markdownDescription: localize('suggest.enabled', "Enables experimental terminal Intellisense suggestions for supported shells ({0}) when {1} is set to {2}.\n\nIf shell integration is installed manually, {3} needs to be set to {4} before calling the shell integration script.", 'PowerShell v7+, zsh, bash, fish', `\`#${TerminalSettingId.ShellIntegrationEnabled}#\``, '`true`', '`VSCODE_SUGGEST`', '`1`'),
		type: 'boolean',
		default: false,
		tags: ['experimental'],
	},
	[TerminalSuggestSettingId.Providers]: {
		restricted: true,
		markdownDescription: localize('suggest.providers', "Providers are enabled by default. Omit them by setting the id of the provider to `false`."),
		type: 'object',
		properties: {},
		default: {
			'terminal-suggest': true,
			'pwsh-shell-integration': false,
		},
		tags: ['experimental'],
	},
	[TerminalSuggestSettingId.QuickSuggestions]: {
		restricted: true,
		markdownDescription: localize('suggest.quickSuggestions', "Controls whether suggestions should automatically show up while typing. Also be aware of the {0}-setting which controls if suggestions are triggered by special characters.", `\`#${TerminalSuggestSettingId.SuggestOnTriggerCharacters}#\``),
		type: 'boolean',
		default: true,
	},
	[TerminalSuggestSettingId.SuggestOnTriggerCharacters]: {
		restricted: true,
		markdownDescription: localize('suggest.suggestOnTriggerCharacters', "Controls whether suggestions should automatically show up when typing trigger characters."),
		type: 'boolean',
		default: true,
	},
	[TerminalSuggestSettingId.RunOnEnter]: {
		restricted: true,
		markdownDescription: localize('suggest.runOnEnter', "Controls whether suggestions should run immediately when `Enter` (not `Tab`) is used to accept the result."),
		enum: ['ignore', 'never', 'exactMatch', 'exactMatchIgnoreExtension', 'always'],
		markdownEnumDescriptions: [
			localize('runOnEnter.ignore', "Ignore suggestions and send the enter directly to the shell without completing. This is used as the default value so the suggest widget is as unobtrusive as possible."),
			localize('runOnEnter.never', "Never run on `Enter`."),
			localize('runOnEnter.exactMatch', "Run on `Enter` when the suggestion is typed in its entirety."),
			localize('runOnEnter.exactMatchIgnoreExtension', "Run on `Enter` when the suggestion is typed in its entirety or when a file is typed without its extension included."),
			localize('runOnEnter.always', "Always run on `Enter`.")
		],
		default: 'ignore',
	},
	[TerminalSuggestSettingId.BuiltinCompletions]: {
		restricted: true,
		markdownDescription: localize('suggest.builtinCompletions', "Controls which built-in completions are activated. This setting can cause conflicts if custom shell completions are configured in the shell profile."),
		type: 'object',
		properties: {
			'pwshCode': {
				description: localize('suggest.builtinCompletions.pwshCode', 'Custom PowerShell argument completers will be registered for VS Code\'s `code` and `code-insiders` CLIs. This is currently very basic and always suggests flags and subcommands without checking context.'),
				type: 'boolean'
			},
			'pwshGit': {
				description: localize('suggest.builtinCompletions.pwshGit', 'Custom PowerShell argument completers will be registered for the `git` CLI.'),
				type: 'boolean'
			},
		},
		default: {
			pwshCode: true,
			pwshGit: true,
		}
	},
	[TerminalSuggestSettingId.WindowsExecutableExtensions]: {
		restricted: true,
		markdownDescription: localize("terminalWindowsExecutableSuggestionSetting", "A set of windows command executable extensions that will be included as suggestions in the terminal.\n\nMany executables are included by default, listed below:\n\n{0}.\n\nTo exclude an extension, set it to `false`\n\n. To include one not in the list, add it and set it to `true`.",
			windowsDefaultExecutableExtensions.sort().map(extension => `- ${extension}`).join('\n'),
		),
		type: 'object',
		default: {},
		tags: ['experimental'],
	},
	[TerminalSuggestSettingId.ShowStatusBar]: {
		restricted: true,
		markdownDescription: localize('suggest.showStatusBar', "Controls whether the terminal suggestions status bar should be shown."),
		type: 'boolean',
		default: true,
		tags: ['experimental'],
	},
};


