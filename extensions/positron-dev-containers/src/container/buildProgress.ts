/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { BuildProgress } from '../common/types';
import { getLogger } from '../common/logger';

/**
 * Build step types
 */
export enum BuildStep {
	ReadingConfig = 'Reading configuration',
	ResolvingFeatures = 'Resolving features',
	DownloadingFeatures = 'Downloading features',
	BuildingImage = 'Building image',
	CreatingContainer = 'Creating container',
	StartingContainer = 'Starting container',
	InstallingFeatures = 'Installing features',
	RunningPostCreate = 'Running post-create command',
	Complete = 'Complete'
}

/**
 * Progress reporter for container builds
 */
export class BuildProgressReporter {
	private currentStep: BuildStep | string = BuildStep.ReadingConfig;
	private totalSteps: number = 0;
	private currentStepIndex: number = 0;
	private startTime: number = Date.now();

	constructor(
		private progress: vscode.Progress<{ message?: string; increment?: number }>,
		private token: vscode.CancellationToken
	) { }

	/**
	 * Set the total number of steps
	 */
	setTotalSteps(total: number): void {
		this.totalSteps = total;
		getLogger().debug(`Build progress: ${total} total steps`);
	}

	/**
	 * Report progress for a step
	 */
	report(step: BuildStep | string, message?: string): void {
		this.currentStep = step;
		this.currentStepIndex++;

		const percentage = this.totalSteps > 0
			? Math.round((this.currentStepIndex / this.totalSteps) * 100)
			: undefined;

		const fullMessage = message ? `${step}: ${message}` : step;

		this.progress.report({
			message: fullMessage,
			increment: this.totalSteps > 0 ? (100 / this.totalSteps) : undefined
		});

		getLogger().info(`Build progress: ${fullMessage} ${percentage !== undefined ? `(${percentage}%)` : ''}`);
	}

	/**
	 * Report progress for reading configuration
	 */
	reportReadingConfig(configPath: string): void {
		this.report(BuildStep.ReadingConfig, configPath);
	}

	/**
	 * Report progress for resolving features
	 */
	reportResolvingFeatures(featureCount: number): void {
		this.report(BuildStep.ResolvingFeatures, `${featureCount} feature${featureCount !== 1 ? 's' : ''}`);
	}

	/**
	 * Report progress for downloading features
	 */
	reportDownloadingFeature(featureName: string, current: number, total: number): void {
		this.report(BuildStep.DownloadingFeatures, `${featureName} (${current}/${total})`);
	}

	/**
	 * Report progress for building image
	 */
	reportBuildingImage(imageName?: string): void {
		this.report(BuildStep.BuildingImage, imageName);
	}

	/**
	 * Report progress for creating container
	 */
	reportCreatingContainer(containerName?: string): void {
		this.report(BuildStep.CreatingContainer, containerName);
	}

	/**
	 * Report progress for starting container
	 */
	reportStartingContainer(): void {
		this.report(BuildStep.StartingContainer);
	}

	/**
	 * Report progress for installing features
	 */
	reportInstallingFeatures(featureName: string, current: number, total: number): void {
		this.report(BuildStep.InstallingFeatures, `${featureName} (${current}/${total})`);
	}

	/**
	 * Report progress for running post-create command
	 */
	reportRunningPostCreate(command: string): void {
		this.report(BuildStep.RunningPostCreate, command);
	}

	/**
	 * Report completion
	 */
	reportComplete(containerId: string): void {
		const elapsed = Date.now() - this.startTime;
		const elapsedSeconds = Math.round(elapsed / 1000);
		this.report(BuildStep.Complete, `Container ${containerId.substring(0, 12)} ready in ${elapsedSeconds}s`);
	}

	/**
	 * Report error
	 */
	reportError(error: Error | string): void {
		const errorMessage = error instanceof Error ? error.message : error;
		this.progress.report({ message: `Error: ${errorMessage}` });
		getLogger().error(`Build error: ${errorMessage}`);
	}

	/**
	 * Check if the build was cancelled
	 */
	isCancelled(): boolean {
		return this.token.isCancellationRequested;
	}

	/**
	 * Get current step
	 */
	getCurrentStep(): string {
		return this.currentStep;
	}

	/**
	 * Get elapsed time in milliseconds
	 */
	getElapsedTime(): number {
		return Date.now() - this.startTime;
	}
}

/**
 * Helper to run a build with progress reporting
 */
export async function withBuildProgress<T>(
	title: string,
	task: (reporter: BuildProgressReporter, token: vscode.CancellationToken) => Promise<T>
): Promise<T> {
	return await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title,
			cancellable: true
		},
		async (progress, token) => {
			const reporter = new BuildProgressReporter(progress, token);
			try {
				return await task(reporter, token);
			} catch (error) {
				reporter.reportError(error as Error);
				throw error;
			}
		}
	);
}

/**
 * Parse build output for progress information
 */
export class BuildOutputParser {
	/**
	 * Parse Docker build output line
	 */
	static parseBuildLine(line: string): BuildProgress | undefined {
		// Docker BuildKit format: #1 [internal] load build definition from Dockerfile
		const buildKitMatch = line.match(/^#(\d+)\s+\[([^\]]+)\]\s*(.*)/);
		if (buildKitMatch) {
			const [, _stepNum, stepName, message] = buildKitMatch;
			return {
				step: stepName,
				message: message || undefined
			};
		}

		// Classic format: Step 1/5 : FROM node:18
		const classicMatch = line.match(/^Step\s+(\d+)\/(\d+)\s*:\s*(.*)/);
		if (classicMatch) {
			const [, current, total, instruction] = classicMatch;
			return {
				step: `Step ${current}/${total}`,
				percentage: Math.round((parseInt(current) / parseInt(total)) * 100),
				message: instruction
			};
		}

		// Feature installation: Installing feature 'ghcr.io/devcontainers/features/node:1'
		const featureMatch = line.match(/Installing feature ['"]([^'"]+)['"]/);
		if (featureMatch) {
			return {
				step: 'Installing features',
				message: featureMatch[1]
			};
		}

		return undefined;
	}

	/**
	 * Check if a line indicates an error
	 */
	static isErrorLine(line: string): boolean {
		const lowerLine = line.toLowerCase();
		return lowerLine.includes('error:') ||
			lowerLine.includes('failed') ||
			lowerLine.includes('fatal:');
	}

	/**
	 * Extract error message from line
	 */
	static extractError(line: string): string | undefined {
		if (!this.isErrorLine(line)) {
			return undefined;
		}

		// Try to extract just the error message
		const errorMatch = line.match(/error:?\s*(.*)/i);
		if (errorMatch) {
			return errorMatch[1].trim();
		}

		return line.trim();
	}
}
