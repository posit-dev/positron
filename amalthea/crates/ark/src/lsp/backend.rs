//
// backend.rs
//
// Copyright (C) 2022 by Posit, PBC
//
//

#![allow(deprecated)]

use std::collections::HashSet;
use std::path::Path;
use std::sync::mpsc::SyncSender;
use std::sync::Arc;
use std::sync::Mutex;

use dashmap::DashMap;
use harp::r_lock;
use log::*;
use regex::Regex;
use serde_json::Value;
use stdext::*;
use tokio::net::TcpStream;
use tower_lsp::jsonrpc::Result;
use tower_lsp::lsp_types::*;
use tower_lsp::lsp_types::request::GotoImplementationParams;
use tower_lsp::lsp_types::request::GotoImplementationResponse;
use tower_lsp::{Client, LanguageServer, LspService, Server};

use crate::lsp::completions::CompletionData;
use crate::lsp::completions::append_document_completions;
use crate::lsp::completions::append_session_completions;
use crate::lsp::completions::append_workspace_completions;
use crate::lsp::completions::can_provide_completions;
use crate::lsp::completions::completion_context;
use crate::lsp::completions::resolve_completion_item;
use crate::lsp::definitions::goto_definition_context;
use crate::lsp::document::Document;
use crate::lsp::hover::hover;
use crate::lsp::indexer;
use crate::lsp::modules;
use crate::lsp::symbols;
use crate::request::Request;

macro_rules! backend_trace {

    ($self: expr, $($rest: expr),*) => {{
        let message = format!($($rest, )*);
        $self.client.log_message(tower_lsp::lsp_types::MessageType::INFO, message).await
    }};

}

#[derive(Debug)]
pub struct Workspace {
    pub folders: Vec<Url>,
}

impl Default for Workspace {
    fn default() -> Self {
        Self {
            folders: Default::default(),
        }
    }
}

#[derive(Debug)]
pub struct Backend {
    pub client: Client,
    pub documents: DashMap<Url, Document>,
    pub workspace: Arc<Mutex<Workspace>>,
    #[allow(dead_code)]
    pub channel: SyncSender<Request>,
}

impl Backend {

    pub fn with_document<T, F>(&self, path: &Path, mut callback: F) -> anyhow::Result<T>
    where
        F: FnMut(&Document) -> anyhow::Result<T>
    {
        let mut fallback = || {
            let contents = std::fs::read_to_string(path)?;
            let document = Document::new(contents.as_str());
            return callback(&document);
        };

        // If we have a cached copy of the document (because we're monitoring it)
        // then use that; otherwise, try to read the document from the provided
        // path and use that instead.
        let uri = unwrap!(Url::from_file_path(path), Err(_) => {
            info!("couldn't construct uri from {:?}; using fallback", path);
            return fallback();
        });

        let document = unwrap!(self.documents.get(&uri), None => {
            info!("no document for uri {:?}; using fallback", uri);
            return fallback();
        });

        return callback(document.value());
    }
}

#[tower_lsp::async_trait]
impl LanguageServer for Backend {

    async fn initialize(&self, params: InitializeParams) -> Result<InitializeResult> {
        backend_trace!(self, "initialize({:#?})", params);

        // initialize our support functions
        r_lock! { modules::initialize() };

        // initialize the set of known workspaces
        if let Ok(mut workspace) = self.workspace.lock() {

            // initialize the workspace folders
            let mut folders: Vec<String> = Vec::new();
            if let Some(workspace_folders) = params.workspace_folders {
                for folder in workspace_folders.iter() {
                    workspace.folders.push(folder.uri.clone());
                    if let Ok(path) = folder.uri.to_file_path() {
                        if let Some(path) = path.to_str() {
                            folders.push(path.to_string());
                        }
                    }
                }
            }

            // start indexing
            indexer::start(folders);

        }

        Ok(InitializeResult {
            server_info: Some(ServerInfo {
                name: "Amalthea R Kernel (ARK)".to_string(),
                version: Some(env!("CARGO_PKG_VERSION").to_string()),
            }),
            capabilities: ServerCapabilities {
                text_document_sync: Some(TextDocumentSyncCapability::Kind(
                    TextDocumentSyncKind::INCREMENTAL,
                )),
                selection_range_provider: None,
                hover_provider: Some(HoverProviderCapability::from(true)),
                completion_provider: Some(CompletionOptions {
                    resolve_provider: Some(true),
                    trigger_characters: Some(vec![
                        "$".to_string(),
                        "@".to_string(),
                        ":".to_string(),
                    ]),
                    work_done_progress_options: Default::default(),
                    all_commit_characters: None,
                    ..Default::default()
                }),
                signature_help_provider: None,
                definition_provider: Some(OneOf::Left(true)),
                type_definition_provider: None,
                implementation_provider: Some(ImplementationProviderCapability::Simple(true)),
                references_provider: Some(OneOf::Left(true)),
                document_symbol_provider: Some(OneOf::Left(true)),
                workspace_symbol_provider: Some(OneOf::Left(true)),
                execute_command_provider: Some(ExecuteCommandOptions {
                    commands: vec!["dummy.do_something".to_string()],
                    work_done_progress_options: Default::default(),
                }),
                workspace: Some(WorkspaceServerCapabilities {
                    workspace_folders: Some(WorkspaceFoldersServerCapabilities {
                        supported: Some(true),
                        change_notifications: Some(OneOf::Left(true)),
                    }),
                    file_operations: None,
                }),
                ..ServerCapabilities::default()
            },
        })
    }

