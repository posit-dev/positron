/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplOutput';
import * as React from 'react';
import { useMemo } from 'react'; // eslint-disable-line no-duplicate-imports
import { lineSplitter } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplStartupBanner';
import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ConsoleReplLine } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplLine';

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
	const bannerLines = useMemo(() => {

		const keys = Object.keys(languageRuntimeMessageOutput.data);
		const values = Object.values(languageRuntimeMessageOutput.data);

		return lineSplitter(values[0]);
	}, [languageRuntimeMessageOutput]);


	// Render.
	return (
		<div className='console-repl-output'>
			<div className='timestamp'>{timestamp.toLocaleTimeString()}</div>
			{bannerLines.map(bannerLine =>
				<ConsoleReplLine key={bannerLine.key} text={bannerLine.text} />
			)}
		</div>
	);
};
