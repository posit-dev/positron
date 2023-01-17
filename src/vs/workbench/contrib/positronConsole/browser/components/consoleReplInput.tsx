/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplInput';
import * as React from 'react';
import { useMemo } from 'react'; // eslint-disable-line no-duplicate-imports
import { ConsoleReplLine } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplLine';
import { lineSplitter } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplStartupBanner';
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
	const bannerLines = useMemo(() => {

		//const keys = Object.keys(languageRuntimeMessageInput.data);
		// const values = Object.values(languageRuntimeMessageInput.data);

		return lineSplitter('');
	}, [languageRuntimeMessageInput]);


	// Render.
	return (
		<div className='console-repl-input'>
			<div className='timestamp'>{timestamp.toLocaleTimeString()}</div>
			{bannerLines.map(bannerLine =>
				<ConsoleReplLine key={bannerLine.key} text={bannerLine.text} />
			)}
		</div>
	);
};
