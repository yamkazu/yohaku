import { Link } from 'react-router-dom'
import type { Article } from '../lib/api'
import { formatDate } from '../lib/api'

export function ArticleRow({ article, index }: { article: Article; index: number }) {
  return (
    <article
      className="animate-rise border-b border-line py-8 last:border-b-0"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <Link to={`/articles/${article.slug}`} className="group grid gap-5 sm:grid-cols-[1fr_140px] sm:items-center">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2 text-xs text-muted">
            <span className="inline-flex size-6 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">
              {article.author.avatar}
            </span>
            <span>{article.author.name}</span>
            <span aria-hidden>·</span>
            <time dateTime={article.published_at}>{formatDate(article.published_at)}</time>
          </div>
          <h2 className="font-serif text-[1.35rem] leading-snug font-semibold tracking-tight text-ink transition-colors group-hover:text-accent sm:text-2xl">
            {article.title}
          </h2>
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted sm:text-[0.95rem]">
            {article.excerpt}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>{article.reading_minutes}分</span>
            <span>スキ {article.likes}</span>
            {article.tags.map((tag) => (
              <span key={tag} className="text-accent/80">
                #{tag}
              </span>
            ))}
          </div>
        </div>
        <div className="article-cover h-28 overflow-hidden rounded-sm sm:h-24" aria-hidden />
      </Link>
    </article>
  )
}
