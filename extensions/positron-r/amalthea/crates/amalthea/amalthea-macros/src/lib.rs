//
// lib.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

use proc_macro::TokenStream;
use quote::quote;

extern crate proc_macro;

#[proc_macro_attribute]
pub fn event(attr: TokenStream, item: TokenStream) -> TokenStream {

    let original : syn::ItemStruct = syn::parse(item).unwrap();
    let ident = original.ident.clone();
    let attr : proc_macro2::TokenStream = attr.into();

    let generated = quote! {

        #[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
        #original

        impl PositronEventType for #ident {
            fn event_type(&self) -> String {
                String::from(#attr)
            }
        }

    };

    generated.into()

}
