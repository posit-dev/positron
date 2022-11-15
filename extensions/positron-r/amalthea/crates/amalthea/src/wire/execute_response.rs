/*
 * execute_response.rs
 *
 * Copyright (C) 2022 by Posit, PBC
 *
 */

use super::execute_reply::ExecuteReply;
use super::execute_reply_exception::ExecuteReplyException;

/// A response to an execution request, either a reply (the code was executed
/// successfully) or an exception (it totally was not)
pub enum ExecuteResponse {
    Reply(ExecuteReply),
    ReplyException(ExecuteReplyException),
}
