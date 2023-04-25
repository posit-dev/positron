//
// variable.rs
//
// Copyright (C) 2023 by Posit Software, PBC
//
//

use harp::environment::BindingValue;
use harp::utils::r_altrep_class;
use harp::utils::r_is_s4;
use harp::utils::r_vec_shape;
use harp::utils::r_vec_type;
use harp::utils::pairlist_size;
use harp::utils::r_classes;
use harp::utils::r_is_altrep;
use harp::utils::r_is_simple_vector;
use itertools::Itertools;

use harp::environment::Binding;
use harp::environment::Environment;
use harp::exec::RFunction;
use harp::exec::RFunctionExt;
use harp::exec::r_try_catch_error;
use harp::object::RObject;
use harp::r_symbol;
use harp::symbol::RSymbol;
use harp::utils::r_assert_type;
use harp::utils::r_inherits;
use harp::utils::r_is_null;
use harp::utils::r_typeof;
use harp::vector::CharacterVector;
use harp::vector::Vector;
use harp::vector::collapse;
use libR_sys::*;
use serde::Deserialize;
use serde::Serialize;

/// Represents the supported kinds of variable values.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ValueKind {
    /// A length-1 logical vector
    Boolean,

    /// A raw byte array
    Bytes,

    /// A collection of unnamed values; usually a vector
    Collection,

    /// Empty/missing values such as NULL, NA, or missing
    Empty,

    /// A function, method, closure, or other callable object
    Function,

    /// Named lists of values, such as lists and (hashed) environments
    Map,

    /// A number, such as an integer or floating-point value
    Number,

    /// A value of an unknown or unspecified type
    Other,

    /// A character string
    String,

    /// A table, dataframe, 2D matrix, or other two-dimensional data structure
    Table,
}

/// Represents the serialized form of an environment variable.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvironmentVariable {
    /** The access key; not displayed to the user, but used to form path accessors */
    pub access_key: String,

    /** The environment variable's name, formatted for display */
    pub display_name: String,

    /** The environment variable's value, formatted for display */
    pub display_value: String,

    /** The environment variable's type, formatted for display */
    pub display_type: String,

    /** Extended type information */
    pub type_info: String,

    /** The environment variable's value kind (string, number, etc.) */
    pub kind: ValueKind,

    /** The number of elements in the variable's value, if applicable */
    pub length: usize,

    /** The size of the variable's value, in bytes */
    pub size: usize,

    /** True if the variable contains other variables */
    pub has_children: bool,

    /** True if the 'value' field was truncated to fit in the message */
    pub is_truncated: bool,
}

pub struct WorkspaceVariableDisplayValue {
    pub display_value: String,
    pub is_truncated: bool
}

impl WorkspaceVariableDisplayValue {
    fn new(display_value: String, is_truncated: bool) -> Self {
        WorkspaceVariableDisplayValue {
            display_value,
            is_truncated
        }
    }

    fn empty() -> Self {
        Self::new(String::from(""), false)
    }

    pub fn from(value: SEXP) -> Self {
        let rtype = r_typeof(value);
        if r_is_simple_vector(value) {
            let formatted = collapse(value, " ", 100, if rtype == STRSXP { "\"" } else { "" }).unwrap();
            Self::new(formatted.result, formatted.truncated)
        } else if rtype == VECSXP && ! unsafe{r_inherits(value, "POSIXlt")}{
            // This includes data frames
            Self::empty()
        } else if rtype == LISTSXP {
            Self::empty()
        } else if rtype == SYMSXP && value == unsafe{ R_MissingArg } {
            Self::new(String::from("<missing>"), false)
        } else if rtype == CLOSXP {
            unsafe {
                let args      = RFunction::from("args").add(value).call().unwrap();
                let formatted = RFunction::from("format").add(*args).call().unwrap();
                let formatted = CharacterVector::new_unchecked(formatted);
                let out = formatted.iter().take(formatted.len() -1).map(|o|{ o.unwrap() }).join("");
                Self::new(out, false)
            }
        } else {
            unsafe {
                // try to call format() on the object
                let formatted = RFunction::new("base", "format")
                    .add(value)
                    .call();

                match formatted {
                    Ok(fmt) => {
                        if r_typeof(*fmt) == STRSXP {
                            let fmt = collapse(*fmt, " ", 100, "").unwrap();
                            Self::new(fmt.result, fmt.truncated)
                        } else {
                            Self::new(String::from("???"), false)
                        }
                    },
                    Err(_) => {
                        Self::new(String::from("???"), false)
                    }
                }
            }
        }
    }
}


