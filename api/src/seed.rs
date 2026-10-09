use chrono::{TimeZone, Utc};

use crate::error::AppResult;
use crate::models::{Article, AuthorSummary};
use crate::store::DynamoStore;

pub const CANARY_SLUG: &str = "deploy-smoke-canary";

pub async fn seed_if_empty(store: &DynamoStore) -> AppResult<()> {
    if store.article_count().await? == 0 {
        tracing::info!("seeding sample articles");
        for article in sample_articles() {
            store.put_article(&article).await?;
        }
    }
    store.put_article(&canary_article()).await?;
    Ok(())
}

pub fn canary_article() -> Article {
    Article {
        id: "deploy-smoke-canary".into(),
        slug: CANARY_SLUG.into(),
        title: "Deploy smoke canary".into(),
        excerpt: "Synthetic article for post-deploy smoke. Not for readers.".into(),
        body: "Synthetic article for post-deploy smoke. Not for readers.".into(),
        published_at: dt(2026, 1, 1),
        reading_minutes: 1,
        likes: 0,
        comments: 0,
        tags: vec![],
        author: AuthorSummary {
            id: "canary".into(),
            name: "Deploy smoke".into(),
            username: "deploy-smoke".into(),
            avatar: "DS".into(),
        },
    }
}

fn dt(y: i32, m: u32, d: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(y, m, d, 9, 0, 0).unwrap()
}

pub fn sample_articles() -> Vec<Article> {
    let aoi = AuthorSummary {
        id: "a1".into(),
        name: "森下 葵".into(),
        username: "aoi_mori".into(),
        avatar: "AM".into(),
    };
    let kenta = AuthorSummary {
        id: "a2".into(),
        name: "Kenta Sato".into(),
        username: "ksato".into(),
        avatar: "KS".into(),
    };
    let yuki = AuthorSummary {
        id: "a4".into(),
        name: "Yuki Tanaka".into(),
        username: "yuki_dev".into(),
        avatar: "YT".into(),
    };

    vec![
        Article {
            id: "1".into(),
            slug: "whitespace-as-product-design".into(),
            title: "余白は機能である——読みやすさを設計するフロントエンド".into(),
            excerpt: "情報量を増やすほど、読む力は落ちる。タイポ・行間・余白を機能として扱う。".into(),
            body: "技術ブログは、しばしば「どれだけ詰め込めるか」で勝負しがちだ。しかし読者の視線は、見出しの近くにある余白で息をつく。\n\n余白は空白ではなく、視線の導線だ。段落のあいだに十分なスペースがあると、主張と根拠の境界がはっきりする。\n\n## 実装のコツ\n\n- 行間は本文で 1.75〜1.9\n- 見出し前は見出し後より広く取る\n- モバイルでは横余白を削りすぎない\n\n速いページも大事だが、読まれるページはもっと大事だ。".into(),
            published_at: dt(2026, 9, 24),
            reading_minutes: 6,
            likes: 428,
            comments: 36,
            tags: vec!["frontend".into(), "design".into()],
            author: aoi.clone(),
        },
        Article {
            id: "2".into(),
            slug: "typescript-narrowing-habits".into(),
            title: "TypeScript の絞り込みを「習慣」にする".into(),
            excerpt: "型エラーを消すのではなく、意図を残す。日常の narrowing パターン。".into(),
            body: "TypeScript の難しさは、文法より「いつ絞り込むか」にある。\n\n関数の冒頭で不正な状態を弾くと、以降のコードは素直になる。判別可能なユニオンを持つと、分岐が型安全になる。".into(),
            published_at: dt(2026, 9, 22),
            reading_minutes: 8,
            likes: 312,
            comments: 24,
            tags: vec!["typescript".into()],
            author: kenta.clone(),
        },
        Article {
            id: "3".into(),
            slug: "quiet-apis".into(),
            title: "静かな API——エラー面を先に描く".into(),
            excerpt: "成功パスより失敗パスの方が、プロダクトの品格を決める。".into(),
            body: "良い API は、失敗したときほど上品だ。\n\n`400` と `422` を雑に混ぜないと、クライアントは迷わない。破壊的変更は、余白をもって告知する。".into(),
            published_at: dt(2026, 9, 18),
            reading_minutes: 7,
            likes: 541,
            comments: 41,
            tags: vec!["backend".into(), "api".into()],
            author: yuki,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn canary_is_separate_from_sample_articles() {
        // Arrange
        let canary = canary_article();
        let samples = sample_articles();

        // Act
        let sample_ids: HashSet<_> = samples.iter().map(|a| a.id.as_str()).collect();
        let sample_slugs: HashSet<_> = samples.iter().map(|a| a.slug.as_str()).collect();

        // Assert
        assert_eq!(canary.slug, CANARY_SLUG);
        assert!(!sample_ids.contains(canary.id.as_str()));
        assert!(!sample_slugs.contains(canary.slug.as_str()));
        assert!(!canary.title.is_empty());
    }

    #[test]
    fn sample_articles_have_unique_slugs() {
        // Arrange
        let articles = sample_articles();

        // Act
        let slugs: Vec<_> = articles.iter().map(|a| a.slug.as_str()).collect();
        let unique: HashSet<_> = slugs.iter().copied().collect();

        // Assert
        assert_eq!(
            slugs.len(),
            unique.len(),
            "duplicate slugs in seed: {slugs:?}"
        );
    }

    #[test]
    fn sample_articles_have_required_text_fields() {
        // Arrange
        let articles = sample_articles();

        // Act / Assert
        for article in &articles {
            assert!(!article.id.is_empty(), "empty id");
            assert!(!article.slug.is_empty(), "empty slug");
            assert!(
                !article.title.is_empty(),
                "empty title for {}",
                article.slug
            );
            assert!(
                !article.excerpt.is_empty(),
                "empty excerpt for {}",
                article.slug
            );
            assert!(!article.body.is_empty(), "empty body for {}", article.slug);
        }
    }
}
