// src/lib/formatMessage.js
// Formats assistant message content for the dangerouslySetInnerHTML render path:
// wraps code fences and linkifies URLs. ESCAPES HTML FIRST so model output
// (incl. echoed scraped content under RAG) cannot inject live HTML/scripts
// (spec NFR Security). Code blocks then render literal HTML as text (correct).

export const escapeHtml = (str) =>
  str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const ELLIPSIS = "...";

export const formatMessageContent = (content) => {
  if (!content || content === ELLIPSIS) return content;

  // Escape first. URLs/code-fence markers survive escaping (no HTML-special chars).
  let formattedContent = escapeHtml(content);

  // Code blocks
  formattedContent = formattedContent.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    return `<div class="code-block">
      <div class="code-header">${lang || "code"}</div>
      <pre><code>${code.trim()}</code></pre>
    </div>`;
  });

  // Inline code
  formattedContent = formattedContent.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // URLs - make them clickable
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  formattedContent = formattedContent.replace(
    urlRegex,
    (url) => `<a href="${url}" class="message-link" target="_blank" rel="noopener noreferrer">${url}</a>`
  );

  return formattedContent;
};
