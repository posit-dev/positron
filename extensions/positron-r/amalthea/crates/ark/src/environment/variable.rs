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
    /// A character vector (string) or value that can be converted to a string
    String,

    /// A numeric value
    Number,

    /// A vector (VECSXP)
    Vector,

    /// A list (LISTSXP)
    List,

    /// A function value
    Function,

    /// Data frame (data.frame, tibble, etc.)
    Dataframe,
    // TODO: Add other types of values. These don't have to map 1-1 to R object
    // types; they represent the kinds of values that have unique UI
    // representations. Note that these value kinds are shared across all
    // languages so they need to be somewhat generic.
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

        // let value = binding.describe();
        // until some more work is done
        let value = name.clone();
        let kind = ValueKind::String;

        Self {
            name, kind, value
        }
    }
}
