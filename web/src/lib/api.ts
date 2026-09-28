export type AuthorSummary = {
  id: string
  name: string
  username: string
  avatar: string
}

export type Article = {
  id: string
  slug: string
  title: string
  excerpt: string
  body: string
  cover_tone: string
  published_at: string
  reading_minutes: number
  likes: number
  comments: number
  tags: string[]
  author: AuthorSummary
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3848'

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function fetchArticles() {
  return request<Article[]>('/articles')
}

export function fetchArticle(slug: string) {
  return request<Article>(`/articles/${encodeURIComponent(slug)}`)
}

export function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}