pub struct WorkspaceVariableDisplayType {
    pub display_type: String,
    pub type_info: String
}

impl WorkspaceVariableDisplayType {

    pub fn from(value: SEXP) -> Self {
        if r_is_null(value) {
            return Self::simple(String::from("NULL"))
        }

        if r_is_s4(value) {
            return Self::from_class(value, String::from("S4"));
        }

        if r_is_simple_vector(value) {
            let display_type = format!("{}{}", r_vec_type(value), r_vec_shape(value));

            let mut type_info = display_type.clone();
            if r_is_altrep(value) {
                type_info.push_str(r_altrep_class(value).as_str())
            }

            return Self::new(display_type, type_info);
        }

        let rtype = r_typeof(value);
        match rtype {
            EXPRSXP => Self::from_class(value, format!("expression [{}]", unsafe { XLENGTH(value) })),
            LANGSXP => Self::from_class(value, String::from("language")),
            CLOSXP  => Self::from_class(value, String::from("function")),
            ENVSXP  => Self::from_class(value, String::from("environment")),
            SYMSXP  => {
                if r_is_null(value) {
                    Self::simple(String::from("missing"))
                } else {
                    Self::simple(String::from("symbol"))
                }
            },

            LISTSXP => {
                match pairlist_size(value) {
                    Ok(n)  => Self::simple(format!("pairlist [{}]", n)),
                    Err(_) => Self::simple(String::from("pairlist [?]"))
                }
            },

            VECSXP => unsafe {
                if r_inherits(value, "data.frame") {
                    let classes = r_classes(value).unwrap();
                    let dfclass = classes.get_unchecked(0).unwrap();

                    let dim = RFunction::new("base", "dim.data.frame")
                        .add(value)
                        .call()
                        .unwrap();
                    let shape = collapse(*dim, ",", 0, "").unwrap().result;

                    Self::simple(
                        format!("{} [{}]", dfclass, shape)
                    )
                } else {
                    Self::from_class(value, format!("list [{}]", XLENGTH(value)))
                }
            },
            _      => Self::from_class(value, String::from("???"))
        }

    }

    fn simple(display_type: String) -> Self {
        Self {
            display_type,
            type_info: String::from("")
        }
    }

    fn from_class(value: SEXP, default: String) -> Self {
        match r_classes(value) {
            None => Self::simple(default),
            Some(classes) => {
                Self::new(
                    classes.get_unchecked(0).unwrap(),
                    classes.iter().map(|s| s.unwrap()).join("/")
                )
            }
        }
    }

    fn new(display_type: String, type_info: String) -> Self {
        Self {
            display_type,
            type_info
        }
    }

}

fn has_children(value: SEXP) -> bool {
    if RObject::view(value).is_s4() {
        unsafe {
            let names = RFunction::new("methods", ".slotNames").add(value).call().unwrap();
            let names = CharacterVector::new_unchecked(names);
            names.len() > 0
        }
    } else {
        match r_typeof(value) {
            VECSXP | EXPRSXP   => unsafe { XLENGTH(value) != 0 },
            LISTSXP  => true,
            ENVSXP   => !Environment::new(RObject::view(value)).is_empty(),
            _        => false
        }
    }
}

enum EnvironmentVariableNode {
    Concrete {
        object: RObject
    },
    Artificial {
        object: RObject,
        name: String
    }
}

impl EnvironmentVariable {
    /**
     * Create a new EnvironmentVariable from a Binding
     */
    pub fn new(binding: &Binding) -> Self {
        let display_name = binding.name.to_string();

        match binding.value {
            BindingValue::Active{..} => Self::from_lazy(display_name, String::from("active binding")),
            BindingValue::Promise{..} => Self::from_lazy(display_name, String::from("promise")),
            BindingValue::Altrep{object, ..} | BindingValue::Standard {object, ..} => Self::from(display_name.clone(), display_name, object)
        }
    }

    /**
     * Create a new EnvironmentVariable from an R object
     */
    fn from(access_key: String, display_name: String, x: SEXP) -> Self {
        let WorkspaceVariableDisplayValue{display_value, is_truncated} = WorkspaceVariableDisplayValue::from(x);
        let WorkspaceVariableDisplayType{display_type, type_info} = WorkspaceVariableDisplayType::from(x);

        Self {
            access_key,
            display_name,
            display_value,
            display_type,
            type_info,
            kind: Self::variable_kind(x),
            length: Self::variable_length(x),
            size: RObject::view(x).size(),
            has_children: has_children(x),
            is_truncated
        }
    }

