import { useIsCodeFenceIncomplete } from 'streamdown'
import { CodeView } from '@/components/code-view'
import { CopyButton } from '@/components/copy-button'

/**
 * Reuses bounded syntax rendering and source copying for fenced code.
 */
export default function MarkdownCode({ text, language }: { text: string, language: string }) {
  const incomplete = useIsCodeFenceIncomplete()
  return <div className="markdown-code">
    <div className="markdown-code-header"><span>{language}</span><CopyButton text={text} label="Copy code" size="sm" /></div>
    <CodeView text={text} language={language} label="Code block" active={incomplete} />
  </div>
}