    async fn initialized(&self, params: InitializedParams) {
        backend_trace!(self, "initialized({:?})", params);
    }

    async fn shutdown(&self) -> Result<()> {
        backend_trace!(self, "shutdown()");
        Ok(())
    }

    async fn did_change_workspace_folders(&self, params: DidChangeWorkspaceFoldersParams) {
        backend_trace!(self, "did_change_workspace_folders({:?})", params);

        // TODO: Re-start indexer with new folders.
    }

    async fn did_change_configuration(&self, params: DidChangeConfigurationParams) {
        backend_trace!(self, "did_change_configuration({:?})", params);
    }

    async fn did_change_watched_files(&self, params: DidChangeWatchedFilesParams) {
        backend_trace!(self, "did_change_watched_files({:?})", params);

        // TODO: Re-index the changed files.
    }

    async fn symbol(&self, params: WorkspaceSymbolParams) -> Result<Option<Vec<SymbolInformation>>> {
        backend_trace!(self, "symbol({:?})", params);

        let response = unwrap!(symbols::symbols(self, &params), Err(error) => {
            error!("{:?}", error);
            return Ok(None);
        });

        Ok(Some(response))
    }

    async fn document_symbol(&self, params: DocumentSymbolParams) -> Result<Option<DocumentSymbolResponse>> {
        backend_trace!(self, "document_symbols({})", params.text_document.uri);

        let response = unwrap!(symbols::document_symbols(self, &params), Err(error) => {
            error!("{:?}", error);
            return Ok(None);
        });

        Ok(Some(DocumentSymbolResponse::Nested(response)))

    }

    async fn execute_command(&self, params: ExecuteCommandParams) -> Result<Option<Value>> {
        backend_trace!(self, "execute_command({:?})", params);

        match self.client.apply_edit(WorkspaceEdit::default()).await {
            Ok(res) if res.applied => self.client.log_message(MessageType::INFO, "applied").await,
            Ok(_) => self.client.log_message(MessageType::INFO, "rejected").await,
            Err(err) => self.client.log_message(MessageType::ERROR, err).await,
        }

        Ok(None)
    }

    async fn did_open(&self, params: DidOpenTextDocumentParams) {
        backend_trace!(self, "did_open({}", params.text_document.uri);

        self.documents.insert(
            params.text_document.uri,
            Document::new(params.text_document.text.as_str()),
        );
    }

    async fn did_change(&self, params: DidChangeTextDocumentParams) {
        backend_trace!(self, "did_change({:?})", params);

        // get reference to document
        let uri = &params.text_document.uri;
        let mut doc = unwrap!(self.documents.get_mut(uri), None => {
            backend_trace!(self, "did_change(): unexpected document uri '{}'", uri);
            return;
        });

        // update the document
        for change in params.content_changes.iter() {
            if let Err(error) = doc.update(change) {
                backend_trace!(self, "doc.update(): unexpected error {}", error);
            }
        }

        // update index
        if let Ok(path) = uri.to_file_path() {
            let path = Path::new(&path);
            if let Err(error) = indexer::update(&doc, &path) {
                error!("{:?}", error);
            }
        }
    }

