# reporter works

    {"type":"start_reporter"}
    {"type":"start_file","filename":"reporters/tests.R"}
    {"type":"start_test","test":"Success"}
    {"type":"add_result","context":{},"test":"Success","result":"success","location":"tests.R:2:3","filename":"reporters/tests.R"}
    {"type":"end_test","test":"Success"}
    {"type":"start_test","test":"Failure:1"}
    {"type":"add_result","context":{},"test":"Failure:1","result":"failure","location":"tests.R:6:3","filename":"reporters/tests.R","message":"FALSE is not TRUE\n\n`actual`:   FALSE\n`expected`: TRUE "}
    {"type":"end_test","test":"Failure:1"}
    {"type":"start_test","test":"Failure:2a"}
    {"type":"add_result","context":{},"test":"Failure:2a","result":"failure","location":"tests.R:11:3","filename":"reporters/tests.R","message":"FALSE is not TRUE\n\n`actual`:   FALSE\n`expected`: TRUE "}
    {"type":"end_test","test":"Failure:2a"}
    {"type":"start_test","test":"Error:1"}
    {"type":"add_result","context":{},"test":"Error:1","result":"error","location":"tests.R:15:3","filename":"reporters/tests.R","message":"stop"}
    {"type":"end_test","test":"Error:1"}
    {"type":"start_test","test":"errors get tracebacks"}
    {"type":"add_result","context":{},"test":"errors get tracebacks","result":"error","location":"tests.R:23:3","filename":"reporters/tests.R","message":"!"}
    {"type":"end_test","test":"errors get tracebacks"}
    {"type":"start_test","test":"explicit skips are reported"}
    {"type":"add_result","context":{},"test":"explicit skips are reported","result":"skip","location":"tests.R:27:3","filename":"reporters/tests.R","message":"Reason: skip"}
    {"type":"end_test","test":"explicit skips are reported"}
    {"type":"start_test","test":"empty tests are implicitly skipped"}
    {"type":"add_result","context":{},"test":"empty tests are implicitly skipped","result":"skip","location":"tests.R:30:1","filename":"reporters/tests.R","message":"Reason: empty test"}
    {"type":"end_test","test":"empty tests are implicitly skipped"}
    {"type":"start_test","test":"warnings get backtraces"}
    {"type":"add_result","context":{},"test":"warnings get backtraces","result":"warning","location":"tests.R:37:3","filename":"reporters/tests.R"}
    {"type":"end_test","test":"warnings get backtraces"}
    {"type":"end_file","filename":"reporters/tests.R"}
    {"type":"end_reporter"}

