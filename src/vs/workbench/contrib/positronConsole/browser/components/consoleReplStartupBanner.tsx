/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleReplStartupBanner';
import * as React from 'react';
import { useMemo } from 'react'; // eslint-disable-line no-duplicate-imports
import { ILanguageRuntimeInfo } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { generateUuid } from 'vs/base/common/uuid';
import { ConsoleReplLine } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplLine';

// ConsoleReplStartupBannerProps interface.
export interface ConsoleReplStartupBannerProps {
	timestamp: Date;
	languageRuntimeInfo: ILanguageRuntimeInfo;
}

interface BannerLine {
	key: string;
	text: string;
}

export const lineSplitter = (text: string): BannerLine[] => {
	const textLines = text.split('\n');
	const bannerLines = new Array<BannerLine>();
	textLines.forEach((text, index) => {
		bannerLines.push({ key: generateUuid(), text });
	});
	return bannerLines;
};

/**
 * ConsoleReplStartupBanner component.
 * @param props A ConsoleReplStartupBannerProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleReplStartupBanner = ({ timestamp, languageRuntimeInfo }: ConsoleReplStartupBannerProps) => {
	const bannerLines = useMemo(() => {
		return lineSplitter(languageRuntimeInfo.banner);
	}, [languageRuntimeInfo]);

	// Render.
	return (
		<div className='console-repl-startup-banner'>
			<div className='timestamp'>{timestamp.toLocaleTimeString()}</div>
			{bannerLines.map(bannerLine =>
				<ConsoleReplLine key={bannerLine.key} text={bannerLine.text} />
			)}
		</div>
	);
};
