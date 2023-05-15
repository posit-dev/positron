//
// exec.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::ffi::CStr;
use std::mem;
use std::os::raw::c_int;
use std::os::raw::c_void;
use std::os::raw::c_char;

use libR_sys::*;

use crate::error::Error;
use crate::error::Result;
use crate::object::RObject;
use crate::protect::RProtect;
use crate::r_string;
use crate::r_symbol;
use crate::utils::r_inherits;
use crate::utils::r_stringify;
use crate::utils::r_typeof;
use crate::vector::CharacterVector;
use crate::vector::Vector;

extern "C" {
    pub static R_ParseError: c_int;
}

extern "C" {
    pub static R_ParseErrorMsg: [c_char; 256usize];
}

pub struct RArgument {
    pub name: String,
    pub value: RObject,
}

impl RArgument {

    pub fn new(name: &str, value: RObject) -> Self {
        Self {
            name: name.to_string(),
            value: value
        }
    }

}

pub struct RFunction {
    package: String,
    function: String,
    arguments: Vec<RArgument>,
}

pub trait RFunctionExt<T> {
    fn param(&mut self, name: &str, value: T) -> &mut Self;
    fn add(&mut self, value: T) -> &mut Self;
}

impl<T: Into<RObject>> RFunctionExt<Option<T>> for RFunction {

    fn param(&mut self, name: &str, value: Option<T>) -> &mut Self {
        if let Some(value) = value {
            self._add(name, value.into());
        }
        self
    }

    fn add(&mut self, value: Option<T>) -> &mut Self {
        if let Some(value) = value {
            self._add("", value.into());
        }
        self
    }

}

impl<T: Into<RObject>> RFunctionExt<T> for RFunction {

    fn param(&mut self, name: &str, value: T) -> &mut Self {
        let value : RObject = value.into();
        return self._add(name, value);
    }

    fn add(&mut self, value: T) -> &mut Self {
        let value : RObject = value.into();
        return self._add("", value);
    }

}

impl RFunction {

    pub fn new(package: &str, function: &str) -> Self {

        RFunction {
            package: package.to_string(),
            function: function.to_string(),
            arguments: Vec::new(),
        }

    }

    fn _add(&mut self, name: &str, value: RObject) -> &mut Self {
        self.arguments.push(RArgument {
            name: name.to_string(),
            value: value,
        });
        self
    }

    pub unsafe fn call(&mut self) -> Result<RObject> {

        let mut protect = RProtect::new();

        // start building the call to be evaluated
        let mut lhs = r_symbol!(self.function);
        if !self.package.is_empty() {
            lhs = protect.add(Rf_lang3(r_symbol!(":::"), r_symbol!(self.package), lhs));
        }

        // now, build the actual call to be evaluated
        let size = (1 + self.arguments.len()) as R_xlen_t;
        let call = protect.add(Rf_allocVector(LANGSXP, size));
        SET_TAG(call, R_NilValue);
        SETCAR(call, lhs);

        // append arguments to the call
        let mut slot = CDR(call);
        for argument in self.arguments.iter() {

            // quote language objects by default
            let mut sexp = argument.value.sexp;
            if matches!(r_typeof(sexp), LANGSXP | SYMSXP | EXPRSXP) {
                let quote = protect.add(Rf_lang3(r_symbol!("::"), r_symbol!("base"), r_symbol!("quote")));
                sexp = protect.add(Rf_lang2(quote, sexp));
            }

            SETCAR(slot, sexp);
            if !argument.name.is_empty() {
                SET_TAG(slot, r_symbol!(argument.name));
            }

            slot = CDR(slot);
        }

        // now, wrap call in tryCatch, so that errors don't longjmp
        let try_catch = protect.add(Rf_lang3(r_symbol!("::"), r_symbol!("base"), r_symbol!("tryCatch")));
        let call = protect.add(Rf_lang4(try_catch, call, r_symbol!("identity"), r_symbol!("identity")));
        SET_TAG(call, R_NilValue);
        SET_TAG(CDDR(call), r_symbol!("error"));
        SET_TAG(CDDDR(call), r_symbol!("interrupt"));

        // evaluate the call
        let envir = if self.package.is_empty() { R_GlobalEnv } else { R_BaseEnv };
        let result = protect.add(Rf_eval(call, envir));

        if r_inherits(result, "error") {

            let code = r_stringify(call, "\n")?;
            let message = geterrmessage();
            return Err(Error::EvaluationError {
                code: code,
                message: message,
            });

        }

        return Ok(RObject::new(result));

    }

}

