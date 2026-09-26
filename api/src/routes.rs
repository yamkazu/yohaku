use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};

use crate::error::{AppError, AppResult};
use crate::models::{Article, HealthResponse};
use crate::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/articles", get(list_articles))
        .route("/articles/{slug}", get(get_article))
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "yohaku-api",
        store: "dynamodb",
    })
}

async fn list_articles(State(state): State<AppState>) -> AppResult<Json<Vec<Article>>> {
    Ok(Json(state.store.list_articles().await?))
}

async fn get_article(
    State(state): State<AppState>,
    Path(slug): Path<String>,
) -> AppResult<Json<Article>> {
    let article = state
        .store
        .get_article_by_slug(&slug)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(article))
}