    fn from_lazy(display_name: String, lazy_type: String) -> Self {
        Self {
            access_key: display_name.clone(),
            display_name,
            display_value: String::from(""),
            display_type: lazy_type.clone(),
            type_info: lazy_type,
            kind: ValueKind::Other,
            length: 0,
            size: 0,
            has_children: false,
            is_truncated: false
        }
    }

    fn variable_length(x: SEXP) -> usize {
        let rtype = r_typeof(x);
        match rtype {
            LGLSXP | RAWSXP | INTSXP | REALSXP | CPLXSXP | STRSXP => unsafe { XLENGTH(x) as usize },
            VECSXP => unsafe {
                if r_inherits(x, "POSIXlt") {
                    XLENGTH(VECTOR_ELT(x, 0)) as usize
                } else if r_inherits(x, "data.frame") {
                    let dim = RFunction::new("base", "dim.data.frame")
                        .add(x)
                        .call()
                        .unwrap();

                    INTEGER_ELT(*dim, 0) as usize
                } else {
                    XLENGTH(x) as usize
                }
            },
            LISTSXP => match pairlist_size(x) {
                Ok(n)  => n as usize,
                Err(_) => 0
            },
            _ => 0
        }
    }

    fn variable_kind(x: SEXP) -> ValueKind {
        if x == unsafe {R_NilValue} {
            return ValueKind::Empty;
        }

        let obj = RObject::view(x);

        if obj.is_s4() {
            return ValueKind::Map;
        }
        let is_object = obj.is_object();
        if is_object {
            unsafe {
                if r_inherits(x, "factor") {
                    return ValueKind::Other;
                }
                if r_inherits(x, "data.frame") {
                    return ValueKind::Table;
                }

                // TODO: generic S3 object, not sure what it should be
            }
        }

        match r_typeof(x) {
            CLOSXP => ValueKind::Function,

            ENVSXP => {
                // this includes R6 objects
                ValueKind::Map
            },

            VECSXP => unsafe {
                let dim = Rf_getAttrib(x, R_DimSymbol);
                if dim != R_NilValue && XLENGTH(dim) == 2 {
                    ValueKind::Table
                } else {
                    ValueKind::Map
                }
            },

            LGLSXP => unsafe {
                let dim = Rf_getAttrib(x, R_DimSymbol);
                if dim != R_NilValue && XLENGTH(dim) == 2 {
                    ValueKind::Table
                } else if XLENGTH(x) == 1 {
                    if LOGICAL_ELT(x, 0) == R_NaInt {
                        ValueKind::Empty
                    } else {
                        ValueKind::Boolean
                    }
                } else {
                    ValueKind::Collection
                }
            },

            INTSXP => unsafe {
                let dim = Rf_getAttrib(x, R_DimSymbol);
                if dim != R_NilValue && XLENGTH(dim) == 2 {
                    ValueKind::Table
                } else if XLENGTH(x) == 1 {
                    if INTEGER_ELT(x, 0) == R_NaInt {
                        ValueKind::Empty
                    } else {
                        ValueKind::Number
                    }
                } else {
                    ValueKind::Collection
                }
            },

            REALSXP => unsafe {
                let dim = Rf_getAttrib(x, R_DimSymbol);
                if dim != R_NilValue && XLENGTH(dim) == 2 {
                    ValueKind::Table
                } else if XLENGTH(x) == 1 {
                    if R_IsNA(REAL_ELT(x, 0)) == 1 {
                        ValueKind::Empty
                    } else {
                        ValueKind::Number
                    }
                } else {
                    ValueKind::Collection
                }
            },

            CPLXSXP => unsafe {
                let dim = Rf_getAttrib(x, R_DimSymbol);
                if dim != R_NilValue && XLENGTH(dim) == 2 {
                    ValueKind::Table
                } else if XLENGTH(x) == 1 {
                    let value = COMPLEX_ELT(x, 0);
                    if R_IsNA(value.r) == 1 || R_IsNA(value.i) == 1 {
                        ValueKind::Empty
                    } else {
                        ValueKind::Number
                    }
                } else {
                    ValueKind::Collection
                }
            }

            STRSXP => unsafe {
                let dim = Rf_getAttrib(x, R_DimSymbol);
                if dim != R_NilValue && XLENGTH(dim) == 2 {
                    ValueKind::Table
                } else if XLENGTH(x) == 1 {
                    if STRING_ELT(x, 0) == R_NaString {
                        ValueKind::Empty
                    } else {
                        ValueKind::String
                    }
                } else {
                    ValueKind::Collection
                }
            },

            RAWSXP  => ValueKind::Bytes,
            _       => ValueKind::Other
        }
    }

