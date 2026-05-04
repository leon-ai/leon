import { notFound } from 'next/navigation'

import { getLLMText } from '@/lib/get-llm-text'
import { source } from '@/lib/source'

interface RouteProps {
  params: Promise<{
    slug?: string[]
  }>
}

export const revalidate = false

export async function GET(
  _request: Request,
  { params }: RouteProps
): Promise<Response> {
  const { slug = [] } = await params
  const page = source.getPage(slug)

  if (!page) {
    notFound()
  }

  return new Response(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8'
    }
  })
}

export function generateStaticParams(): Array<{ slug?: string[] }> {
  return source.generateParams()
}