impl From<&str> for RFunction {
    fn from(function: &str) -> Self {
        RFunction::new("", function)
    }
}

pub fn geterrmessage() -> String {

    // SAFETY: Returns pointer to static memory buffer owned by R.
    let buffer = unsafe { R_curErrorBuf() };

    // SAFETY: The aforementioned buffer is never null.
    let cstr = unsafe { CStr::from_ptr(buffer) };

    match cstr.to_str() {
        Ok(value) => return value.to_string(),
        Err(_) => return "".to_string(),
    }

}

/// Wrappers around R_tryCatch()
///
/// Takes a single closure that returns either a SEXP or `()`. If an R error is
/// thrown this returns a an RError in the Err variant, otherwise it returns the
/// result of the closure wrapped in an RObject.
///
/// The handler closure is not used per se, we just get the condition verbatim in the Err variant
///
/// Safety: the body of the closure should be as simple as possible because in the event
///         of an R error, R will jump and there is no rust unwinding, i.e. rust values
///         are not dropped. A good rule of thumb is to consider the body of the closure
///         as C code.
///
/// ```ignore
/// SEXP R_tryCatch(
///     SEXP (*body)(void *), void *bdata,
///     SEXP conds,
///     SEXP (*handler)(SEXP, void *), void *hdata),
///     void (*finally)(void*), void* fdata
/// )
/// ```
pub unsafe fn r_try_catch_finally<F, R, S, Finally>(mut fun: F, classes: S, mut finally: Finally) -> Result<RObject>
where
    F: FnMut() -> R,
    R: Into<RObject>,
    Finally: FnMut(),
    S: Into<CharacterVector>,
{
    // C function that is passed as `body`
    // the actual closure is passed as a void* through arg
    extern "C" fn body_fn<S>(arg: *mut c_void) -> SEXP
    where
        S: Into<RObject>
    {
        // extract the "closure" from the void*
        // idea from https://adventures.michaelfbryan.com/posts/rust-closures-in-ffi/
        let closure: &mut &mut dyn FnMut() -> S = unsafe { mem::transmute(arg) };

        // call the closure and return it result as a SEXP
        let out : RObject = closure().into();
        out.sexp
    }

    // The actual closure is passed as a void*
    let mut body_data: &mut dyn FnMut() -> R = &mut fun;
    let body_data = &mut body_data;

    // handler just returns the condition and sets success to false
    // to signal that an error was caught
    //
    // This is similar to doing tryCatch(<C code>, error = force) in R
    // except that we can handle the weird case where the code
    // succeeds but returns a an error object
    let mut success: bool = true;
    let success_ptr: *mut bool = &mut success;

    extern "C" fn handler_fn(condition: SEXP, arg: *mut c_void) -> SEXP {
        // signal that there was an error
        let success_ptr = arg as *mut bool;
        unsafe {
            *success_ptr = false;
        }

        // and return the R condition as is
        condition
    }

    // C function that is passed as `finally`
    // the actual closure is passed as a void* through arg
    extern "C" fn finally_fn(arg: *mut c_void) {
        // extract the "closure" from the void*
        let closure: &mut &mut dyn FnMut() = unsafe { mem::transmute(arg) };

        closure();
    }

    // The actual finally closure is passed as a void*
    let mut finally_data: &mut dyn FnMut() = &mut finally;
    let finally_data = &mut finally_data;

    let classes = classes.into();

    let result = R_tryCatch(
        Some(body_fn::<R>),
        body_data as *mut _ as *mut c_void,

        *classes,

        Some(handler_fn),
        success_ptr as *mut c_void,

        Some(finally_fn),
        finally_data as *mut _ as *mut c_void,
    );

    match success {
        true => {
            // the call to tryCatch() was successful, so we return the result
            // as an RObject
            Ok(RObject::from(result))
        },
        false => {
            // the call to tryCatch failed, so result is a condition
            // from which we can extract classes and message via a call to conditionMessage()
            let classes : Vec<String> = RObject::from(Rf_getAttrib(result, R_ClassSymbol)).try_into()?;

            let mut protect = RProtect::new();
            let call = protect.add(Rf_lang2(r_symbol!("conditionMessage"), result));

            // TODO: wrap the call to conditionMessage() in a tryCatch
            //       but this cannot be another call to r_try_catch_error()
            //       because it creates a recursion problem
            let message: Vec<String> = RObject::from(Rf_eval(call, R_BaseEnv)).try_into()?;

            Err(Error::TryCatchError {
                message, classes
            })
        }
    }
}

