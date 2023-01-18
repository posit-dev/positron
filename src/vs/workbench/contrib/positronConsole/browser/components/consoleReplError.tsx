/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplError';
import * as React from 'react';
import { useMemo } from 'react'; // eslint-disable-line no-duplicate-imports
import { replLineSplitter } from 'vs/workbench/contrib/positronConsole/browser/classes/utils';
import { ConsoleReplLine } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplLine';
import { ILanguageRuntimeMessageError } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// ConsoleReplErrorProps interface.
export interface ConsoleReplErrorProps {
	timestamp: Date;
	languageRuntimeMessageError: ILanguageRuntimeMessageError;
}

/**
 * ConsoleReplError component.
 * @param props A ConsoleReplErrorProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleReplError = ({ timestamp, languageRuntimeMessageError }: ConsoleReplErrorProps) => {
	// Hooks.
	const replLines = useMemo(() => {
		return replLineSplitter(languageRuntimeMessageError.message);
	}, [languageRuntimeMessageError]);

	// Render.
	return (
		<div className='console-repl-error'>
			<div className='timestamp'>{timestamp.toLocaleTimeString()} ID: {languageRuntimeMessageError.id} PARENT-ID: {languageRuntimeMessageError.parent_id} {languageRuntimeMessageError.name}</div>
			{/* <div>Traceback: {languageRuntimeMessageError.traceback}</div> */}
			<div style={{ color: 'red' }}>
				{replLines.map(replLine =>
					<ConsoleReplLine key={replLine.key} text={replLine.text} />
				)}
			</div>
		</div>
	);
};
