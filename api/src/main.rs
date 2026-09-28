//! 余白 API — Axum + DynamoDB (Lambda Web Adapter compatible)
//! Slice 1: health + article list + article detail

use std::net::SocketAddr;
use std::sync::Arc;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

mod error;
mod models;
mod routes;
mod seed;
mod store;

use store::DynamoStore;

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<DynamoStore>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with_target(false)
        .compact()
        .init();

    let store = DynamoStore::connect().await?;
    store.ensure_schema().await?;
    seed::seed_if_empty(&store).await?;

    let state = AppState {
        store: Arc::new(store),
    };

    let app = Router::new()
        .merge(routes::router())
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Lambda Web Adapter sets PORT (default 8080). Local default: 3848.
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3848);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!(%addr, "yohaku-api listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
