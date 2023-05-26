/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./primaryInterpreter';
import * as React from 'react';
import { InterpreterActions } from 'vs/workbench/browser/parts/positronTopActionBar/modalPopups/interpreterActions';
import { ILanguageRuntime, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

/**
 * PrimaryInterpreterProps interface.
 */
interface PrimaryInterpreterProps {
	languageRuntimeService: ILanguageRuntimeService;
	runtime: ILanguageRuntime;
	primaryRuntime: boolean;
	enableShowAllVersions: boolean;
	showAllVersions: () => void;
	dismiss: () => void;
}

/**
 * PrimaryInterpreter component.
 * @param props A PrimaryInterpreterProps that contains the component properties.
 * @returns The rendered component.
 */
export const PrimaryInterpreter = (props: PrimaryInterpreterProps) => {
	// Render.
	return (
		<div className='primary-interpreter'>
			<img className='icon' src={`data:image/svg+xml;base64,${props.runtime.metadata.base64EncodedIconSvg}`} />
			<div className='info'>
				<div className='container'>
					<div className='line'>{props.runtime.metadata.languageName} {props.runtime.metadata.languageVersion}</div>
					<div className='line light' title={props.runtime.metadata.runtimePath}>{props.runtime.metadata.runtimePath}</div>
				</div>
			</div>
			<InterpreterActions
				languageRuntimeService={props.languageRuntimeService}
				runtime={props.runtime}
				primaryRuntime={true}
				showAllVersions={props.showAllVersions}
			/>
		</div>
	);
};
