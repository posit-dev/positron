/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Log levels for the extension
 */
export enum LogLevel {
	Trace = 'trace',
	Debug = 'debug',
	Info = 'info',
	Warning = 'warning',
	Error = 'error'
}

/**
 * Dev container configuration from settings
 */
export interface DevContainerConfiguration {
	enable: boolean;
	defaultExtensions: string[];
	defaultFeatures: Record<string, any>;
	workspaceMountConsistency: 'consistent' | 'cached' | 'delegated';
	gpuAvailability: 'all' | 'detect' | 'none';
	logLevel: LogLevel;
	dockerPath: string;
	dockerComposePath: string;
	dockerSocketPath: string;
}

/**
 * Container state
 */
export enum ContainerState {
	Running = 'running',
	Stopped = 'stopped',
	Paused = 'paused',
	Exited = 'exited',
	Unknown = 'unknown'
}

/**
 * Dev container info
 */
export interface DevContainerInfo {
	containerId: string;
	containerName: string;
	state: ContainerState;
	workspaceFolder?: string;
	configFilePath?: string;
	createdAt?: Date;
	imageId?: string;
	imageName?: string;
}

/**
 * Authority type for remote connections
 */
export enum AuthorityType {
	DevContainer = 'dev-container',
	AttachedContainer = 'attached-container'
}

/**
 * Remote authority parsed from connection string
 */
export interface RemoteAuthority {
	type: AuthorityType;
	containerId: string;
}

/**
 * Extension context data stored globally
 */
export interface ExtensionState {
	recentContainers: DevContainerInfo[];
	lastLogFilePath?: string;
}

/**
 * Command context
 */
export interface CommandContext {
	uri?: vscode.Uri;
	containerId?: string;
}

/**
 * Build progress event
 */
export interface BuildProgress {
	step: string;
	percentage?: number;
	message?: string;
}

/**
 * Connection info for resolved authority
 */
export interface ConnectionInfo {
	host: string;
	port: number;
	connectionToken?: string;
}

/**
 * Workspace folder locations
 */
export interface WorkspaceFolderPaths {
	workspaceFolder: string;
	devContainerFolder: string;
	devContainerJsonPath: string;
}
