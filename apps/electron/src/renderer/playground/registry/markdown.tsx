import * as React from 'react'
import type { ComponentEntry } from './types'
import { Markdown, CollapsibleMarkdownProvider, CodeBlock, InlineCode, MarkdownDatatableBlock, MarkdownSpreadsheetBlock, MarkdownImageBlock, MarkdownHtmlBlock, MarkdownDocBlock, ImageCardStack, PlatformProvider } from '@craft-agent/ui'

const sampleMarkdown = `# Welcome to Markdown

This is a **bold** statement and this is *italic*.

## Code Examples

Here's some inline code: \`const x = 42\`

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`
}

// Call the function
console.log(greet("World"))
\`\`\`

## Lists

- First item
- Second item
  - Nested item
- Third item

1. Numbered one
2. Numbered two
3. Numbered three

## Table

| Name | Role | Status |
|------|------|--------|
| Alice | Developer | Active |
| Bob | Designer | Away |

## Blockquote

> This is a blockquote with some important information
> that spans multiple lines.

---

That's all folks!`

const codeHeavyMarkdown = `# API Response

The endpoint returned:

\`\`\`json
{
  "status": "success",
  "data": {
    "users": [
      { "id": 1, "name": "Alice" },
      { "id": 2, "name": "Bob" }
    ]
  }
}
\`\`\`

Process with:

\`\`\`python
import json

def process_response(data: dict) -> list:
    return [user["name"] for user in data["users"]]
\`\`\`

Or in TypeScript:

\`\`\`typescript
interface User {
  id: number
  name: string
}

const getNames = (users: User[]): string[] =>
  users.map(u => u.name)
\`\`\``

const typescriptCode = `import { useState, useEffect } from 'react'

interface Todo {
  id: number
  title: string
  completed: boolean
}

export function useTodos() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/todos')
      .then(res => res.json())
      .then(data => {
        setTodos(data)
        setLoading(false)
      })
  }, [])

  return { todos, loading }
}`

const pythonCode = `from dataclasses import dataclass
from typing import Optional

@dataclass
class User:
    id: int
    name: str
    email: Optional[str] = None

def get_user_by_id(user_id: int) -> Optional[User]:
    """Fetch user from database."""
    # Simulated database lookup
    users = {
        1: User(1, "Alice", "alice@example.com"),
        2: User(2, "Bob"),
    }
    return users.get(user_id)`

const jsonCode = `{
  "name": "craft-agent",
  "version": "1.0.0",
  "dependencies": {
    "react": "^18.2.0",
    "typescript": "^5.0.0"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  }
}`

const richBlockParityMarkdown = `# Rich Block Interaction Parity

Use this fixture to compare **inline** and **fullscreen** interactions for Mermaid and image blocks.

- Tap/click inline content to open fullscreen
- In fullscreen: wheel/pinch zoom, drag pan, double-click reset
- Keyboard: Cmd/Ctrl +, -, 0

## Mermaid block

\`\`\`mermaid
graph LR
    A[Input] --> B{Validate}
    B -->|Valid| C[Persist]
    B -->|Invalid| D[Show Error]
    C --> E[Notify]
\`\`\`

## Image block

\`\`\`image-preview
{
  "title": "Parity Check",
  "items": [
    { "src": "/mock/images/gallery-1.png", "label": "Lake" },
    { "src": "/mock/images/gallery-2.png", "label": "Forest" }
  ]
}
\`\`\`
`

// Wrapper for collapsible markdown
function CollapsibleWrapper({ children }: { children: React.ReactNode }) {
  return <CollapsibleMarkdownProvider>{children}</CollapsibleMarkdownProvider>
}

const MOCK_IMAGE_DATA: Record<string, string> = {
  '/mock/images/gallery-1.png': 'https://picsum.photos/id/1015/1200/900',
  '/mock/images/gallery-2.png': 'https://picsum.photos/id/1025/900/1200',
  '/mock/images/gallery-3.png': 'https://picsum.photos/id/1035/1400/900',
  '/mock/images/gallery-4.png': 'https://picsum.photos/id/1043/1200/900',
  '/mock/images/gallery-5.png': 'https://picsum.photos/id/1067/1200/900',
}

