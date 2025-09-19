# DefaultApi

All URIs are relative to *http://localhost*

|Method | HTTP request | Description|
|------------- | ------------- | -------------|
|[**adoptSession**](#adoptsession) | **PUT** /sessions/{session_id}/adopt | Adopt an existing session|
|[**channelsUpgrade**](#channelsupgrade) | **GET** /sessions/{session_id}/channels | Upgrade to a WebSocket or domain socket for channel communication|
|[**clientHeartbeat**](#clientheartbeat) | **POST** /client_heartbeat | Notify the server that a client is connected|
|[**connectionInfo**](#connectioninfo) | **GET** /sessions/{session_id}/connection_info | Get Jupyter connection information for the session|
|[**deleteSession**](#deletesession) | **DELETE** /sessions/{session_id} | Delete session|
|[**getServerConfiguration**](#getserverconfiguration) | **GET** /server_configuration | Get the server configuration|
|[**getSession**](#getsession) | **GET** /sessions/{session_id} | Get session details|
|[**interruptSession**](#interruptsession) | **POST** /sessions/{session_id}/interrupt | Interrupt session|
|[**killSession**](#killsession) | **POST** /sessions/{session_id}/kill | Force quit session|
|[**listSessions**](#listsessions) | **GET** /sessions | List active sessions|
|[**newSession**](#newsession) | **PUT** /sessions | Create a new session|
|[**restartSession**](#restartsession) | **POST** /sessions/{session_id}/restart | Restart a session|
|[**serverStatus**](#serverstatus) | **GET** /status | Get server status and information|
|[**setServerConfiguration**](#setserverconfiguration) | **POST** /server_configuration | Change the server configuration|
|[**shutdownServer**](#shutdownserver) | **POST** /shutdown | Shut down all sessions and the server itself|
|[**startSession**](#startsession) | **POST** /sessions/{session_id}/start | Start a session|

# **adoptSession**
> any adoptSession(connectionInfo)


### Example

```typescript
import {
    DefaultApi,
    Configuration,
    ConnectionInfo
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

let sessionId: string; // (default to undefined)
let connectionInfo: ConnectionInfo; //

const { status, data } = await apiInstance.adoptSession(
    sessionId,
    connectionInfo
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **connectionInfo** | **ConnectionInfo**|  | |
| **sessionId** | [**string**] |  | defaults to undefined|


### Return type

**any**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Adopted |  -  |
|**500** | Adoption failed |  -  |
|**404** | Session not found |  -  |
|**401** | Unauthorized |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **channelsUpgrade**
> string channelsUpgrade()


### Example

```typescript
import {
    DefaultApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

let sessionId: string; // (default to undefined)

const { status, data } = await apiInstance.channelsUpgrade(
    sessionId
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **sessionId** | [**string**] |  | defaults to undefined|


### Return type

**string**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Upgraded connection |  -  |
|**400** | Invalid request |  -  |
|**401** | Unauthorized |  -  |
|**404** | Session not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **clientHeartbeat**
> any clientHeartbeat(clientHeartbeat)


### Example

```typescript
import {
    DefaultApi,
    Configuration,
    ClientHeartbeat
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

let clientHeartbeat: ClientHeartbeat; //

const { status, data } = await apiInstance.clientHeartbeat(
    clientHeartbeat
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **clientHeartbeat** | **ClientHeartbeat**|  | |


### Return type

**any**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Heartbeat received |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **connectionInfo**
> ConnectionInfo connectionInfo()


### Example

```typescript
import {
    DefaultApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

let sessionId: string; // (default to undefined)

const { status, data } = await apiInstance.connectionInfo(
    sessionId
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **sessionId** | [**string**] |  | defaults to undefined|


### Return type

**ConnectionInfo**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Connection Info |  -  |
|**500** | Failed |  -  |
|**401** | Unauthorized |  -  |
|**404** | Session not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **deleteSession**
> any deleteSession()


### Example

```typescript
import {
    DefaultApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

let sessionId: string; // (default to undefined)

const { status, data } = await apiInstance.deleteSession(
    sessionId
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **sessionId** | [**string**] |  | defaults to undefined|


### Return type

**any**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Session deleted |  -  |
|**400** | Failed to delete session |  -  |
|**401** | Unauthorized |  -  |
|**404** | Session not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getServerConfiguration**
> ServerConfiguration getServerConfiguration()


### Example

```typescript
import {
    DefaultApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

const { status, data } = await apiInstance.getServerConfiguration();
```

### Parameters
This endpoint does not have any parameters.


### Return type

**ServerConfiguration**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | The current server configuration |  -  |
|**400** | Failed to get configuration |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **getSession**
> ActiveSession getSession()


### Example

```typescript
import {
    DefaultApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

let sessionId: string; // (default to undefined)

const { status, data } = await apiInstance.getSession(
    sessionId
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **sessionId** | [**string**] |  | defaults to undefined|


### Return type

**ActiveSession**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Session details |  -  |
|**400** | Failed to get session |  -  |
|**404** | Session not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **interruptSession**
> any interruptSession()


### Example

```typescript
import {
    DefaultApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

let sessionId: string; // (default to undefined)

const { status, data } = await apiInstance.interruptSession(
    sessionId
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **sessionId** | [**string**] |  | defaults to undefined|


### Return type

**any**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Interrupted |  -  |
|**400** | Interrupt failed |  -  |
|**401** | Unauthorized |  -  |
|**404** | Session not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **killSession**
> any killSession()


### Example

```typescript
import {
    DefaultApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

let sessionId: string; // (default to undefined)

const { status, data } = await apiInstance.killSession(
    sessionId
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **sessionId** | [**string**] |  | defaults to undefined|


### Return type

**any**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Killed |  -  |
|**400** | Kill failed |  -  |
|**401** | Unauthorized |  -  |
|**404** | Session not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **listSessions**
> SessionList listSessions()


### Example

```typescript
import {
    DefaultApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

const { status, data } = await apiInstance.listSessions();
```

### Parameters
This endpoint does not have any parameters.


### Return type

**SessionList**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | List of active sessions |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **newSession**
> NewSession200Response newSession(newSession)


### Example

```typescript
import {
    DefaultApi,
    Configuration,
    NewSession
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

let newSession: NewSession; //

const { status, data } = await apiInstance.newSession(
    newSession
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **newSession** | **NewSession**|  | |


### Return type

**NewSession200Response**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | The session ID |  -  |
|**400** | Invalid request |  -  |
|**401** | Unauthorized |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **restartSession**
> any restartSession()


### Example

```typescript
import {
    DefaultApi,
    Configuration,
    RestartSession
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

let sessionId: string; // (default to undefined)
let restartSession: RestartSession; // (optional)

const { status, data } = await apiInstance.restartSession(
    sessionId,
    restartSession
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **restartSession** | **RestartSession**|  | |
| **sessionId** | [**string**] |  | defaults to undefined|


### Return type

**any**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Restarted |  -  |
|**500** | Restart failed |  -  |
|**401** | Unauthorized |  -  |
|**404** | Session not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **serverStatus**
> ServerStatus serverStatus()


### Example

```typescript
import {
    DefaultApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

const { status, data } = await apiInstance.serverStatus();
```

### Parameters
This endpoint does not have any parameters.


### Return type

**ServerStatus**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Server status and information |  -  |
|**400** | Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **setServerConfiguration**
> any setServerConfiguration(serverConfiguration)


### Example

```typescript
import {
    DefaultApi,
    Configuration,
    ServerConfiguration
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

let serverConfiguration: ServerConfiguration; //

const { status, data } = await apiInstance.setServerConfiguration(
    serverConfiguration
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **serverConfiguration** | **ServerConfiguration**|  | |


### Return type

**any**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Configuration updated |  -  |
|**400** | Error |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **shutdownServer**
> any shutdownServer()


### Example

```typescript
import {
    DefaultApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

const { status, data } = await apiInstance.shutdownServer();
```

### Parameters
This endpoint does not have any parameters.


### Return type

**any**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Shutting down |  -  |
|**400** | Shutdown failed |  -  |
|**401** | Unauthorized |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **startSession**
> any startSession()


### Example

```typescript
import {
    DefaultApi,
    Configuration
} from './api';

const configuration = new Configuration();
const apiInstance = new DefaultApi(configuration);

let sessionId: string; // (default to undefined)

const { status, data } = await apiInstance.startSession(
    sessionId
);
```

### Parameters

|Name | Type | Description  | Notes|
|------------- | ------------- | ------------- | -------------|
| **sessionId** | [**string**] |  | defaults to undefined|


### Return type

**any**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
|**200** | Started |  -  |
|**500** | Start failed |  -  |
|**404** | Session not found |  -  |
|**401** | Unauthorized |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