    pub fn inspect(env: RObject, path: &Vec<String>) -> Result<Vec<Self>, harp::error::Error> {
        let node = unsafe {
            Self::resolve_object_from_path(env, &path)?
        };

        match node {
            EnvironmentVariableNode::Artificial { object, name } => {
                match name.as_str() {
                    "<private>" => {
                        let env = Environment::new(object);
                        let enclos = Environment::new(RObject::view(env.find(".__enclos_env__")));
                        let private = RObject::view(enclos.find("private"));

                        Self::inspect_environment(private)
                    }

                    "<methods>" => Self::inspect_r6_methods(object),

                    _ => Err(harp::error::Error::InspectError {
                        path: path.clone()
                    })

                }
            }

            EnvironmentVariableNode::Concrete { object } => {
                if object.is_s4() {
                    Self::inspect_s4(*object)
                } else {
                    match r_typeof(*object) {
                        VECSXP | EXPRSXP  => Self::inspect_list(*object),
                        LISTSXP           => Self::inspect_pairlist(*object),
                        ENVSXP            => unsafe {
                            if r_inherits(*object, "R6") {
                                Self::inspect_r6(object)
                            } else {
                                Self::inspect_environment(object)
                            }

                        },
                        _                 => Ok(vec![])
                    }
                }
            }
        }

    }

    unsafe fn resolve_object_from_path(object: RObject, path: &Vec<String>) -> Result<EnvironmentVariableNode, harp::error::Error> {
        let mut node = EnvironmentVariableNode::Concrete { object };

        for path_element in path {
            node = match node {
                EnvironmentVariableNode::Concrete{object} => {
                    if object.is_s4() {
                        let name = r_symbol!(path_element);

                        let child = r_try_catch_error(|| {
                            R_do_slot(*object, name)
                        })?;

                        EnvironmentVariableNode::Concrete {
                            object: child
                        }
                    } else {
                        let rtype = r_typeof(*object);
                        match rtype {
                            ENVSXP => {
                                if r_inherits(*object, "R6") && path_element.starts_with("<") {
                                    EnvironmentVariableNode::Artificial {
                                        object,
                                        name: path_element.clone()
                                    }
                                } else {
                                    // TODO: consider the cases of :
                                    // - an unresolved promise
                                    // - active binding
                                    let symbol = r_symbol!(path_element);
                                    let mut x = Rf_findVarInFrame(*object, symbol);

                                    if r_typeof(x) == PROMSXP {
                                        x = PRVALUE(x);
                                    }

                                    EnvironmentVariableNode::Concrete {
                                        object: RObject::view(x)
                                    }

                                }
                            },

                            VECSXP | EXPRSXP => {
                                let index = path_element.parse::<isize>().unwrap();
                                EnvironmentVariableNode::Concrete {
                                    object: RObject::view(VECTOR_ELT(*object, index))
                                }
                            },

                            LISTSXP => {
                                let mut pairlist = *object;
                                let index = path_element.parse::<isize>().unwrap();
                                for _i in 0..index {
                                    pairlist = CDR(pairlist);
                                }
                                EnvironmentVariableNode::Concrete {
                                    object: RObject::view(CAR(pairlist))
                                }
                            },

                            _ => return Err(harp::error::Error::InspectError {
                                path: path.clone()
                            })
                        }
                    }
                },

                EnvironmentVariableNode::Artificial { object, name } => {
                    match name.as_str() {
                        "<private>" => {
                            let env = Environment::new(object);
                            let enclos = Environment::new(RObject::view(env.find(".__enclos_env__")));
                            let private = Environment::new(RObject::view(enclos.find("private")));

                            // TODO: it seems unlikely that private would host active bindings
                            //       so find() is fine, we can assume this is concrete
                            EnvironmentVariableNode::Concrete {
                                object: RObject::view(private.find(path_element))
                            }
                        }

                        _ => {
                            return Err(harp::error::Error::InspectError {
                                path: path.clone()
                            })
                        }
                    }
                }
            }
       }

       Ok(node)
    }

    fn inspect_list(value: SEXP) -> Result<Vec<Self>, harp::error::Error> {
        let mut out : Vec<Self> = vec![];
        let n = unsafe { XLENGTH(value) };

        let names = unsafe {
            CharacterVector::new_unchecked(RFunction::from(".ps.environment.listDisplayNames").add(value).call()?)
        };

        for i in 0..n {
            out.push(Self::from(
                i.to_string(),
                names.get_unchecked(i).unwrap(),
                unsafe{ VECTOR_ELT(value, i)}
            ));
        }

        Ok(out)
    }

