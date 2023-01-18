/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplInput';
import * as React from 'react';
import { useMemo } from 'react'; // eslint-disable-line no-duplicate-imports
import { replLineSplitter } from 'vs/workbench/contrib/positronConsole/browser/classes/utils';
import { ConsoleReplLine } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplLine';
import { ILanguageRuntimeMessageInput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// ConsoleReplInputProps interface.
export interface ConsoleReplInputProps {
	timestamp: Date;
	languageRuntimeMessageInput: ILanguageRuntimeMessageInput;
}

/**
 * ConsoleReplInput component.
 * @param props A ConsoleReplInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleReplInput = ({ timestamp, languageRuntimeMessageInput }: ConsoleReplInputProps) => {
	// Hooks.
	const replLines = useMemo(() => {
		return replLineSplitter(languageRuntimeMessageInput.code, '>');
	}, [languageRuntimeMessageInput]);

	// Render.
	return (
		<div className='console-repl-input'>
			<div className='timestamp'>{timestamp.toLocaleTimeString()}</div>
			{replLines.map(replLine =>
				<ConsoleReplLine key={replLine.key} text={replLine.text} />
			)}
		</div>
	);
};
