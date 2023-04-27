//
// environment.rs
//
// Copyright (C) 2022 Posit Software, PBC. All rights reserved.
//
//

use std::ops::Deref;

use libR_sys::*;

use crate::object::RObject;
use crate::symbol::RSymbol;
use crate::utils::Sxpinfo;
use crate::utils::r_is_altrep;
use crate::utils::r_is_null;
use crate::utils::r_is_s4;
use crate::utils::r_typeof;

#[derive(Eq)]
pub struct BindingReference {
    pub reference: bool
}

fn has_reference(value: SEXP) -> bool {
    if r_is_null(value) {
        return false;
    }

    if r_is_altrep(value) {
        unsafe {
            return has_reference(R_altrep_data1(value)) || has_reference(R_altrep_data2(value));
        }
    }

    unsafe {
        // S4 slots are attributes and might be expandable
        // so we need to check if they have reference objects
        if r_is_s4(value) && has_reference(ATTRIB(value)) {
            return true;
        }
    }

    let rtype = r_typeof(value);
    match rtype {
        ENVSXP  => true,

        LISTSXP | LANGSXP => unsafe {
            has_reference(CAR(value)) || has_reference(CDR(value))
        },

        VECSXP | EXPRSXP  => unsafe {
            let n = XLENGTH(value);
            let mut has_ref = false;
            for i in 0..n {
                if has_reference(VECTOR_ELT(value, i)) {
                    has_ref = true;
                    break;
                }
            }
            has_ref
        },

        _      => false
    }

}

impl BindingReference {
    fn new(value: SEXP) -> Self {
        Self {
            reference: has_reference(value)
        }
    }
}

impl PartialEq for BindingReference {
    fn eq(&self, other: &Self) -> bool {
        !(self.reference || other.reference)
    }
}

#[derive(Eq, PartialEq)]
pub enum BindingValue {
    Active{fun: SEXP},
    Promise{promise: SEXP},
    Altrep{object: SEXP, data1: SEXP, data2: SEXP, reference: BindingReference},
    Standard{object: SEXP, reference: BindingReference}
}

#[derive(Eq, PartialEq)]
pub struct Binding {
    pub name: RSymbol,
    pub value: BindingValue
}

impl Binding {
    pub fn new(env: SEXP, frame: SEXP) -> Self {
        unsafe {
            let name = RSymbol::new(TAG(frame));

            let info = Sxpinfo::interpret(&frame);

            if info.is_immediate() {
                // force the immediate bindings before we can safely call CAR()
                Rf_findVarInFrame(env, *name);
            }
            let mut value = CAR(frame);

            if info.is_active() {
                let value = BindingValue::Active{
                    fun: value
                };
                return Self {name, value};
            }

            if r_typeof(value) == PROMSXP {
                let pr_value = PRVALUE(value);
                if pr_value == R_UnboundValue {
                    let value = BindingValue::Promise { promise: value };
                    return Self { name, value };
                }

                value = pr_value;
            }

            if r_is_altrep(value) {
                let value = BindingValue::Altrep {
                    object: value,
                    data1: R_altrep_data1(value),
                    data2: R_altrep_data2(value),
                    reference: BindingReference::new(value)
                };
                return Self {name, value};
            }

            let value = BindingValue::Standard {
                object: value,
                reference: BindingReference::new(value)
            };
            Self { name, value}
        }

    }

    pub fn is_hidden(&self) -> bool {
        String::from(self.name).starts_with(".")
    }

    pub fn is_active(&self) -> bool {
        if let BindingValue::Active { .. } = self.value {
            true
        } else {
            false
        }
    }

}

pub struct Environment {
    env: RObject,
}

impl Deref for Environment {
    type Target = SEXP;
    fn deref(&self) -> &Self::Target {
        &self.env.sexp
    }
}

pub struct HashedEnvironmentIter<'a> {
    env: &'a Environment,

    hashtab: SEXP,
    hashtab_index: R_xlen_t,
    frame: SEXP
}

impl<'a> HashedEnvironmentIter<'a> {
    pub fn new(env: &'a Environment) -> Self {
        unsafe {
            let hashtab = HASHTAB(**env);
            let hashtab_len = XLENGTH(hashtab);
            let mut hashtab_index = 0;
            let mut frame = R_NilValue;

            // look for the first non null frame
            loop {
                let f = VECTOR_ELT(hashtab, hashtab_index);
                if f != R_NilValue {
                    frame = f;
                    break;
                }

                hashtab_index = hashtab_index + 1;
                if hashtab_index == hashtab_len {
                    break;
                }
            }

            Self {
                env,
                hashtab,
                hashtab_index,
                frame
            }

        }
    }
}

