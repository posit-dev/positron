//
// exec.rs
//
// Copyright (C) 2022 by RStudio, PBC
//
//

use std::ffi::CStr;
use std::os::raw::c_char;

use extendr_api::*;
use libR_sys::*;

use crate::lsp::logger::dlog;
use crate::macros::cstr;
use crate::r::lock::rlock;
use crate::r::macros::rsymbol;

pub(crate) struct RProtect {
    count: i32,
}

impl RProtect {

    pub fn new() -> Self {
        Self {
            count: 0
        }
    }

    pub fn add(&mut self, object: SEXP) -> SEXP {
        rlock! { Rf_protect(object) };
        self.count += 1;
        object
    }

}

impl Drop for RProtect {

    fn drop(&mut self) {
        rlock! { Rf_unprotect(self.count) };
    }

}

struct RArgument {
    name: String,
    value: SEXP,
}

pub(crate) struct RFunction {
    package: String,
    function: String,
    arguments: Vec<RArgument>,
    protect: RProtect,
}

pub(crate) trait RFunctionExt<T> {
    fn param(&mut self, name: &str, value: T) -> &mut Self;
    fn add(&mut self, value: T) -> &mut Self {
        self.param("", value)
    }
}

impl RFunctionExt<SEXP> for RFunction {

    fn param(&mut self, name: &str, value: SEXP) -> &mut Self {
        self.arguments.push(RArgument {
            name: name.to_string(),
            value: self.protect.add(value),
        });
        self
    }

}

impl RFunctionExt<Robj> for RFunction {

    fn param(&mut self, name: &str, value: Robj) -> &mut Self {
        unsafe { self.param(name, value.get()) }
    }

}

impl RFunctionExt<bool> for RFunction {

    fn param(&mut self, name: &str, value: bool) -> &mut Self {
        let value = rlock! { Rf_ScalarLogical(value as i32) };
        self.param(name, value)
    }

}

impl RFunctionExt<i32> for RFunction {

    fn param(&mut self, name: &str, value: i32) -> &mut Self {
        let value = rlock! { Rf_ScalarInteger(value) };
        self.param(name, value)
    }

}

impl RFunctionExt<f64> for RFunction {

    fn param(&mut self, name: &str, value: f64) -> &mut Self {
        let value = rlock! { Rf_ScalarReal(value) };
        self.param(name, value)
    }

}

impl RFunctionExt<&str> for RFunction {

    fn param(&mut self, name: &str, value: &str) -> &mut Self {

        let value = rlock! {
            let vector = self.protect.add(Rf_allocVector(STRSXP, 1));
            let element = Rf_mkCharLenCE(value.as_ptr() as *mut c_char, value.len() as i32, cetype_t_CE_UTF8);
            SET_STRING_ELT(vector, 0, element);
            vector
        };

        self.param(name, value)
    }

}

impl RFunctionExt<String> for RFunction {

    fn param(&mut self, name: &str, value: String) -> &mut Self {
        self.param(name, value.as_str())
    }
}

impl From<&str> for RFunction {

    fn from(string: &str) -> Self {
        RFunction {
            package: String::new(),
            function: string.to_string(),
            arguments: Vec::new(),
            protect: RProtect::new(),
        }
    }
}

impl From<String> for RFunction {

    fn from(string: String) -> Self {
        RFunction::from(&*string)
    }

}

impl RFunction {

    pub fn new(package: &str, function: &str) -> Self {

        RFunction {
            package: package.to_string(),
            function: function.to_string(),
            arguments: Vec::new(),
            protect: RProtect::new(),
        }

    }

    pub fn call(&mut self, protect: &mut RProtect) -> SEXP {
        rlock! { self.call_impl(protect) }
    }

