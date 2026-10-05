import Link from "next/link";

function inlineNodes(value, keyPrefix = "inline") {
  const text = String(value || "");
  const pattern = /(\*\*|__)(.+?)\1|(~~)(.+?)\3|(`)(.+?)\5|(\*|_)(.+?)\7|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const nodes = [];
  let cursor = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    if (match[1] !== undefined) nodes.push(<strong key={`${keyPrefix}-bold-${match.index}`}>{match[2]}</strong>);
    else if (match[3] !== undefined) nodes.push(<del key={`${keyPrefix}-strike-${match.index}`}>{match[4]}</del>);
    else if (match[5] !== undefined) nodes.push(<code key={`${keyPrefix}-code-${match.index}`}>{match[6]}</code>);
    else if (match[7] !== undefined) nodes.push(<em key={`${keyPrefix}-italic-${match.index}`}>{match[8]}</em>);
    else if (match[9] !== undefined) nodes.push(<Link key={`${keyPrefix}-link-${match.index}`} href={match[10]} target="_blank" rel="noreferrer">{match[9]}</Link>);
    else nodes.push(match[0]);
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes.length ? nodes : [text];
}

function parseBlocks(value) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", lines: paragraph }), paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list), list = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "rule" });
      continue;
    }
    const checkbox = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.+)$/);
    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (checkbox || unordered || ordered) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      const nextType = orderedList ? "ordered-list" : "unordered-list";
      if (!list || list.type !== nextType) {
        flushList();
        list = { type: nextType, items: [] };
      }
      const itemText = checkbox ? checkbox[2] : ordered ? ordered[1] : unordered[1];
      list.items.push({ text: itemText, checked: checkbox ? checkbox[1].toLowerCase() === "x" : null });
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks;
}

export default function MarkdownContent({ children }) {
  return (
    <div className="public-article-markdown" dir="auto">
      {parseBlocks(children).map((block, index) => {
        if (block.type === "heading") {
          const Heading = `h${block.level}`;
          return <Heading key={index}>{inlineNodes(block.text, `block-${index}`)}</Heading>;
        }
        if (block.type === "rule") return <hr key={index} />;
        if (block.type === "unordered-list" || block.type === "ordered-list") {
          const List = block.type === "ordered-list" ? "ol" : "ul";
          return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{item.checked !== null ? <input type="checkbox" checked={item.checked} readOnly aria-label={item.checked ? "בוצע" : "לא בוצע"} /> : null}{inlineNodes(item.text, `block-${index}-item-${itemIndex}`)}</li>)}</List>;
        }
        return <p key={index}>{block.lines.map((line, lineIndex) => <span key={lineIndex}>{inlineNodes(line, `block-${index}-line-${lineIndex}`)}{lineIndex < block.lines.length - 1 ? <br /> : null}</span>)}</p>;
      })}
    </div>
  );
}
