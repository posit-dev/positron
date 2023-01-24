/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplStartupBanner';
import * as React from 'react';
import { useMemo } from 'react'; // eslint-disable-line no-duplicate-imports
import { replLineSplitter } from 'vs/workbench/contrib/positronConsole/browser/classes/utils';
import { ConsoleReplLine } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplLine';
import { ILanguageRuntimeInfo } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// ConsoleReplStartupBannerProps interface.
export interface ConsoleReplStartupBannerProps {
	timestamp: Date;
	languageRuntimeInfo: ILanguageRuntimeInfo;
}

/**
 * ConsoleReplStartupBanner component.
 * @param props A ConsoleReplStartupBannerProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleReplStartupBanner = ({ timestamp, languageRuntimeInfo }: ConsoleReplStartupBannerProps) => {
	// Hooks.
	const replLines = useMemo(() => {
		return replLineSplitter(languageRuntimeInfo.banner);
	}, [languageRuntimeInfo]);

	// Render.
	return (
		<div className='console-repl-startup-banner'>
			{/* <div className='timestamp'>{timestamp.toLocaleTimeString()}</div> */}
			{replLines.map(replLine =>
				<ConsoleReplLine key={replLine.key} text={replLine.text} />
			)}
		</div>
	);
};
