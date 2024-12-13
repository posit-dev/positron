/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IPositronPreviewService } from '../positronPreviewSevice.js';
import { PositronSessionsServices } from '../../../positronRuntimeSessions/browser/positronRuntimeSessionsState.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';


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
