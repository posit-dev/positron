/*
 * JupyterErrorReply.ts
 *
 * Copyright (C) 2022 by RStudio, PBC
 *
 */

import { JupyterMessageSpec } from './JupyterMessageSpec';

/**
 * Returned by many Jupyter methods when they fail.
 * 
 * @link https://jupyter-client.readthedocs.io/en/stable/messaging.html#request-reply 
 */
export interface JupyterErrorReply extends JupyterMessageSpec {
    /** The status, always 'error' */
    status: 'error';

    /** The name of the exception that caused the error, if any */
    ename: string;

    /** A description of the error, if any */
    evalue: string;

    /** A list of traceback frames for the error, if any */
    traceback: Array<string>;
}
