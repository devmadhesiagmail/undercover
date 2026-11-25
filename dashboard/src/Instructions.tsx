import { Fragment, type ReactNode } from "react";
import { useJson } from "./api";
import { Loading } from "./Loading";

interface ListItem {
  text: string;
  children: string[];
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "paragraph"; text: string };

const LIST_ITEM = /^\s*(?:-|\d+\.)\s+/;

function cells(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function listItems(lines: string[]): ListItem[] {
  const items: ListItem[] = [];
  for (const line of lines) {
    const text = line.replace(LIST_ITEM, "");
    const parent = items.at(-1);
    if (parent && /^\s/.test(line)) parent.children.push(text);
    else items.push({ text, children: [] });
  }
  return items;
}

function toBlock(chunk: string): Block {
  const lines = chunk.split("\n");
  const hashes = /^#+ /.exec(chunk);
  if (hashes) {
    const level = hashes[0].length - 1;
    return { kind: "heading", level, text: chunk.slice(level + 1) };
  }
  if (lines.every((line) => line.startsWith("|"))) {
    const rows = lines.filter((line) => !/^\|[\s|:-]+\|$/.test(line));
    return { kind: "table", rows: rows.map(cells) };
  }
  if (LIST_ITEM.test(lines[0])) {
    const ordered = /^\d/.test(lines[0]);
    return { kind: "list", ordered, items: listItems(lines) };
  }
  return { kind: "paragraph", text: lines.join(" ") };
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, index) => {
    const key = `${String(index)}:${part}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function List({
  ordered,
  items,
}: Readonly<{ ordered: boolean; items: ListItem[] }>) {
  const children = items.map((item, index) => (
    <li key={`${String(index)}:${item.text}`}>
      {inline(item.text)}
      {item.children.length > 0 && (
        <ul>
          {item.children.map((child, index) => (
            <li key={`${String(index)}:${child}`}>{inline(child)}</li>
          ))}
        </ul>
      )}
    </li>
  ));
  return ordered ? <ol>{children}</ol> : <ul>{children}</ul>;
}

function Table({ rows }: Readonly<{ rows: string[][] }>) {
  const [head, ...body] = rows;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {head.map((cell) => (
              <th key={cell}>{inline(cell)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row) => (
            <tr key={row.join("|")}>
              {row.map((cell, index) => (
                <td key={`${String(index)}:${cell}`}>{inline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlockView({ block }: Readonly<{ block: Block }>) {
  switch (block.kind) {
    case "heading":
      return block.level === 1 ? (
        <h2>{inline(block.text)}</h2>
      ) : (
        <h3>{inline(block.text)}</h3>
      );
    case "table":
      return <Table rows={block.rows} />;
    case "list":
      return <List ordered={block.ordered} items={block.items} />;
    case "paragraph":
      return <p>{inline(block.text)}</p>;
  }
}

function Markdown({ text }: Readonly<{ text: string }>) {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((chunk, index) => (
      <BlockView key={`${String(index)}:${chunk}`} block={toBlock(chunk)} />
    ));
}

export function Instructions() {
  const { data, error } = useJson<{ instructions: string }>(
    "/api/instructions",
    null,
  );

  return (
    <>
      <div className="page-heading">
        <h1>The agent's instructions</h1>
        <span className="badge badge-quiet">Read only</span>
      </div>
      <p className="lede">
        What the UnderCover Agent reads before it works each claim: its
        instructions, then the policy wording.
      </p>
      {data ? (
        <article className="panel document">
          <Markdown text={data.instructions} />
        </article>
      ) : (
        <Loading error={error} />
      )}
    </>
  );
}