const MOCK_HTML_DATA: Record<string, string> = {
  '/mock/html/report.html': `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        color: #17202a;
        background: #f8fafc;
      }
      main {
        padding: 28px;
      }
      .hero {
        border: 1px solid #dbe3ea;
        border-radius: 14px;
        padding: 22px;
        background: #ffffff;
        box-shadow: 0 16px 42px rgba(15, 23, 42, 0.08);
      }
      h1 {
        margin: 0 0 10px;
        font-size: 26px;
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: #536171;
        line-height: 1.55;
      }
      .metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin-top: 18px;
      }
      .metric {
        border-radius: 12px;
        border: 1px solid #e2e8f0;
        padding: 14px;
        background: #fbfdff;
      }
      .label {
        color: #64748b;
        font-size: 12px;
      }
      .value {
        margin-top: 6px;
        font-size: 24px;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>HTML Preview Report</h1>
        <p>This mock document is loaded through MarkdownHtmlBlock, so the header actions can be checked in isolation.</p>
        <div class="metrics">
          <div class="metric"><div class="label">Open Panel</div><div class="value">Ready</div></div>
          <div class="metric"><div class="label">Fullscreen</div><div class="value">Ready</div></div>
          <div class="metric"><div class="label">Live Browser</div><div class="value">Mock</div></div>
        </div>
      </section>
    </main>
  </body>
</html>`,
  '/mock/html/email.html': `<!doctype html>
<html>
  <body style="margin:0;background:#eef2f7;font-family:Arial,sans-serif;color:#1f2937">
    <table role="presentation" style="width:100%;padding:24px">
      <tr>
        <td>
          <table role="presentation" style="max-width:560px;margin:auto;background:white;border:1px solid #dbe4ef;border-radius:12px;overflow:hidden">
            <tr>
              <td style="padding:22px;background:#0f766e;color:white">
                <h1 style="margin:0;font-size:22px">Product Update</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:22px;line-height:1.55">
                <p style="margin-top:0">This email-shaped fixture checks compact HTML layouts inside the preview iframe.</p>
                <a href="https://example.com" style="display:inline-block;margin-top:10px;color:#0f766e;font-weight:bold">Read more</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
}

const MOCK_MARKDOWN_DATA: Record<string, string> = {
  '/mock/markdown/spec.md': `# Markdown Preview Spec

This mock document is loaded through \`MarkdownDocBlock\`.

## Acceptance

- Open panel action is visible
- Fullscreen action is visible
- Nested markdown renders through the shared renderer

| Area | Status |
| --- | --- |
| Inline preview | Ready |
| Panel handoff | Mocked |

\`\`\`typescript
export const preview = 'markdown-preview'
\`\`\`
`,
  '/mock/markdown/notes.md': `# Release Notes Draft

## Added

- Playground coverage for \`markdown-preview\`
- A tabbed fixture for multi-document preview checks

> This is intentionally short so narrow preview sizes stay readable.
`,
}

function MarkdownImageBlockWrapper({ children }: { children: React.ReactNode }) {
  return (
    <PlatformProvider
      actions={{
        onReadFileDataUrl: async (path: string) => {
          await new Promise((resolve) => setTimeout(resolve, 120))
          const dataUrl = MOCK_IMAGE_DATA[path]
          if (!dataUrl) {
            throw new Error(`Mock image not found for: ${path}`)
          }
          return dataUrl
        },
      }}
    >
      {children}
    </PlatformProvider>
  )
}

function MarkdownHtmlBlockWrapper({ children }: { children: React.ReactNode }) {
  return (
    <PlatformProvider
      actions={{
        onReadFile: async (path: string) => {
          await new Promise((resolve) => setTimeout(resolve, 120))
          const html = MOCK_HTML_DATA[path]
          if (!html) {
            throw new Error(`Mock HTML not found for: ${path}`)
          }
          return html
        },
        onOpenInAppBrowser: (target) => {
          console.log('[Playground] Open Live Browser:', target)
        },
      }}
    >
      {children}
    </PlatformProvider>
  )
}

