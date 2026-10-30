# Scholar Agents — Multi-Agent AI Research Assistant

Enter a problem statement and four agents turn it into a cited literature review.

## The four agents

| # | Agent | Job | Engine / source |
|---|-------|-----|-----------------|
| 1 | Planner | Decomposes the problem into 3–4 search queries and 3–5 sub-questions | Claude |
| 2 | Retriever | Fetches real papers, deduplicates by title, ranks by citation count, numbers them `[1..n]` | OpenAlex, falling back to Crossref |
| 3 | Verifier & Analyst | Marks the truly relevant papers, compares approach / strength / limitation, grades evidence, finds gaps | Claude |
| 4 | Writer | Drafts a five-section Markdown review where every claim carries a bracketed id | Claude |

## Pipeline

```text
Problem statement
      |
      v
[ 1  Planner ]              ->  queries + sub-questions
      |
      v
[ 2  Retriever ]            ->  OpenAlex (Crossref fallback) -> numbered papers
      |
      v
[ 3  Verifier & Analyst ]   ->  relevant ids, comparison table, research gaps
      |
      v
[ 4  Writer ]               ->  cited literature review (Markdown)
      |
      v
Report + reference list  ->  download .md
```

## Why the output can be trusted

- Retrieval is done by real scholarly APIs — the model is never asked to produce a paper.
- The verifier and writer only ever see the papers that were actually retrieved.
- The reference list is assembled by the application from retrieved records, not by the model.
- A bracketed id such as `[7]` resolves to authors, year, venue, citation count and a live link.

## Where the code lives

| File | Contents |
|------|----------|
| `src/lib/research.functions.ts` | All four agents as server functions, the AI gateway call, OpenAlex + Crossref search, dedupe and ranking |
| `src/routes/index.tsx` | The whole page: problem input, agent status cards, plan chips, comparison table, gap cards, references, Markdown report, `.md` download |
| `src/routes/__root.tsx` | Root layout, fonts, page metadata, 404 and error screens |
| `src/styles.css` | Tailwind v4 theme tokens and the component classes used by the page |
| `src/test/app-routing.test.tsx` | Vitest smoke test that `/` resolves to a real page |

## Running it

```sh
npm install          # or: bun install
npm run dev          # start the dev server
npm run test         # run the route test
npm run build        # production build
```

The reasoning engine is reached through the Lovable AI Gateway, so the workspace needs AI
credits available; no separate Claude account or API key has to be configured by hand.

## Known limits

- OpenAlex has a free daily budget shared across a network; Crossref is the automatic fallback.
- The pool is capped at 14 papers, ranked by citation count first.
- The system works from abstracts, not full text, and does not save history between runs.

## Stack

TanStack Start v1 · React 19 · TypeScript · Tailwind CSS v4 · react-markdown · Vitest · Vite
