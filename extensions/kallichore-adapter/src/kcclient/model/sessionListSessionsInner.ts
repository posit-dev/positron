/**
 * Kallichore API
 * Kallichore is a Jupyter kernel gateway and supervisor
 *
 * The version of the OpenAPI document: 1.0.0
 * Contact: info@posit.co
 *
 * NOTE: This class is auto generated by OpenAPI Generator (https://openapi-generator.tech).
 * https://openapi-generator.tech
 * Do not edit the class manually.
 */

import { RequestFile } from './models';
import { ExecutionQueue } from './executionQueue';
import { Status } from './status';

export class SessionListSessionsInner {
    /**
    * A unique identifier for the session
    */
    'sessionId': string;
    /**
    * The program and command-line parameters for the session
    */
    'argv': Array<string>;
    /**
    * The underlying process ID of the session, if the session is running.
    */
    'processId'?: number;
    /**
    * The username of the user who owns the session
    */
    'username': string;
    /**
    * Whether the session is connected to a client
    */
    'connected': boolean;
    /**
    * An ISO 8601 timestamp of when the session was started
    */
    'started': Date;
    /**
    * The session\'s current working directory
    */
    'workingDirectory': string;
    'executionQueue': ExecutionQueue;
    'status': Status;

    static discriminator: string | undefined = undefined;

    static attributeTypeMap: Array<{name: string, baseName: string, type: string}> = [
        {
            "name": "sessionId",
            "baseName": "session_id",
            "type": "string"
        },
        {
            "name": "argv",
            "baseName": "argv",
            "type": "Array<string>"
        },
        {
            "name": "processId",
            "baseName": "process_id",
            "type": "number"
        },
        {
            "name": "username",
            "baseName": "username",
            "type": "string"
        },
        {
            "name": "connected",
            "baseName": "connected",
            "type": "boolean"
        },
        {
            "name": "started",
            "baseName": "started",
            "type": "Date"
        },
        {
            "name": "workingDirectory",
            "baseName": "working_directory",
            "type": "string"
        },
        {
            "name": "executionQueue",
            "baseName": "execution_queue",
            "type": "ExecutionQueue"
        },
        {
            "name": "status",
            "baseName": "status",
            "type": "Status"
        }    ];

    static getAttributeTypeMap() {
        return SessionListSessionsInner.attributeTypeMap;
    }
}

export namespace SessionListSessionsInner {
}
