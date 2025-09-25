# ActiveSession


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**session_id** | **string** | A unique identifier for the session | [default to undefined]
**argv** | **Array&lt;string&gt;** | The program and command-line parameters for the session | [default to undefined]
**process_id** | **number** | The underlying process ID of the session, if the session is running. | [optional] [default to undefined]
**username** | **string** | The username of the user who owns the session | [default to undefined]
**display_name** | **string** | A human-readable name for the session | [default to undefined]
**language** | **string** | The interpreter language | [default to undefined]
**interrupt_mode** | [**InterruptMode**](InterruptMode.md) |  | [default to undefined]
**initial_env** | **{ [key: string]: string; }** | The environment variables set when the session was started | [optional] [default to undefined]
**connected** | **boolean** | Whether the session is connected to a client | [default to undefined]
**started** | **string** | An ISO 8601 timestamp of when the session was started | [default to undefined]
**working_directory** | **string** | The session\&#39;s current working directory | [default to undefined]
**input_prompt** | **string** | The text to use to prompt for input | [default to undefined]
**continuation_prompt** | **string** | The text to use to prompt for input continuations | [default to undefined]
**execution_queue** | [**ExecutionQueue**](ExecutionQueue.md) |  | [default to undefined]
**status** | [**Status**](Status.md) |  | [default to undefined]
**idle_seconds** | **number** | The number of seconds the session has been idle, or 0 if the session is busy | [default to undefined]
**busy_seconds** | **number** | The number of seconds the session has been busy, or 0 if the session is idle | [default to undefined]
**socket_path** | **string** | The path to the Unix domain socket used to send/receive data from the session, if applicable | [optional] [default to undefined]

## Example

```typescript
import { ActiveSession } from './api';

const instance: ActiveSession = {
    session_id,
    argv,
    process_id,
    username,
    display_name,
    language,
    interrupt_mode,
    initial_env,
    connected,
    started,
    working_directory,
    input_prompt,
    continuation_prompt,
    execution_queue,
    status,
    idle_seconds,
    busy_seconds,
    socket_path,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
