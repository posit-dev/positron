/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** The most characters a checkpoint title can have. */
export const CHECKPOINT_TITLE_LIMIT = 72;

/** The size in megabytes above which a changed file is left out of a checkpoint unless included. */
export const LARGE_FILE_LIMIT_MEGABYTES = 50;

/** `LARGE_FILE_LIMIT_MEGABYTES` in bytes. */
export const LARGE_FILE_LIMIT_BYTES = LARGE_FILE_LIMIT_MEGABYTES * 1024 * 1024;

/** The number of operations the undo list covers (spec 6.2). */
export const UNDO_LIMIT_OPERATIONS = 50;

/** The number of days an operation stays on the undo list (spec 6.2). */
export const UNDO_LIMIT_DAYS = 30;

/** The size in megabytes above which an image is not shown in the image comparison. */
export const IMAGE_DIFF_LIMIT_MEGABYTES = 20;

/** `IMAGE_DIFF_LIMIT_MEGABYTES` in bytes. */
export const IMAGE_DIFF_LIMIT_BYTES = IMAGE_DIFF_LIMIT_MEGABYTES * 1024 * 1024;

/** The size in megabytes above which a stored version that was read is not compared line by line. */
export const STORED_SIDE_READ_LIMIT_MEGABYTES = 20;

/** `STORED_SIDE_READ_LIMIT_MEGABYTES` in bytes. */
export const STORED_SIDE_READ_LIMIT_BYTES = STORED_SIDE_READ_LIMIT_MEGABYTES * 1024 * 1024;
