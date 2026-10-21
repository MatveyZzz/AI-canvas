import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(() => {
    try {
      return DOMPurify.sanitize(marked.parse(text ?? '', { async: false }) as string);
    } catch {
      return DOMPurify.sanitize(text ?? '');
    }
  }, [text]);
  return <div className={'md ' + className} dangerouslySetInnerHTML={{ __html: html }} />;
}