pub unsafe fn r_try_catch<F, R, S>(fun: F, classes: S) -> Result<RObject>
where
    F: FnMut() -> R,
    RObject: From<R>,
    S: Into<CharacterVector>,
{
    r_try_catch_finally(fun, classes, || {})
}

pub unsafe fn r_try_catch_error<F, R>(fun: F) -> Result<RObject>
where
    F: FnMut() -> R,
    RObject: From<R>
{
    let vector = CharacterVector::create(["error"]);
    r_try_catch_finally(fun, vector, || {})
}

pub enum ParseResult {
    Complete(SEXP),
    Incomplete()
}

#[allow(non_upper_case_globals)]
pub unsafe fn r_parse_vector(code: &str) -> Result<ParseResult> {

    let mut ps : ParseStatus = 0;
    let mut protect = RProtect::new();
    let r_code = r_string!(code, &mut protect);

    let result = r_try_catch_error(|| {
        R_ParseVector(r_code, -1, &mut ps, R_NilValue)
    })?;

    match ps {
        ParseStatus_PARSE_OK => {
            Ok(ParseResult::Complete(*result))
        },
        ParseStatus_PARSE_INCOMPLETE => Ok(ParseResult::Incomplete()),
        ParseStatus_PARSE_ERROR => {
            Err(Error::ParseSyntaxError {
                message: CStr::from_ptr(R_ParseErrorMsg.as_ptr()).to_string_lossy().to_string(),
                line: R_ParseError as i32
            })
        },
        _ => {
            // should not get here
            Err(Error::ParseError {
                code: code.to_string(),
                message: String::from("Unknown parse error")
            })
        }
    }
}

#[cfg(test)]
mod tests {

    use std::ffi::CString;
    use std::io::Write;

    use crate::assert_match;
    use crate::r_lock;
    use crate::r_test;
    use crate::r_test_unlocked;
    use crate::utils::r_envir_remove;
    use crate::utils::r_is_null;

    use super::*;

    #[test]
    fn test_basic_function() { r_test! {

        // try adding some numbers
        let result = RFunction::new("", "+")
            .add(2)
            .add(2)
            .call()
            .unwrap();

        // check the result
        assert!(Rf_isInteger(*result) != 0);
        assert!(Rf_asInteger(*result) == 4);

    }}

    #[test]
    fn test_utf8_strings() { r_test! {

        // try sending some UTF-8 strings to and from R
        let result = RFunction::new("base", "paste")
            .add("世界")
            .add("您好".to_string())
            .call()
            .unwrap();

        assert!(Rf_isString(*result) != 0);

        let value = TryInto::<String>::try_into(result);
        assert!(value.is_ok());
        if let Ok(value) = value {
            assert!(value == "世界 您好")
        }

    }}

    #[test]
    fn test_named_arguments() { r_test! {

        let result = RFunction::new("stats", "rnorm")
            .add(1.0)
            .param("mean", 10)
            .param("sd", 0)
            .call()
            .unwrap();

        assert!(Rf_isNumeric(*result) != 0);
        assert!(Rf_asInteger(*result) == 10);

    }}

