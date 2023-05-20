/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./languageSelector';
import * as React from 'react';
//import { localize } from 'vs/nls';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * LanguageSelectorProps interface.
 */
interface LanguageSelectorProps {
	runtime: ILanguageRuntime;
}

/**
 * LanguageSelector component.
 * @param props A LanguageSelectorProps that contains the component properties.
 * @returns The rendered component.
 */
export const LanguageSelector = (props: LanguageSelectorProps) => {
	// Render.
	return (
		<div>
			<img></img>
			<div>{props.runtime.metadata.languageName} {props.runtime.metadata.languageVersion}</div>
			<div>{props.runtime.metadata.runtimeName}</div>
		</div>
	);
};
