import { useState } from "react";
import { CheckIcon, DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import { Box, Button, Code, Flex, Text, Tooltip } from "@radix-ui/themes";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Light } from "react-syntax-highlighter";
import { atomOneDark as style } from "react-syntax-highlighter/dist/esm/styles/hljs";
import js from "react-syntax-highlighter/dist/esm/languages/hljs/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/hljs/typescript";
import python from "react-syntax-highlighter/dist/esm/languages/hljs/python";
import go from "react-syntax-highlighter/dist/esm/languages/hljs/go";
import php from "react-syntax-highlighter/dist/esm/languages/hljs/php";
import xml from "react-syntax-highlighter/dist/esm/languages/hljs/xml";
import css from "react-syntax-highlighter/dist/esm/languages/hljs/css";
import bash from "react-syntax-highlighter/dist/esm/languages/hljs/bash";
import json from "react-syntax-highlighter/dist/esm/languages/hljs/json";
import sql from "react-syntax-highlighter/dist/esm/languages/hljs/sql";
import yaml from "react-syntax-highlighter/dist/esm/languages/hljs/yaml";
import java from "react-syntax-highlighter/dist/esm/languages/hljs/java";
import kotlin from "react-syntax-highlighter/dist/esm/languages/hljs/kotlin";
import c from "react-syntax-highlighter/dist/esm/languages/hljs/c";
import cpp from "react-syntax-highlighter/dist/esm/languages/hljs/cpp";
import csharp from "react-syntax-highlighter/dist/esm/languages/hljs/csharp";

const codeStyle = {
  ...style,
  hljs: {
    ...style.hljs,
    fontSize: "0.8rem",
    lineHeight: "1.4",
    width: "100%",
    margin: 0,
  },
};

Light.registerLanguage("javascript", js);
Light.registerLanguage("typescript", typescript);
Light.registerLanguage("python", python);
Light.registerLanguage("go", go);
Light.registerLanguage("php", php);
Light.registerLanguage("html", xml);
Light.registerLanguage("css", css);
Light.registerLanguage("bash", bash);
Light.registerLanguage("json", json);
Light.registerLanguage("sql", sql);
Light.registerLanguage("yaml", yaml);
Light.registerLanguage("java", java);
Light.registerLanguage("kotlin", kotlin);
Light.registerLanguage("c", c);
Light.registerLanguage("cpp", cpp);
Light.registerLanguage("csharp", csharp);

function CodeBlock({ language, code }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      // eslint-disable-next-line no-console
      .catch((e) => console.error(e));
  };

  return (
    <Box
      width="100%"
      maxWidth="100%"
      my="2"
      style={{ borderRadius: "6px", overflow: "hidden", border: "1px solid rgba(255, 255, 255, 0.08)" }}
    >
      <Flex justify="between" align="center" px="3" py="1" style={{ background: "#21252b", color: "#9da5b4" }}>
        <Text size="1" weight="medium" style={{ textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {language}
        </Text>
        <Tooltip content={copied ? "Copied!" : "Copy"}>
          <Button size="1" variant="ghost" onClick={handleCopy} style={{ color: "#9da5b4" }}>
            {copied ? <CheckIcon width="16" /> : <DocumentDuplicateIcon width="16" />}
            {copied ? "Copied" : "Copy Code"}
          </Button>
        </Tooltip>
      </Flex>
      <Light PreTag="div" language={language} wrapLines wrapLongLines style={codeStyle}>
        {code}
      </Light>
    </Box>
  );
}

function Markdown({ children, ...markdownProps }) {
  const content = children.trim();

  return (
    <ReactMarkdown
      {...markdownProps}
      remarkPlugins={[remarkGfm]}
      components={{
        a({ children, href }) {
          return (
            <Text asChild>
              <a href={href} className="message-link" target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            </Text>
          );
        },
        p({ children }) {
          return <Text as="p">{children}</Text>;
        },
        h1({ children }) {
          return (
            <Text as="h1" size="6" weight="bold">
              {children}
            </Text>
          );
        },
        h2({ children }) {
          return (
            <Text as="h2" size="5" weight="bold">
              {children}
            </Text>
          );
        },
        h3({ children }) {
          return (
            <Text as="h3" size="4" weight="bold">
              {children}
            </Text>
          );
        },
        h4({ children }) {
          return (
            <Text as="h4" size="3" weight="bold">
              {children}
            </Text>
          );
        },
        h5({ children }) {
          return (
            <Text as="h5" size="2" weight="bold">
              {children}
            </Text>
          );
        },
        h6({ children }) {
          return (
            <Text as="h6" size="1" weight="bold">
              {children}
            </Text>
          );
        },
        pre({ children }) {
          return <>{children}</>;
        },
        code({ children, className }) {
          const match = /language-(\w+)/.exec(className || "");
          return match ? (
            <CodeBlock language={match[1]} code={String(children).replace(/\n$/, "")} />
          ) : (
            <Code>{children}</Code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export default Markdown;
