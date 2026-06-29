/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IEditorOptions, LineNumbersType } from '../../../../../editor/common/config/editorOptions.js';
import { IFontOptions } from '../../../../browser/fontConfigurationManager.js';
import { IPositronConsoleInstance, PositronConsoleState } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

/**
 * The subset of IEditorOptions that controls the console input's line numbers,
 * which render the input/continuation prompt (e.g. the `>` glyph).
 */
export type ILineNumbersOptions = Pick<IEditorOptions, 'lineNumbers' | 'lineNumbersMinChars'>;

/**
 * Creates the configuration-driven IEditorOptions for the console input's code
 * editor widget.
 *
 * @param configurationService The configuration service to read editor/console settings from.
 * @returns The configuration-driven IEditorOptions for the console input's code editor widget.
 */
export function createConsoleInputEditorOptions(configurationService: IConfigurationService): IEditorOptions {
	// Drop the configured `editor.lineNumbers` / `editor.lineNumbersMinChars`
	// from the base options. The console input renders its prompt through the
	// line numbers (see createConsoleInputLineNumbersOptions); letting the
	// user's editor line-number settings flow through here would clobber the
	// prompt with numeric line numbers on the next configuration-driven
	// updateOptions().
	const { lineNumbers: _lineNumbers, lineNumbersMinChars: _lineNumbersMinChars, ...editorOptions } =
		configurationService.getValue<IEditorOptions>('editor');
	return {
		// Configured IEditorOptions (sans line number options) is the base.
		...editorOptions,
		// Console-specific font options overlay the configured editor options.
		...configurationService.getValue<IFontOptions>('console'),
		// IEditorOptions we override from their configured values.
		...{
			readOnly: false,
			minimap: {
				enabled: false
			},
			glyphMargin: false,
			folding: false,
			fixedOverflowWidgets: true,
			lineDecorationsWidth: '1.0ch',
			renderLineHighlight: 'none',
			renderFinalNewline: 'on',
			wordWrap: 'bounded',
			wordWrapColumn: 2048,
			scrollbar: {
				vertical: 'hidden',
				useShadows: false
			},
			overviewRulerLanes: 0,
			// This appears to disable the ruler.
			// https://github.com/posit-dev/positron/issues/1080
			rulers: [],
			scrollBeyondLastLine: false,
			// This appears to disable validations to address:
			// https://github.com/posit-dev/positron/issues/979
			// https://github.com/posit-dev/positron/issues/1051
			renderValidationDecorations: 'off'
		}
	};
}

/**
 * Creates the line number options for the console input's code editor widget.
 *
 * The line numbers render the input/continuation prompt. The prompt is only
 * shown when there is an attached session AND the console is in a prompt-bearing
 * state (Uninitialized, Starting, or Ready); in any other state (e.g. Busy,
 * Offline, Exiting, Exited, Disconnected) the prompt is hidden.
 *
 * @param instance The console instance whose state/session drives the prompt.
 * @returns The line number options for the console input's code editor widget.
 */
export function createConsoleInputLineNumbersOptions(instance: IPositronConsoleInstance): ILineNumbersOptions {
	const session = instance.attachedRuntimeSession;
	if (!session) {
		return { lineNumbers: () => '', lineNumbersMinChars: 0 };
	}
	return {
		lineNumbers: ((): LineNumbersType => {
			switch (instance.state) {
				// When uninitialized, starting, or ready, use the show prompt line numbers
				// function.
				case PositronConsoleState.Uninitialized:
				case PositronConsoleState.Starting:
				case PositronConsoleState.Ready:
					return (lineNumber: number) => lineNumber < 2 ?
						session.dynState.inputPrompt :
						session.dynState.continuationPrompt;

				// In any other state, use the hide prompt line numbers function.
				default:
					return (_lineNumber: number) => '';
			}
		})(),
		lineNumbersMinChars: Math.max(
			session.dynState.inputPrompt.length,
			session.dynState.continuationPrompt.length
		)
	};
}