    fn inspect_pairlist(value: SEXP) -> Result<Vec<Self>, harp::error::Error> {
        let mut out : Vec<Self> = vec![];

        let mut pairlist = value;
        unsafe {
            let mut i = 0;
            while pairlist != R_NilValue {

                r_assert_type(pairlist, &[LISTSXP])?;

                let tag = TAG(pairlist);
                let display_name = if r_is_null(tag) {
                    format!("[[{}]]", i + 1)
                } else {
                    String::from(RSymbol::new(tag))
                };

                out.push(Self::from(i.to_string(), display_name, CAR(pairlist)));

                pairlist = CDR(pairlist);
                i = i + 1;
            }
        }

        Ok(out)
    }

    fn inspect_r6(value: RObject) -> Result<Vec<Self>, harp::error::Error> {
        let mut has_private = false;
        let mut has_methods = false;

        let env = Environment::new(value);
        let mut childs: Vec<Self> = env
            .iter()
            .filter(|b: &Binding| {
                if b.name == ".__enclos_env__" {
                    if let BindingValue::Standard { object, .. } = b.value {
                        has_private = Environment::new(RObject::view(object)).exists("private");
                    }

                    false
                } else if b.is_hidden() {
                    false
                } else {
                    match b.value {
                        BindingValue::Standard { object, .. } | BindingValue::Altrep { object, .. } => {
                            if r_typeof(object) == CLOSXP {
                                has_methods = true;
                                false
                            } else {
                                true
                            }
                        },

                        // active bindings and promises
                        _ => true
                    }
                }

            })
            .map(|b| {
                Self::new(&b)
            })
            .collect();

        childs.sort_by(|a, b| {
            a.display_name.cmp(&b.display_name)
        });

        if has_private {
            childs.push(Self {
                access_key: String::from("<private>"),
                display_name: String::from("private"),
                display_value: String::from("Private fields and methods"),
                display_type: String::from(""),
                type_info: String::from(""),
                kind: ValueKind::Other,
                length: 0,
                size: 0,
                has_children: true,
                is_truncated: false
            });
        }

        if has_methods {
            childs.push(Self {
                access_key: String::from("<methods>"),
                display_name: String::from("methods"),
                display_value: String::from("Methods"),
                display_type: String::from(""),
                type_info: String::from(""),
                kind: ValueKind::Other,
                length: 0,
                size: 0,
                has_children: true,
                is_truncated: false
            });
        }

        Ok(childs)
    }

    fn inspect_environment(value: RObject) -> Result<Vec<Self>, harp::error::Error> {
        let mut out: Vec<Self> = Environment::new(value)
            .iter()
            .filter(|b: &Binding| {
                !b.is_hidden()
            })
            .map(|b| {
                Self::new(&b)
            })
            .collect();

        out.sort_by(|a, b| {
            a.display_name.cmp(&b.display_name)
        });

        Ok(out)
    }

    fn inspect_s4(value: SEXP) -> Result<Vec<Self>, harp::error::Error> {
        let mut out: Vec<Self> = vec![];

        unsafe {
            let slot_names = RFunction::new("methods", ".slotNames")
                .add(value)
                .call()?;

            let slot_names = CharacterVector::new_unchecked(*slot_names);
            let mut iter = slot_names.iter();
            while let Some(Some(display_name)) = iter.next() {
                let slot_symbol = r_symbol!(display_name);
                let slot = r_try_catch_error(|| {
                    R_do_slot(value, slot_symbol)
                })?;
                let access_key = display_name.clone();
                out.push(
                    EnvironmentVariable::from(
                        access_key,
                        display_name,
                        *slot
                    )
                );
            }
        }

        Ok(out)
    }

    fn inspect_r6_methods(value: RObject) -> Result<Vec<Self>, harp::error::Error> {
        let mut out: Vec<Self> = Environment::new(value)
            .iter()
            .filter(|b: &Binding| {
                match b.value {

                    BindingValue::Standard { object, .. } => {
                        r_typeof(object) == CLOSXP
                    }

                    _ => false
                }
            })
            .map(|b| {
                Self::new(&b)
            })
            .collect();

        out.sort_by(|a, b| {
            a.display_name.cmp(&b.display_name)
        });

        Ok(out)
    }

}
