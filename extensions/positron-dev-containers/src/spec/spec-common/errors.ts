/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerProperties, CommonDevContainerConfig, ResolverParameters } from './injectHeadless';

export { toErrorText, toWarningText } from '../spec-utils/log';

export interface ContainerErrorAction {
	readonly id: string;
	readonly title: string;
	readonly isCloseAffordance?: boolean;
	readonly isLastAction: boolean;
	applicable: (err: ContainerError, primary: boolean) => boolean | Promise<boolean>;
	execute: (err: ContainerError) => Promise<void>;
}

interface ContainerErrorData {
	reload?: boolean;
	start?: boolean;
	attach?: boolean;
	fileWithError?: string;
	disallowedFeatureId?: string;
	didStopContainer?: boolean;
	learnMoreUrl?: string;
}

interface ContainerErrorInfo {
	description: string;
	originalError?: any;
	manageContainer?: boolean;
	params?: ResolverParameters;
	containerId?: string;
	dockerParams?: any; // TODO
	containerProperties?: ContainerProperties;
	actions?: ContainerErrorAction[];
	data?: ContainerErrorData;
}

export class ContainerError extends Error implements ContainerErrorInfo {
	description!: string;
	originalError?: any;
	manageContainer = false;
	params?: ResolverParameters;
	containerId?: string; // TODO
	dockerParams?: any; // TODO
	volumeName?: string;
	repositoryPath?: string;
	folderPath?: string;
	containerProperties?: ContainerProperties;
	config?: CommonDevContainerConfig;
	actions: ContainerErrorAction[] = [];
	data: ContainerErrorData = {};

	constructor(info: ContainerErrorInfo) {
		super(info.originalError && info.originalError.message || info.description);
		Object.assign(this, info);
		if (this.originalError?.stack) {
			this.stack = this.originalError.stack;
		}
	}
}