impl<'a> Iterator for HashedEnvironmentIter<'a> {
    type Item = Binding;

    fn next(&mut self) -> Option<Self::Item> {

        unsafe {
            if self.frame == R_NilValue {
                return None;
            }

            // grab the next Binding
            let binding = Binding::new(*self.env.env, self.frame);

            // and advance to next binding
            self.frame = CDR(self.frame);

            if self.frame == R_NilValue {
                // end of frame: move to the next non empty frame
                let hashtab_len = XLENGTH(self.hashtab);
                loop {
                    // move to the next frame
                    self.hashtab_index = self.hashtab_index + 1;

                    // end of iteration
                    if self.hashtab_index == hashtab_len {
                        self.frame = R_NilValue;
                        break;
                    }

                    // skip empty frames
                    self.frame = VECTOR_ELT(self.hashtab, self.hashtab_index);
                    if self.frame != R_NilValue {
                        break;
                    }
                }
            }

            Some(binding)

        }
    }
}

pub struct NonHashedEnvironmentIter<'a> {
    env: &'a Environment,

    frame: SEXP
}

impl<'a> NonHashedEnvironmentIter<'a> {
    pub fn new(env: &'a Environment) -> Self {
        unsafe {
            Self {
                env,
                frame: FRAME(**env),
            }
        }
    }
}

impl<'a> Iterator for NonHashedEnvironmentIter<'a> {
    type Item = Binding;

    fn next(&mut self) -> Option<Self::Item> {
        unsafe {
            if self.frame == R_NilValue {
                None
            } else {
                let binding = Binding::new(*self.env.env, self.frame);
                self.frame = CDR(self.frame);
                Some(binding)
            }
        }
    }
}

pub enum EnvironmentIter<'a> {
    Hashed(HashedEnvironmentIter<'a>),
    NonHashed(NonHashedEnvironmentIter<'a>)
}

impl<'a> EnvironmentIter<'a> {
    pub fn new(env: &'a Environment) -> Self {

        unsafe {
            let hashtab = HASHTAB(**env);
            if hashtab == R_NilValue {
                EnvironmentIter::NonHashed(NonHashedEnvironmentIter::new(env))
            } else {
                EnvironmentIter::Hashed(HashedEnvironmentIter::new(env))
            }
        }
    }
}

impl<'a> Iterator for EnvironmentIter<'a> {
    type Item = Binding;

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            EnvironmentIter::Hashed(iter) => iter.next(),
            EnvironmentIter::NonHashed(iter) => iter.next()
        }
    }
}

impl Environment {
    pub fn new(env: RObject) -> Self {
        Self {env}
    }

    pub fn iter(&self) -> EnvironmentIter {
        EnvironmentIter::new(&self)
    }

    pub fn exists(&self, name: impl Into<RSymbol>) -> bool {
        unsafe {
            R_existsVarInFrame(self.env.sexp, *name.into()) == Rboolean_TRUE
        }
    }

    pub fn find(&self, name: impl Into<RSymbol>) -> SEXP {
        let name = name.into();
        unsafe { Rf_findVarInFrame(self.env.sexp, *name) }
    }

    pub fn is_empty(&self) -> bool {
        self
            .iter()
            .filter(|b| !b.is_hidden())
            .next()
            .is_none()
    }
}

#[cfg(test)]
mod tests {
    use libR_sys::*;

    use crate::r_symbol;
    use crate::r_test;
    use crate::exec::RFunction;
    use crate::exec::RFunctionExt;

    use super::*;

    unsafe fn test_environment_iter_impl(hash: bool) {
        let test_env = RFunction::new("base", "new.env")
            .param("parent", R_EmptyEnv)
            .param("hash", RObject::from(hash))
            .call()
            .unwrap();

        let sym = r_symbol!("a");
        Rf_defineVar(sym, Rf_ScalarInteger(42), test_env.sexp);

        let sym = r_symbol!("b");
        Rf_defineVar(sym, Rf_ScalarInteger(43), test_env.sexp);

        let sym = r_symbol!("c");
        Rf_defineVar(sym, Rf_ScalarInteger(44), test_env.sexp);

        let env = Environment::new(test_env);
        assert_eq!(env.iter().count(), 3);
    }

    #[test]
    #[allow(non_snake_case)]
    fn test_environment_iter() { r_test! {
        test_environment_iter_impl(true);
        test_environment_iter_impl(false);
    }}

}