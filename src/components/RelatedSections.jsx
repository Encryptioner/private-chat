import PropTypes from "prop-types";
import { Box, Flex, Link, Text } from "@radix-ui/themes";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { navigateToSection, isCurrentPageTarget, safeUrl } from "../lib/ragEngine.js";

// Renders up to N "Related sections" links from the assistant message's
// retrieval sources (spec FR-5). Links come from retrieval, NOT model markers.
// Hidden by the caller when sources is empty / all below threshold (FR-3).
// Links are real <a href> (keyboard-focusable, SR label = section title);
// click is intercepted so same-page links smooth-scroll the host instead of
// reloading. A link to a DIFFERENT page/domain gets an external-link icon,
// real target="_blank"/rel, and an updated aria-label — set BEFORE the click
// (isCurrentPageTarget is the same check navigateToSection uses to decide),
// so the affordance never promises one thing and does another.
// Stacks + wraps within the chat panel on mobile (NFR Responsive).
const MAX_LINKS = 3;

function RelatedSections({ sources = [] }) {
  // Drop sources whose url is an unsafe scheme (javascript:/data:/…) before
  // rendering — they can reach here from untrusted custom getSections or a
  // precomputed site-index.json. The default scraper only emits http(s).
  const links = sources.filter((s) => safeUrl(s.url)).slice(0, MAX_LINKS);
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
        {links.map((s) => {
          const opensNewTab = !isCurrentPageTarget(s.url);
          return (
            <Link
              key={`${s.anchor}-${s.url}`}
              href={s.url}
              target={opensNewTab ? "_blank" : undefined}
              rel={opensNewTab ? "noopener noreferrer" : undefined}
              onClick={handleClick({ url: s.url, anchor: s.anchor })}
              aria-label={opensNewTab ? `${s.title} (opens in a new tab)` : `Go to section: ${s.title}`}
              size="2"
              highContrast
              className="related-section-link"
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                {s.title}
                {opensNewTab && (
                  <ArrowTopRightOnSquareIcon
                    width="12"
                    height="12"
                    aria-hidden="true"
                    style={{ flexShrink: 0, opacity: 0.7 }}
                  />
                )}
              </span>
            </Link>
          );
        })}
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
