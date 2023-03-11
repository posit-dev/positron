//
// string.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use libR_sys::*;

use crate::object::RObject;
use crate::protect::RProtect;
use crate::r_string;
use crate::utils::r_typeof;

// Given a quoted R string, decode it to get the string value.
pub unsafe fn r_string_decode(code: &str) -> Option<String> {

    // convert to R string
    let mut protect = RProtect::new();
    let code = protect.add(r_string!(code));

    // parse into vector
    let mut ps: ParseStatus = 0;
    let result = protect.add(R_ParseVector(code, -1, &mut ps, R_NilValue));

    // check for string in result
    if r_typeof(result) == EXPRSXP {
        if Rf_length(result) != 0 {
            let value = VECTOR_ELT(result, 0);
            if r_typeof(value) == STRSXP {
                return RObject::view(value).to::<String>().ok();
            }
        }
    }

    None


}