    async fn did_save(&self, params: DidSaveTextDocumentParams) {
        backend_trace!(self, "did_save({:?}", params);
    }

    async fn did_close(&self, params: DidCloseTextDocumentParams) {
        backend_trace!(self, "did_close({:?}", params);
    }

    async fn completion(&self, params: CompletionParams) -> Result<Option<CompletionResponse>> {
        backend_trace!(self, "completion({:?})", params);

        // get reference to document
        let uri = &params.text_document_position.text_document.uri;
        let mut document = unwrap!(self.documents.get_mut(uri), None => {
            backend_trace!(self, "completion(): No document associated with URI {}", uri);
            return Ok(None);
        });

        // check whether we should be providing completions
        let ok = can_provide_completions(document.value_mut(), &params).unwrap_or_else(|err| {
            error!("{:?}", err);
            return false;
        });

        if !ok {
            return Ok(None);
        }

        // TODO: These probably shouldn't be separate methods, because we might get
        // the same completion from multiple sources, e.g.
        //
        // - A completion for a function 'foo' defined in the current document,
        // - A completion for a function 'foo' defined in the workspace,
        // - A variable called 'foo' defined in the current R session.
        //
        // Really, what's relevant is which of the above should be considered
        // 'visible' to the user.

        // build completion context
        let context = completion_context(document.value_mut(), &params.text_document_position);
        let context = unwrap!(context, Err(error) => {
            error!("{:?}", error);
            return Ok(None);
        });

        // start building completions
        let mut completions: Vec<CompletionItem> = vec![];

        // add session completions
        let result = r_lock! { append_session_completions(&context, &mut completions) };
        if let Err(error) = result {
            error!("{:?}", error);
        }

        // add context-relevant completions
        let result = append_document_completions(&context, &mut completions);
        if let Err(error) = result {
            error!("{:?}", error);
        }

        // add workspace completions
        let result = append_workspace_completions(&self, &context, &mut completions);
        if let Err(error) = result {
            error!("{:?}", error);
        }

        // remove duplicates
        let mut uniques = HashSet::new();
        completions.retain(|x| uniques.insert(x.label.clone()));

        // sort completions by providing custom 'sort' text to be used when
        // ordering completion results. we use some placeholders at the front
        // to 'bin' different completion types differently; e.g. we place parameter
        // completions at the front, and completions starting with non-word
        // characters at the end (e.g. completions starting with `.`)
        let pattern = Regex::new(r"^\w").unwrap();
        for item in &mut completions {
            if item.kind == Some(CompletionItemKind::FIELD) {
                item.sort_text = Some(join!["1", item.label]);
            } else if pattern.is_match(&item.label) {
                item.sort_text = Some(join!["2", item.label]);
            } else {
                item.sort_text = Some(join!["3", item.label]);
            }
        }

        if !completions.is_empty() {
            Ok(Some(CompletionResponse::Array(completions)))
        } else {
            Ok(None)
        }
    }

    // TODO: Use completion_resolve() to provide extra information about a completion.
    // TODO: Tag completion items with a 'data' entry so we can look up information about
    // them more easily.
    async fn completion_resolve(&self, mut item: CompletionItem) -> Result<CompletionItem> {
        backend_trace!(self, "completion_resolve({:?})", item);

        let data = item.data.clone();
        let data = unwrap!(data, None => {
            warn!("Completion '{}' has no associated data", item.label);
            return Ok(item);
        });

        let data : CompletionData = unwrap!(serde_json::from_value(data), Err(error) => {
            error!("{:?}", error);
            return Ok(item);
        });

        unsafe {
            unwrap!(resolve_completion_item(&mut item, &data), Err(error) => {
                error!("{:?}", error);
                return Ok(item);
            });
        }

        Ok(item)

    }

