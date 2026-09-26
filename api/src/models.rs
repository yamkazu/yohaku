use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorSummary {
    pub id: String,
    pub name: String,
    pub username: String,
    pub avatar: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Article {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub excerpt: String,
    pub body: String,
    pub cover_tone: String,
    pub published_at: DateTime<Utc>,
    pub reading_minutes: u32,
    pub likes: u64,
    pub comments: u64,
    pub tags: Vec<String>,
    pub author: AuthorSummary,
}

#[derive(Debug, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub service: &'static str,
    pub store: &'static str,
}
