# Original Requirement — RAG for website awareness

**Source:** user conversation, 2026-08-02. Branch: `dev/rag-for-website-v1`.
**Context:** private-chat is a zero-backend, in-browser LLM chat widget (Wllama + GGUF) embeddable on any site via `embed.js`.

## Verbatim intent (the user's own words)

1. > "Check my private chat website. I want it to wherever site on which it is being used to take data by scraping, train the model in browser (optional if possible). Then with those data work as an agentic ai to help getting info about website. Or pointing different section of website easily."

2. (In response to a suggestion to use an external LLM API for generation):
   > "No. I want to use local in browser slm."

3. > "I want agentic ai so that actual section related to that page or website can be pointed as url with chat. With some other related message."

4. > "Say I want this for all of my websites. Which are described here https://encryptioner.github.io/ Some of them are under same domain with handling like /public-websites, /branchdiff-releases. How can I add support for each websites. Each project has their own repo."

## Clarified decisions (this session, 2026-08-02)

- **Scraping → RAG, not training.** In-browser gradient training is dropped (impractical: per-load retrain, tiny context windows). RAG achieves the goal with no training.
- **Fully local.** Embeddings AND generation run client-side via Wllama. No external API, no API key, no backend.
- **Embeddings via Wllama** (not `transformers.js`). Reuses the existing Wllama runtime + a dedicated small embedding GGUF (`bge-small-en-v1.5` Q4_K_M, ~33MB).
- **Cross-page awareness:** live current-page scrape in MVP. The static site-wide crawler (`build_site_index.py`) is phase 2. The static-index *merge* code stays, so an opt-in `site-index.json` is honoured if present.
- **v1 rollout:** private-chat's own demo page + one real site (`portfolio-template`).
- **Pointer UX:** prose answer + a "Related sections" list of up to ~3 links rendered from retrieved sources (not model-emitted markers).
