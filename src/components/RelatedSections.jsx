import PropTypes from "prop-types";
import { Box, Flex, Link, Text } from "@radix-ui/themes";
import { navigateToSection } from "../lib/ragEngine.js";

// Renders up to N "Related sections" links from the assistant message's
// retrieval sources (spec FR-5). Links come from retrieval, NOT model markers.
// Hidden by the caller when sources is empty / all below threshold (FR-3).
// Links are real <a href> (keyboard-focusable, SR label = section title);
// click is intercepted so same-page links smooth-scroll the host instead of
// reloading. Stacks + wraps within the chat panel on mobile (NFR Responsive).
const MAX_LINKS = 3;

function RelatedSections({ sources = [] }) {
  const links = sources.slice(0, MAX_LINKS);
  if (links.length === 0) return null;

  const handleClick = (pointer) => (e) => {
    e.preventDefault();
    navigateToSection(pointer);
  };

  return (
    <Box mt="2">
      <Text as="div" size="1" style={{ color: "var(--gray-a11)", marginBottom: "4px" }}>
        Related sections
      </Text>
      <Flex wrap="wrap" gap="2">
        {links.map((s) => (
          <Link
            key={`${s.anchor}-${s.url}`}
            href={s.url}
            onClick={handleClick({ url: s.url, anchor: s.anchor })}
            aria-label={`Go to section: ${s.title}`}
            size="2"
            highContrast>
            {s.title}
          </Link>
        ))}
      </Flex>
    </Box>
  );
}

RelatedSections.propTypes = {
  sources: PropTypes.arrayOf(
    PropTypes.shape({
      anchor: PropTypes.string,
      title: PropTypes.string,
      url: PropTypes.string,
      text: PropTypes.string,
      score: PropTypes.number,
    })
  ),
};

export default RelatedSections;
