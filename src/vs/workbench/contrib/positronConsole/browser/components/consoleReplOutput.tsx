/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplOutput';
import * as React from 'react';
import { useMemo } from 'react'; // eslint-disable-line no-duplicate-imports
import { replLineSplitter } from 'vs/workbench/contrib/positronConsole/browser/classes/utils';
import { ConsoleReplLine } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplLine';
import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// ConsoleReplOutputProps interface.
export interface ConsoleReplOutputProps {
	timestamp: Date;
	languageRuntimeMessageOutput: ILanguageRuntimeMessageOutput;
}

/**
 * ConsoleReplOutput component.
 * @param props A ConsoleReplOutputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleReplOutput = ({ timestamp, languageRuntimeMessageOutput }: ConsoleReplOutputProps) => {
	// Hooks.
	const replLines = useMemo(() => {
		const keys = Object.keys(languageRuntimeMessageOutput.data);
		const values = Object.values(languageRuntimeMessageOutput.data);

		const d = keys.find(x => x === 'text/plain');
		const x = values.indexOf(d);

		return replLineSplitter(values[x]);
	}, [languageRuntimeMessageOutput]);

	// Render.
	return (
		<div className='console-repl-output'>
			<div className='timestamp'>{timestamp.toLocaleTimeString()} ID: {languageRuntimeMessageOutput.id} PARENT-ID: {languageRuntimeMessageOutput.parent_id}</div>
			{replLines.map(replLine =>
				<ConsoleReplLine key={replLine.key} text={replLine.text} />
			)}
		</div>
	);
};