    fn call_impl(&mut self, protect: &mut RProtect) -> SEXP { unsafe {

        // start building the call to be evaluated
        let mut lhs = rsymbol!(self.function);
        if !self.package.is_empty() {
            lhs = self.protect.add(Rf_lang3(rsymbol!(":::"), rsymbol!(self.package), lhs));
        }

        // now, build the actual call to be evaluated
        let size = (1 + self.arguments.len()) as R_xlen_t;
        let call = self.protect.add(Rf_allocVector(LANGSXP, size));
        SET_TAG(call, R_NilValue);
        SETCAR(call, lhs);

        // append arguments to the call
        let mut slot = CDR(call);
        for argument in self.arguments.iter() {
            SETCAR(slot, argument.value);
            if !argument.name.is_empty() {
                SET_TAG(slot, rsymbol!(argument.name));
            }
            slot = CDR(slot);
        }

        // now, wrap call in tryCatch, so that errors don't longjmp
        let try_catch = self.protect.add(Rf_lang3(rsymbol!("::"), rsymbol!("base"), rsymbol!("tryCatch")));
        let call = self.protect.add(Rf_lang3(try_catch, call, rsymbol!("identity")));
        SET_TAG(call, R_NilValue);
        SET_TAG(CDDR(call), rsymbol!("error"));

        // evaluate the call
        let envir = if self.package.is_empty() { R_GlobalEnv } else { R_BaseEnv };
        let result = protect.add(Rf_eval(call, envir));

        if Rf_inherits(result, cstr!("error")) != 0 {

            let qualified_name = if self.package.is_empty() {
                self.function.clone()
            } else {
                format!("{}::{}", self.package, self.function)
            };

            dlog!("Error executing {}: {}", qualified_name, geterrmessage());
        }

        // TODO:
        // - check for errors?
        // - consider using a result type here?
        // - should we allow the caller to decide how errors are handled?
        return result;

    } }

}

pub unsafe fn geterrmessage() -> String {

    let buffer = R_curErrorBuf();
    let cstr = CStr::from_ptr(buffer);

    match cstr.to_str() {
        Ok(value) => return value.to_string(),
        Err(_) => return "".to_string(),
    }

}

#[cfg(test)]
mod tests {

    use crate::r::test::start_r;

    use super::*;

    #[test]
    fn test_basic_function() { unsafe {

        start_r();

        // try adding some numbers
        let mut protect = RProtect::new();
        let result = RFunction::from("+")
            .add(2)
            .add(2)
            .call(&mut protect);

        // check the result
        assert!(Rf_isInteger(result) != 0);
        assert!(Rf_asInteger(result) == 4);

    } }

    #[test]
    fn test_utf8_strings() { unsafe {

        start_r();

        // try sending some UTF-8 strings to and from R
        let mut protect = RProtect::new();
        let result = RFunction::new("base", "paste")
            .add("世界")
            .add("您好".to_string())
            .call(&mut protect);

        assert!(Rf_isString(result) != 0);

        let value = new_owned(result).as_str();
        assert!(value.is_some());
        assert!(value == Some("世界 您好"));

    }}

    #[test]
    fn test_named_arguments() { unsafe {

        start_r();

        let mut protect = RProtect::new();
        let result = RFunction::new("stats", "rnorm")
            .add(1.0)
            .param("mean", 10)
            .param("sd", 0)
            .call(&mut protect);

        assert!(Rf_isNumeric(result) != 0);
        assert!(Rf_asInteger(result) == 10);

    }}

    #[test]
    fn test_threads() { unsafe {

        const N : i32 = 1000000;
        start_r();

        // Spawn a bunch of threads that try to interact with R.
        let mut handles : Vec<_> = Vec::new();
        for _i in 1..10 {
            let handle = std::thread::spawn(|| {
                for _j in 1..10 {
                    let result = rlock! {
                        let mut protect = RProtect::new();
                        let code = protect.add(Rf_lang2(rsymbol!("rnorm"), Rf_ScalarInteger(N)));
                        Rf_eval(code, R_GlobalEnv)
                    };
                    assert!(Rf_length(result) == N);
                }
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

    }}

}