    async fn hover(&self, params: HoverParams) -> Result<Option<Hover>> {
        backend_trace!(self, "hover({:?})", params);

        // get document reference
        let uri = &params.text_document_position_params.text_document.uri;
        let document = unwrap!(self.documents.get_mut(uri), None => {
            backend_trace!(self, "hover(): No document associated with URI {}", uri);
            return Ok(None);
        });

        // build completion context
        let context = completion_context(&document, &params.text_document_position_params);
        let context = unwrap!(context, Err(error) => {
            error!("{:?}", error);
            return Ok(None);
        });

        // request hover information
        let result = unsafe { hover(&document, &context) };

        // unwrap errors
        let result = unwrap!(result, Err(error) => {
            error!("{:?}", error);
            return Ok(None);
        });

        // unwrap empty options
        let result = unwrap!(result, None => {
            return Ok(None);
        });

        // we got a result; use it
        Ok(Some(Hover {
            contents: HoverContents::Markup(result),
            range: None,
        }))
    }

    async fn goto_definition(&self, params: GotoDefinitionParams) -> Result<Option<GotoDefinitionResponse>> {
        backend_trace!(self, "goto_definition({:?})", params);

        // get reference to document
        let uri = &params.text_document_position_params.text_document.uri;
        let document = unwrap!(self.documents.get(uri), None => {
            backend_trace!(self, "completion(): No document associated with URI {}", uri);
            return Ok(None);
        });

        // build goto definition context
        let context = unwrap!(goto_definition_context(&document, params), Err(error) => {
            error!("{}", error);
            return Ok(None);
        });

        // TODO: Move the rest of this into a separate function,
        // living in the 'definitions' module.

        // search for a reference in the document index
        if matches!(context.node.kind(), "identifier") {
            let source = context.document.contents.to_string();
            let symbol = context.node.utf8_text(source.as_bytes()).unwrap();
            if let Some((path, entry)) = indexer::find(symbol) {
                let link = LocationLink {
                    origin_selection_range: None,
                    target_uri: Url::from_file_path(path).unwrap(),
                    target_range: entry.range,
                    target_selection_range: entry.range,
                };
                let response = GotoDefinitionResponse::Link(vec![link]);
                return Ok(Some(response));
            }
        }

        // TODO: We should see if we can find the referenced item in:
        //
        // 1. The document's current AST,
        // 2. The public functions from other documents in the project,
        // 3. A definition in the R session (which we could open in a virtual document)
        //
        // If we can't find a definition, then we can return the referenced item itself,
        // which will tell Positron to instead try to look for references for that symbol.
        let link = LocationLink {
            origin_selection_range: Some(context.range),
            target_uri: context.params.text_document_position_params.text_document.uri,
            target_range: context.range,
            target_selection_range: context.range,
        };

        let response = GotoDefinitionResponse::Link(vec![link]);
        Ok(Some(response))
    }

    async fn goto_implementation(&self, params: GotoImplementationParams) -> Result<Option<GotoImplementationResponse>> {
        backend_trace!(self, "goto_implementation({:?})", params);
        let _ = params;
        error!("Got a textDocument/implementation request, but it is not implemented");
        return Ok(None);
    }

    async fn references(&self, params: ReferenceParams) -> Result<Option<Vec<Location>>> {
        backend_trace!(self, "references({:?})", params);

        let locations = match self.find_references(params) {
            Ok(locations) => locations,
            Err(_error) => {
                return Ok(None);
            }
        };

        if locations.is_empty() {
            Ok(None)
        } else {
            Ok(Some(locations))
        }
    }
}

#[tokio::main]
pub async fn start_lsp(address: String, channel: SyncSender<Request>) {
    #[cfg(feature = "runtime-agnostic")]
    use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

    /*
    NOTE: The example LSP from tower-lsp uses a TcpListener, but we're using a
    TcpStream because -- according to LSP docs -- the client and server roles
    are reversed in terms of opening ports: the client listens, and the server
    opens a connection to it. The client and server can't BOTH listen on the port,
    so we let the client do it and connect to it here.

    let listener = TcpListener::bind(format!("127.0.0.1:{}", port))
        .await
        .unwrap();
    let (stream, _) = listener.accept().await.unwrap();
    */
    debug!("Connecting to LSP client at '{}'", address);
    let stream = TcpStream::connect(address).await.unwrap();
    let (read, write) = tokio::io::split(stream);
    #[cfg(feature = "runtime-agnostic")]
    let (read, write) = (read.compat(), write.compat_write());

    let (service, socket) = LspService::new(|client| Backend {
        client: client,
        documents: DashMap::new(),
        workspace: Arc::new(Mutex::new(Workspace::default())),
        channel: channel,
    });

    Server::new(read, write, socket).serve(service).await;
}