    #[test]
    fn test_threads() { r_test_unlocked! {

        // Spawn a bunch of threads that try to interact with R.
        const N : i32 = 1000;
        let mut handles : Vec<_> = Vec::new();
        for _i in 1..20 {
            let handle = std::thread::spawn(move || {
                let id = std::thread::current().id();
                for _j in 1..20 {
                    r_lock! {
                        println!("Thread {:?} acquiring R lock.", id);
                        std::io::stdout().flush().unwrap();
                        let mut protect = RProtect::new();
                        let code = protect.add(Rf_lang2(r_symbol!("rnorm"), Rf_ScalarInteger(N)));
                        println!("Thread {:?} about to evaluate R code.", id);
                        std::io::stdout().flush().unwrap();
                        let result = protect.add(Rf_eval(code, R_GlobalEnv));
                        println!("Thread {:?} finished evaluating R code.", id);
                        std::io::stdout().flush().unwrap();
                        assert!(Rf_length(result) == N);
                        println!("Thread {:?} releasing R lock.", std::thread::current().id());
                        std::io::stdout().flush().unwrap();
                    };
                }
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

    }}

    #[test]
    fn test_try_catch_error() { r_test! {

        // ok SEXP
        let ok = r_try_catch_error(|| {
            Rf_ScalarInteger(42)
        });
        assert_match!(ok, Ok(value) => {
            assert_eq!(r_typeof(*value), INTSXP as u32);
            assert_eq!(INTEGER_ELT(*value, 0), 42);
        });

        // ok void
        let void_ok = r_try_catch_error(|| {});
        assert_match!(void_ok, Ok(value) => {
            assert!(r_is_null(*value));
        });

        // ok something else, Vec<&str>
        let value = r_try_catch_error(|| {
            CharacterVector::create(["hello", "world"]).cast()
        });

        assert_match!(value, Ok(value) => {
            assert_eq!(r_typeof(*value), STRSXP);
            let value = CharacterVector::new(value);
            assert_match!(value, Ok(value) => {
                assert_eq!(value, ["hello", "world"]);
            })
        });

        // error
        let out = r_try_catch_error(|| unsafe {
            let msg = CString::new("ouch").unwrap();
            Rf_error(msg.as_ptr());
        });

        assert_match!(out, Err(Error::TryCatchError { message, classes }) => {
            assert_eq!(message, ["ouch"]);
            assert_eq!(classes, ["simpleError", "error", "condition"]);
        });

    }}

    #[test]
    fn test_parse_vector() { r_test! {
        // complete
        assert_match!(
            r_parse_vector("force(42)"),
            Ok(ParseResult::Complete(out)) => {
                assert_eq!(r_typeof(out), EXPRSXP as u32);

                let call = VECTOR_ELT(out, 0);
                assert_eq!(r_typeof(call), LANGSXP as u32);
                assert_eq!(Rf_length(call), 2);
                assert_eq!(CAR(call), r_symbol!("force"));

                let arg = CADR(call);
                assert_eq!(r_typeof(arg), REALSXP as u32);
                assert_eq!(*REAL(arg), 42.0);
            }
        );

        // incomplete
        assert_match!(
            r_parse_vector("force(42"),
            Ok(ParseResult::Incomplete())
        );

        // error
        assert_match!(
            r_parse_vector("42 + _"),
            Err(_) => {}
        );

        // "normal" syntax error
        assert_match!(
            r_parse_vector("1+1\n*42"),
            Err(Error::ParseSyntaxError {message, line}) => {
                assert!(message.contains("unexpected"));
                assert_eq!(line, 2);
            }
        );

    }}

    #[test]
    fn test_dirty_image() { r_test! {
        libR_sys::R_DirtyImage = 2;
        let sym = r_symbol!("aaa");
        Rf_defineVar(sym, Rf_ScalarInteger(42), R_GlobalEnv);
        assert_eq!(libR_sys::R_DirtyImage, 1);

        libR_sys::R_DirtyImage = 2;
        Rf_setVar(sym, Rf_ScalarInteger(43), R_GlobalEnv);
        assert_eq!(libR_sys::R_DirtyImage, 1);

        libR_sys::R_DirtyImage = 2;
        r_envir_remove("aaa", R_GlobalEnv);
        assert_eq!(libR_sys::R_DirtyImage, 1);
    }}

}

