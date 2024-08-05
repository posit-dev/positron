/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotificationService } from 'vs/platform/notification/common/notification';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { PositronSessionsServices } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronRuntimeSessionsState';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';


export const kPaddingLeft = 8;
export const kPaddingRight = 8;

/**
 * PreviewActionBarsProps interface.
 */
export interface PreviewActionBarsProps extends PositronSessionsServices {
	readonly layoutService: IWorkbenchLayoutService;
	readonly notificationService: INotificationService;
	readonly openerService: IOpenerService;
	readonly positronPreviewService: IPositronPreviewService;
}
