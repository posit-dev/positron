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
	languageRuntimeMessageOutput: ILanguageRuntimeMessageOutput;
}

/**
 * ConsoleReplOutput component.
 * @param props A ConsoleReplOutputProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleReplOutput = ({ languageRuntimeMessageOutput }: ConsoleReplOutputProps) => {
	// Hooks.
	const replLines = useMemo(() => {
		if (languageRuntimeMessageOutput.data['text/plain'].length === 0) {
			return [];
		} else {
			return replLineSplitter(languageRuntimeMessageOutput.data['text/plain']);
		}
	}, [languageRuntimeMessageOutput]);


	// Render.
	return (
		<div className='console-repl-output'>
			{replLines.map(replLine =>
				<ConsoleReplLine key={replLine.key} text={replLine.text} />
			)}
		</div>
	);
};
