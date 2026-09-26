import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchArticle, formatDate, type Article } from '../lib/api'

export function ArticlePage() {
  const { slug = '' } = useParams()
  const [article, setArticle] = useState<Article | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setArticle(null)
    setError(null)
    fetchArticle(slug)
      .then((data) => {
        if (!cancelled) setArticle(data)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16 sm:px-6">
        <p className="text-sm text-red-700">記事が見つかりませんでした。</p>
        <Link to="/" className="mt-6 inline-block text-sm text-accent hover:underline">
          ← フィードに戻る
        </Link>
      </main>
    )
  }

  if (!article) {
    return (
      <main className="mx-auto max-w-2xl px-5 py-16 sm:px-6">
        <div className="h-10 w-2/3 animate-pulse rounded bg-line/70" />
        <div className="mt-8 space-y-3">
          <div className="h-4 animate-pulse rounded bg-line/60" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-line/60" />
          <div className="h-4 w-4/6 animate-pulse rounded bg-line/60" />
        </div>
      </main>
    )
  }

  const paragraphs = article.body.split(/\n\n+/)

  return (
    <main className="mx-auto w-full max-w-2xl px-5 pb-24 pt-8 sm:px-6 sm:pt-12">
      <Link
        to="/"
        className="animate-soft inline-flex text-sm text-muted transition-colors hover:text-accent"
      >
        ← フィード
      </Link>

      <header className="animate-rise mt-8">
        <div
          className={`mb-8 h-40 w-full rounded-sm bg-gradient-to-br sm:h-48 ${article.cover_tone}`}
          aria-hidden
        />
        <h1 className="font-serif text-[1.75rem] leading-snug font-semibold tracking-tight text-ink sm:text-4xl">
          {article.title}
        </h1>
        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-muted">
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
            {article.author.avatar}
          </span>
          <span className="text-ink">{article.author.name}</span>
          <time dateTime={article.published_at}>{formatDate(article.published_at)}</time>
          <span>{article.reading_minutes}分で読める</span>
          <span>スキ {article.likes}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-accent">
          {article.tags.map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      </header>

      <div className="animate-rise mt-10 space-y-5 text-[1.05rem] leading-[1.9] text-ink/90" style={{ animationDelay: '80ms' }}>
        {paragraphs.map((block, i) => {
          if (block.startsWith('## ')) {
            return (
              <h2 key={i} className="font-serif pt-4 text-xl font-semibold tracking-tight text-ink">
                {block.replace(/^##\s+/, '')}
              </h2>
            )
          }
          if (block.startsWith('- ')) {
            return (
              <ul key={i} className="list-disc space-y-1 pl-5 text-ink/85">
                {block.split('\n').map((line, j) => (
                  <li key={j}>{line.replace(/^-\s+/, '')}</li>
                ))}
              </ul>
            )
          }
          return <p key={i}>{block}</p>
        })}
      </div>
    </main>
  )
}
