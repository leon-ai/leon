import { memo } from 'react'
import { FileIcon, Icon } from '@/components/icon'
import { Tooltip } from '@/components/tooltip'

// Fence names are not filenames; Pierre owns file-type matching beyond this adapter.
const LANGUAGES: Record<string, { fileName: string, label: string }> = {
  javascript: { fileName: 'code.js', label: 'JavaScript' },
  typescript: { fileName: 'code.ts', label: 'TypeScript' },
  python: { fileName: 'code.py', label: 'Python' },
  json: { fileName: 'code.json', label: 'JSON' },
  html: { fileName: 'code.html', label: 'HTML' },
  css: { fileName: 'code.css', label: 'CSS' },
  bash: { fileName: 'code.sh', label: 'Shell' },
  jsx: { fileName: 'code.jsx', label: 'JSX' },
  tsx: { fileName: 'code.tsx', label: 'TSX' },
  cpp: { fileName: 'code.cpp', label: 'C++' },
  ruby: { fileName: 'code.rb', label: 'Ruby' },
  rust: { fileName: 'code.rs', label: 'Rust' },
  markdown: { fileName: 'code.md', label: 'Markdown' },
  yaml: { fileName: 'code.yml', label: 'YAML' },
  dockerfile: { fileName: 'Dockerfile', label: 'Dockerfile' }
}
const ALIASES: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', shellscript: 'bash', zsh: 'bash', html5: 'html', yml: 'yaml', md: 'markdown', rb: 'ruby', rs: 'rust', 'c++': 'cpp', docker: 'dockerfile' }

/**
 * Adapts Markdown fence names to the shared, lazily loaded file-icon registry.
 */
export const LanguageIcon = memo(function LanguageIcon({ language }: { language: string }) {
  const normalized = language.toLowerCase()
  const key = Object.hasOwn(ALIASES, normalized) ? ALIASES[normalized]! : normalized
  const known = Object.hasOwn(LANGUAGES, key) ? LANGUAGES[key] : undefined
  const label = key === 'mermaid' ? 'Mermaid' : known?.label ?? language

  return <Tooltip message={label} position="top" blurOnClick={false}>
    <span className="markdown-language-icon" tabIndex={0}>
      {key === 'mermaid' ? <Icon name="node-tree" ariaLabel="Mermaid" /> :
        <FileIcon fileName={known?.fileName ?? `code.${key}`} ariaLabel={label} fallbackLabel={label} />}
    </span>
  </Tooltip>
})
