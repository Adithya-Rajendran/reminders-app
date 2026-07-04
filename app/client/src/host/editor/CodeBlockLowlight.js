import { ReactNodeViewRenderer } from '@tiptap/react'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import CodeBlockView from './CodeBlockView.jsx'

// Replaces StarterKit's plain codeBlock with a syntax-highlighted one. The node
// name stays `codeBlock`, so tiptap-markdown still serializes it to a ```lang
// fence (round-trip safe — even an unregistered language keeps its label, just
// unhighlighted). A curated language set keeps this (lazy) chunk lean; each
// highlight.js grammar also pulls in its aliases (js→javascript, ts→typescript,
// html→xml, py→python, …).
const lowlight = createLowlight()
lowlight.register({ bash, c, cpp, css, diff, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml })

export const CodeBlock = CodeBlockLowlight
  .extend({ addNodeView() { return ReactNodeViewRenderer(CodeBlockView) } })
  .configure({ lowlight, languageClassPrefix: 'language-' })
