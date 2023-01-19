/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplOutput';
import * as React from 'react';
import { useEffect, useMemo, useRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { replLineSplitter } from 'vs/workbench/contrib/positronConsole/browser/classes/utils';
import { ConsoleReplLine } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplLine';
import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// The TrustedTypePolicy for rendering.
const ttPolicyPositronHelp = window.trustedTypes?.createPolicy('positronYack', {
	createHTML: value => value,
	createScript: value => value
});

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
	const ref = useRef<HTMLDivElement>(undefined!);
	const replLines = useMemo(() => {
		return replLineSplitter(languageRuntimeMessageOutput.data['text/plain']);
	}, [languageRuntimeMessageOutput]);

	useEffect(() => {
		ref.current.innerHTML = ttPolicyPositronHelp?.createHTML('<div>YES!!</div>') as unknown as string;
	}, []);

	// Render.
	return (
		<div className='console-repl-output'>
			<div className='timestamp'>{timestamp.toLocaleTimeString()} ID: {languageRuntimeMessageOutput.id} PARENT-ID: {languageRuntimeMessageOutput.parent_id}</div>
			{replLines.map(replLine =>
				<ConsoleReplLine key={replLine.key} text={replLine.text} />
			)}
			<div ref={ref}>Hello Brian</div>
		</div>
	);
};