function MarkdownDocBlockWrapper({ children }: { children: React.ReactNode }) {
  return (
    <PlatformProvider
      actions={{
        onReadFile: async (path: string) => {
          await new Promise((resolve) => setTimeout(resolve, 120))
          const markdown = MOCK_MARKDOWN_DATA[path]
          if (!markdown) {
            throw new Error(`Mock markdown not found for: ${path}`)
          }
          return markdown
        },
      }}
    >
      {children}
    </PlatformProvider>
  )
}

function ImageCardStackPlayground({
  items,
  maxRotate,
}: {
  items: Array<{ src: string; label?: string; ratio?: number }> | string
  maxRotate: number
}) {
  const parsedItems = React.useMemo(() => {
    if (Array.isArray(items)) return items
    if (typeof items === 'string') {
      try {
        const parsed = JSON.parse(items)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    return []
  }, [items])

  const [currentIndex, setCurrentIndex] = React.useState(0)

  React.useEffect(() => {
    setCurrentIndex(0)
  }, [parsedItems])

  return (
    <div className="h-full w-full p-4 flex flex-col gap-3">
      <div className="text-xs text-muted-foreground flex items-center justify-between">
        <span>Active card: {Math.min(currentIndex + 1, Math.max(parsedItems.length, 1))} / {parsedItems.length}</span>
        <span>Swipe left/right on top card</span>
      </div>
      <div className="flex-1 min-h-0 rounded-md border border-border/60 bg-muted/20 p-4 flex items-center justify-center">
        {parsedItems.length > 0 ? (
          <div className="h-[320px] w-full">
            <ImageCardStack items={parsedItems} currentIndex={currentIndex} onIndexChange={setCurrentIndex} maxRotate={maxRotate} maxHeight={320} />
          </div>
        ) : (
          <div className="h-full w-full flex items-center justify-center text-sm text-muted-foreground">
            Invalid or empty items JSON
          </div>
        )}
      </div>
    </div>
  )
}

export const markdownComponents: ComponentEntry[] = [
  {
    id: 'markdown',
    name: 'Markdown',
    category: 'Markdown',
    description: 'Customizable markdown renderer with three render modes: terminal, minimal, full',
    component: Markdown,
    layout: 'top',
    props: [
      {
        name: 'children',
        description: 'Markdown content to render',
        control: { type: 'textarea', rows: 10 },
        defaultValue: sampleMarkdown,
      },
      {
        name: 'mode',
        description: 'Render mode controlling formatting level',
        control: {
          type: 'select',
          options: [
            { label: 'Terminal', value: 'terminal' },
            { label: 'Minimal', value: 'minimal' },
            { label: 'Full', value: 'full' },
          ],
        },
        defaultValue: 'minimal',
      },
      {
        name: 'collapsible',
        description: 'Enable collapsible headings',
        control: { type: 'boolean' },
        defaultValue: false,
      },
    ],
    variants: [
      { name: 'Terminal', props: { children: sampleMarkdown, mode: 'terminal' } },
      { name: 'Minimal', props: { children: sampleMarkdown, mode: 'minimal' } },
      { name: 'Full', props: { children: sampleMarkdown, mode: 'full' } },
      { name: 'Code Heavy', props: { children: codeHeavyMarkdown, mode: 'minimal' } },
      { name: 'Collapsible', props: { children: sampleMarkdown, mode: 'full', collapsible: true } },
    ],
    mockData: () => ({
      onUrlClick: (url: string) => console.log('[Playground] URL clicked:', url),
      onFileClick: (path: string) => console.log('[Playground] File clicked:', path),
    }),
    wrapper: CollapsibleWrapper,
  },
  {
    id: 'code-block',
    name: 'CodeBlock',
    category: 'Markdown',
    description: 'Syntax highlighted code block using Shiki with copy button',
    component: CodeBlock,
    props: [
      {
        name: 'code',
        description: 'Code to display',
        control: { type: 'textarea', rows: 8 },
        defaultValue: typescriptCode,
      },
      {
        name: 'language',
        description: 'Programming language for syntax highlighting',
        control: {
          type: 'select',
          options: [
            { label: 'TypeScript', value: 'typescript' },
            { label: 'JavaScript', value: 'javascript' },
            { label: 'Python', value: 'python' },
            { label: 'JSON', value: 'json' },
            { label: 'Bash', value: 'bash' },
            { label: 'Plain Text', value: 'text' },
          ],
        },
        defaultValue: 'typescript',
      },
      {
        name: 'mode',
        description: 'Render mode',
        control: {
          type: 'select',
          options: [
            { label: 'Terminal', value: 'terminal' },
            { label: 'Minimal', value: 'minimal' },
            { label: 'Full', value: 'full' },
          ],
        },
        defaultValue: 'full',
      },
    ],
    variants: [
      { name: 'TypeScript Full', props: { code: typescriptCode, language: 'typescript', mode: 'full' } },
      { name: 'TypeScript Minimal', props: { code: typescriptCode, language: 'typescript', mode: 'minimal' } },
      { name: 'Python', props: { code: pythonCode, language: 'python', mode: 'full' } },
      { name: 'JSON', props: { code: jsonCode, language: 'json', mode: 'full' } },
    ],
  },
  {
    id: 'inline-code',
    name: 'InlineCode',
    category: 'Markdown',
    description: 'Styled inline code span with subtle background and border',
    component: InlineCode,
    props: [
      {
        name: 'children',
        description: 'Code text',
        control: { type: 'string' },
        defaultValue: 'const x = 42',
      },
    ],
    variants: [
      { name: 'Variable', props: { children: 'useState' } },
      { name: 'Function', props: { children: 'handleClick()' } },
      { name: 'Type', props: { children: 'React.FC<Props>' } },
      { name: 'Path', props: { children: 'src/components/App.tsx' } },
    ],
  },
  {
    id: 'datatable-block',
    name: 'MarkdownDatatableBlock',
    category: 'Markdown',
    description: 'Interactive data table with sorting for ```datatable code blocks',
    component: MarkdownDatatableBlock,
    props: [
      {
        name: 'code',
        description: 'JSON string with columns and rows',
        control: { type: 'textarea', rows: 12 },
        defaultValue: JSON.stringify({
          title: 'Sales by Region',
          columns: [
            { key: 'region', label: 'Region', type: 'text' },
            { key: 'revenue', label: 'Revenue', type: 'currency' },
            { key: 'growth', label: 'Growth', type: 'percent' },
            { key: 'units', label: 'Units Sold', type: 'number' },
            { key: 'status', label: 'Status', type: 'badge' },
          ],
          rows: [
            { region: 'North America', revenue: 1250000, growth: 0.124, units: 8420, status: 'Active' },
            { region: 'Europe', revenue: 980000, growth: 0.087, units: 6230, status: 'Active' },
            { region: 'Asia Pacific', revenue: 1580000, growth: 0.215, units: 12100, status: 'Active' },
            { region: 'Latin America', revenue: 420000, growth: -0.032, units: 2800, status: 'Revoked' },
            { region: 'Middle East', revenue: 310000, growth: 0.156, units: 1900, status: 'Active' },
          ],
        }, null, 2),
      },
    ],
    variants: [
      {
        name: 'Sales Data',
        props: {
          code: JSON.stringify({
            title: 'Sales by Region',
            columns: [
              { key: 'region', label: 'Region', type: 'text' },
              { key: 'revenue', label: 'Revenue', type: 'currency' },
              { key: 'growth', label: 'Growth', type: 'percent' },
              { key: 'status', label: 'Status', type: 'badge' },
            ],
            rows: [
              { region: 'North America', revenue: 1250000, growth: 0.124, status: 'Active' },
              { region: 'Europe', revenue: 980000, growth: 0.087, status: 'Active' },
              { region: 'Asia Pacific', revenue: 1580000, growth: 0.215, status: 'Active' },
              { region: 'Latin America', revenue: 420000, growth: -0.032, status: 'Revoked' },
            ],
          }),
        },
      },
      {
        name: 'Boolean & Badge Types',
        props: {
          code: JSON.stringify({
            title: 'API Keys',
            columns: [
              { key: 'name', label: 'Name', type: 'text' },
              { key: 'active', label: 'Active', type: 'boolean' },
              { key: 'status', label: 'Status', type: 'badge' },
            ],
            rows: [
              { name: 'Production', active: true, status: 'Passing' },
              { name: 'Staging', active: true, status: 'Passing' },
              { name: 'Legacy', active: false, status: 'Failed' },
            ],
          }),
        },
      },
      {
        name: 'Invalid JSON (Fallback)',
        props: { code: '{ invalid json here' },
      },
    ],
  },
  {
    id: 'spreadsheet-block',
    name: 'MarkdownSpreadsheetBlock',
    category: 'Markdown',
    description: 'Excel-style grid with column letters and row numbers for ```spreadsheet code blocks',
    component: MarkdownSpreadsheetBlock,
    props: [
      {
        name: 'code',
        description: 'JSON string with columns and rows',
        control: { type: 'textarea', rows: 12 },
        defaultValue: JSON.stringify({
          filename: 'Q1_Revenue.xlsx',
          sheetName: 'Summary',
          columns: [
            { key: 'region', label: 'Region', type: 'text' },
            { key: 'q1', label: 'Q1', type: 'currency' },
            { key: 'q2', label: 'Q2', type: 'currency' },
            { key: 'change', label: 'Change', type: 'percent' },
            { key: 'total', label: 'Total', type: 'formula' },
          ],
          rows: [
            { region: 'North', q1: 500000, q2: 620000, change: 0.24, total: 1120000 },
            { region: 'South', q1: 340000, q2: 310000, change: -0.088, total: 650000 },
            { region: 'East', q1: 780000, q2: 850000, change: 0.09, total: 1630000 },
            { region: 'West', q1: 420000, q2: 480000, change: 0.143, total: 900000 },
          ],
        }, null, 2),
      },
    ],
    variants: [
      {
        name: 'Revenue Sheet',
        props: {
          code: JSON.stringify({
            filename: 'Q1_Revenue.xlsx',
            sheetName: 'Summary',
            columns: [
              { key: 'region', label: 'Region', type: 'text' },
              { key: 'q1', label: 'Q1', type: 'currency' },
              { key: 'q2', label: 'Q2', type: 'currency' },
              { key: 'change', label: 'Change', type: 'percent' },
            ],
            rows: [
              { region: 'North', q1: 500000, q2: 620000, change: 0.24 },
              { region: 'South', q1: 340000, q2: 310000, change: -0.088 },
              { region: 'East', q1: 780000, q2: 850000, change: 0.09 },
            ],
          }),
        },
      },
      {
        name: 'Simple Sheet (No Filename)',
        props: {
          code: JSON.stringify({
            columns: [
              { key: 'item', label: 'Item', type: 'text' },
              { key: 'qty', label: 'Quantity', type: 'number' },
              { key: 'price', label: 'Price', type: 'currency' },
            ],
            rows: [
              { item: 'Widget A', qty: 100, price: 29 },
              { item: 'Widget B', qty: 250, price: 15 },
              { item: 'Widget C', qty: 50, price: 89 },
            ],
          }),
        },
      },
      {
        name: 'Invalid JSON (Fallback)',
        props: { code: '{ invalid json here' },
      },
    ],
  },
  {
    id: 'markdown-html-block',
    name: 'MarkdownHtmlBlock',
    category: 'Markdown',
    description: 'Renders ```html-preview blocks with sandboxed iframe, fullscreen, Live Browser, and open-panel actions.',
    component: MarkdownHtmlBlock,
    wrapper: MarkdownHtmlBlockWrapper,
    layout: 'top',
    props: [
      {
        name: 'code',
        description: 'JSON spec for html-preview block.',
        control: { type: 'textarea', rows: 12 },
        defaultValue: JSON.stringify({
          title: 'HTML Preview',
          src: '/mock/html/report.html',
        }, null, 2),
      },
    ],
    variants: [
      {
        name: 'Single HTML',
        props: {
          code: JSON.stringify({
            title: 'HTML Preview',
            src: '/mock/html/report.html',
          }, null, 2),
        },
      },
      {
        name: 'Tabbed HTML',
        props: {
          code: JSON.stringify({
            title: 'HTML Preview Set',
            items: [
              { src: '/mock/html/report.html', label: 'Report' },
              { src: '/mock/html/email.html', label: 'Email' },
            ],
          }, null, 2),
        },
      },
      {
        name: 'Missing File Error',
        props: {
          code: JSON.stringify({
            title: 'Missing HTML',
            src: '/mock/html/does-not-exist.html',
          }, null, 2),
        },
      },
      {
        name: 'Invalid JSON (Fallback)',
        props: { code: '{ invalid json here' },
      },
    ],
    mockData: () => ({
      onFileClick: (path: string) => console.log('[Playground] Open in panel:', path),
    }),
  },
  {
    id: 'markdown-doc-block',
    name: 'MarkdownDocBlock',
    category: 'Markdown',
    description: 'Renders ```markdown-preview blocks with rendered markdown, fullscreen, tabs, and open-panel actions.',
    component: MarkdownDocBlock,
    wrapper: MarkdownDocBlockWrapper,
    layout: 'top',
    props: [
      {
        name: 'code',
        description: 'JSON spec for markdown-preview block.',
        control: { type: 'textarea', rows: 12 },
        defaultValue: JSON.stringify({
          title: 'Markdown Preview',
          src: '/mock/markdown/spec.md',
        }, null, 2),
      },
    ],
    variants: [
      {
        name: 'Single Markdown',
        props: {
          code: JSON.stringify({
            title: 'Markdown Preview',
            src: '/mock/markdown/spec.md',
          }, null, 2),
        },
      },
      {
        name: 'Tabbed Markdown',
        props: {
          code: JSON.stringify({
            title: 'Markdown Preview Set',
            items: [
              { src: '/mock/markdown/spec.md', label: 'Spec' },
              { src: '/mock/markdown/notes.md', label: 'Notes' },
            ],
          }, null, 2),
        },
      },
      {
        name: 'Missing File Error',
        props: {
          code: JSON.stringify({
            title: 'Missing Markdown',
            src: '/mock/markdown/does-not-exist.md',
          }, null, 2),
        },
      },
      {
        name: 'Invalid JSON (Fallback)',
        props: { code: '{ invalid json here' },
      },
    ],
    mockData: () => ({
      onUrlClick: (url: string) => console.log('[Playground] URL clicked:', url),
      onFileClick: (path: string) => console.log('[Playground] Open in panel:', path),
    }),
  },
  {
    id: 'image-card-stack',
    name: 'ImageCardStack',
    category: 'Markdown',
    description: 'Swipeable card stack used for image gallery previews.',
    component: ImageCardStackPlayground,
    layout: 'full',
    props: [
      {
        name: 'items',
        description: 'Gallery items with optional aspect ratio values (width/height).',
        control: { type: 'textarea', rows: 10 },
        defaultValue: JSON.stringify([
          { src: MOCK_IMAGE_DATA['/mock/images/gallery-1.png'], label: 'Lake', ratio: 4 / 3 },
          { src: MOCK_IMAGE_DATA['/mock/images/gallery-2.png'], label: 'Forest', ratio: 3 / 4 },
          { src: MOCK_IMAGE_DATA['/mock/images/gallery-3.png'], label: 'Sunset', ratio: 16 / 9 },
        ], null, 2),
      },
      {
        name: 'maxRotate',
        description: 'Maximum baseline random card rotation in degrees.',
        control: { type: 'number', min: 0, max: 16, step: 1 },
        defaultValue: 5,
      },
    ],
    variants: [
      {
        name: 'Mixed Ratios',
        props: {
          items: JSON.stringify([
            { src: MOCK_IMAGE_DATA['/mock/images/gallery-1.png'], label: 'Lake', ratio: 4 / 3 },
            { src: MOCK_IMAGE_DATA['/mock/images/gallery-2.png'], label: 'Forest', ratio: 3 / 4 },
            { src: MOCK_IMAGE_DATA['/mock/images/gallery-3.png'], label: 'Sunset', ratio: 16 / 9 },
          ], null, 2),
          maxRotate: 5,
        },
      },
      {
        name: 'Large Gallery',
        props: {
          items: JSON.stringify([
            { src: MOCK_IMAGE_DATA['/mock/images/gallery-1.png'], label: 'Shot 1', ratio: 4 / 3 },
            { src: MOCK_IMAGE_DATA['/mock/images/gallery-2.png'], label: 'Shot 2', ratio: 4 / 3 },
            { src: MOCK_IMAGE_DATA['/mock/images/gallery-3.png'], label: 'Shot 3', ratio: 16 / 9 },
            { src: MOCK_IMAGE_DATA['/mock/images/gallery-4.png'], label: 'Shot 4', ratio: 3 / 4 },
            { src: MOCK_IMAGE_DATA['/mock/images/gallery-5.png'], label: 'Shot 5', ratio: 4 / 3 },
          ], null, 2),
          maxRotate: 7,
        },
      },
      {
        name: 'Subtle Rotation',
        props: {
          items: JSON.stringify([
            { src: MOCK_IMAGE_DATA['/mock/images/gallery-1.png'], label: 'One', ratio: 4 / 3 },
            { src: MOCK_IMAGE_DATA['/mock/images/gallery-2.png'], label: 'Two', ratio: 4 / 3 },
            { src: MOCK_IMAGE_DATA['/mock/images/gallery-3.png'], label: 'Three', ratio: 4 / 3 },
          ], null, 2),
          maxRotate: 2,
        },
      },
    ],
  },
  {
    id: 'markdown-image-block',
    name: 'MarkdownImageBlock',
    category: 'Markdown',
    description: 'Renders ```image-preview blocks with card-stack galleries and fullscreen overlay support.',
    component: MarkdownImageBlock,
    wrapper: MarkdownImageBlockWrapper,
    layout: 'top',
    props: [
      {
        name: 'code',
        description: 'JSON spec for image-preview block.',
        control: { type: 'textarea', rows: 12 },
        defaultValue: JSON.stringify({
          title: 'Image Gallery',
          items: [
            { src: '/mock/images/gallery-1.png', label: 'Lake', ratio: 4 / 3 },
            { src: '/mock/images/gallery-2.png', label: 'Forest', ratio: 3 / 4 },
            { src: '/mock/images/gallery-3.png', label: 'Sunset', ratio: 16 / 9 },
          ],
        }, null, 2),
      },
    ],
    variants: [
      {
        name: 'Single Image',
        props: {
          code: JSON.stringify({
            title: 'Single Image',
            src: '/mock/images/gallery-1.png',
          }, null, 2),
        },
      },
      {
        name: 'Gallery Stack',
        props: {
          code: JSON.stringify({
            title: 'Gallery Stack',
            items: [
              { src: '/mock/images/gallery-1.png', label: 'Lake', ratio: 4 / 3 },
              { src: '/mock/images/gallery-2.png', label: 'Forest', ratio: 3 / 4 },
              { src: '/mock/images/gallery-3.png', label: 'Sunset', ratio: 16 / 9 },
              { src: '/mock/images/gallery-4.png', label: 'City', ratio: 4 / 3 },
            ],
          }, null, 2),
        },
      },
      {
        name: 'Unknown Path Error',
        props: {
          code: JSON.stringify({
            title: 'Missing Image',
            items: [
              { src: '/mock/images/gallery-1.png', label: 'Found' },
              { src: '/mock/images/does-not-exist.png', label: 'Missing' },
            ],
          }, null, 2),
        },
      },
      {
        name: 'Invalid JSON (Fallback)',
        props: { code: '{ invalid json here' },
      },
    ],
  },
  {
    id: 'rich-block-interaction-parity',
    name: 'RichBlockInteractionParity',
    category: 'Markdown',
    description: 'Single playground fixture to verify inline + fullscreen interaction parity across Mermaid and image-preview blocks.',
    component: Markdown,
    wrapper: MarkdownImageBlockWrapper,
    layout: 'top',
    props: [
      {
        name: 'children',
        description: 'Markdown fixture for parity checks',
        control: { type: 'textarea', rows: 20 },
        defaultValue: richBlockParityMarkdown,
      },
      {
        name: 'mode',
        description: 'Render mode controlling formatting level',
        control: {
          type: 'select',
          options: [
            { label: 'Terminal', value: 'terminal' },
            { label: 'Minimal', value: 'minimal' },
            { label: 'Full', value: 'full' },
          ],
        },
        defaultValue: 'full',
      },
    ],
    variants: [
      { name: 'Parity Fixture', props: { children: richBlockParityMarkdown, mode: 'full' } },
    ],
    mockData: () => ({
      onUrlClick: (url: string) => console.log('[Playground] URL clicked:', url),
      onFileClick: (path: string) => console.log('[Playground] File clicked:', path),
    }),
  },
]
