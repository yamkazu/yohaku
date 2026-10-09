//! 余白 API library — Axum + DynamoDB (Lambda Web Adapter compatible)
//! Slice 1: health + article list + article detail

use std::sync::Arc;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

pub mod error;
pub mod models;
pub mod routes;
pub mod seed;
pub mod store;

use store::DynamoStore;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<DynamoStore>,
}

/// Build the HTTP router with CORS and tracing layers.
pub fn app(state: AppState) -> Router {
    Router::new()
        .merge(routes::router())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Connect to DynamoDB, ensure schema, seed sample articles when the table is empty, and upsert the smoke canary.
pub async fn build_state() -> anyhow::Result<AppState> {
    let store = DynamoStore::connect().await?;
    store.ensure_schema().await?;
    seed::seed_if_empty(&store).await?;
    Ok(AppState {
        store: Arc::new(store),
    })
}
