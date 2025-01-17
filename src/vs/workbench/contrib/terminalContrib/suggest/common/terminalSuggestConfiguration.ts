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
	EnableExtensionCompletions = 'terminal.integrated.suggest.enableExtensionCompletions',
}

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
	enableExtensionCompletions: boolean;
}

export const terminalSuggestConfiguration: IStringDictionary<IConfigurationPropertySchema> = {
	[TerminalSuggestSettingId.Enabled]: {
		restricted: true,
		markdownDescription: localize('suggest.enabled', "Enables experimental terminal Intellisense suggestions for supported shells ({0}) when {1} is set to {2}.\n\nIf shell integration is installed manually, {3} needs to be set to {4} before calling the shell integration script. \n\nFor extension provided completions, {5} will also need to be set.", 'PowerShell v7+, zsh, bash, fish', `\`#${TerminalSettingId.ShellIntegrationEnabled}#\``, '`true`', '`VSCODE_SUGGEST`', '`1`', `\`#${TerminalSuggestSettingId.EnableExtensionCompletions}#\``),
		type: 'boolean',
		default: false,
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
	[TerminalSuggestSettingId.EnableExtensionCompletions]: {
		restricted: true,
		markdownDescription: localize('suggest.enableExtensionCompletions', "Controls whether extension completions are enabled."),
		type: 'boolean',
		default: false,
		tags: ['experimental'],
	},
};
