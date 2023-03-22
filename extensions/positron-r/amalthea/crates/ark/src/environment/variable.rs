//
// variable.rs
//
// Copyright (C) 2023 by Posit Software, PBC
//
//

use harp::environment::Binding;
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
    /** The environment variable's name */
    pub name: String,

    /** The environment variable's value kind (string, number, etc.) */
    pub kind: ValueKind,

    /** A formatted representation of the variable's value */
    pub value: String,
}

impl EnvironmentVariable {
    /**
     * Create a new EnvironmentVariable from a Binding
     */
    pub fn new(binding: &Binding) -> Self {
        let name = binding.name.to_string();

        let value = binding.describe();
        let kind = ValueKind::String;

        Self { name, kind, value }
    }
}
