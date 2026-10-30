import { createServerFn } from "@tanstack/react-start";

export type Paper = {
  id: number;
  title: string;
  authors: string;
  year: number | null;
  venue: string;
  citations: number;
  url: string;
  abstract: string;
};

// Claude via Lovable AI Gateway native Messages API (streamed, accumulated server-side)
async function ai(system: string, user: string, json = false): Promise<string> {
  const key = process.env['LOVABLE_API_KEY'];
  if (!key) throw new Error("AI key missing");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-5",
      max_tokens: 16000,
      stream: true,
      system: json ? `${system}\n\nRespond with ONLY a valid JSON object, no prose or code fences.` : system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (res.status === 429) throw new Error("Rate limited — please wait a moment and retry.");
  if (res.status === 402) throw new Error("AI credits exhausted — add credits in workspace settings.");
  if (res.status === 403) throw new Error("Claude access was denied for this workspace.");
  if (!res.ok || !res.body) throw new Error(`AI error ${res.status}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let refused = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") text += ev.delta.text;
        if (ev.type === "message_delta" && ev.delta?.stop_reason === "refusal") refused = true;
        if (ev.type === "error") throw new Error(ev.error?.message ?? "AI stream error");
      } catch (e) {
        if (e instanceof Error && e.message !== "" && !(e instanceof SyntaxError)) throw e;
      }
    }
  }
  if (refused) throw new Error("Claude declined to answer this request.");
  return text;
}

function parseJson<T>(s: string): T {
  const m = s.match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : s);
}

// Agent 1: Planner
export const planQueries = createServerFn({ method: "POST" })
  .inputValidator((d: { problem: string }) => ({ problem: String(d.problem).slice(0, 2000) }))
  .handler(async ({ data }) => {
    const out = await ai(
      "You are a research planning agent. Decompose a problem statement into academic search queries. Return JSON: {\"queries\": string[3-4 short keyword queries], \"subquestions\": string[3-5]}",
      data.problem,
      true,
    );
    return parseJson<{ queries: string[]; subquestions: string[] }>(out);
  });

function invertAbstract(idx: Record<string, number[]> | null): string {
  if (!idx) return "";
  const words: string[] = [];
  for (const [w, pos] of Object.entries(idx)) for (const p of pos) words[p] = w;
  return words.join(" ").slice(0, 1200);
}

type RawPaper = Omit<Paper, "id">;

async function searchOpenAlex(q: string): Promise<RawPaper[] | null> {
  try {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=6&filter=has_abstract:true&sort=relevance_score:desc&mailto=research@example.com`;
    const r = await fetch(url);
    if (!r.ok) {
      console.warn(`OpenAlex ${r.status} for "${q}"`);
      return null;
    }
    const j = await r.json();
    return (j.results ?? []).map((w: any) => ({
      title: w.display_name ?? "Untitled",
      authors: (w.authorships ?? []).slice(0, 3).map((a: any) => a.author?.display_name).join(", ") +
        ((w.authorships?.length ?? 0) > 3 ? " et al." : ""),
      year: w.publication_year ?? null,
      venue: w.primary_location?.source?.display_name ?? "",
      citations: w.cited_by_count ?? 0,
      url: w.doi ?? w.primary_location?.landing_page_url ?? w.id,
      abstract: invertAbstract(w.abstract_inverted_index),
    }));
  } catch (e) {
    console.warn("OpenAlex failed", e);
    return null;
  }
}

// Fallback source: Crossref (free, no daily budget)
async function searchCrossref(q: string): Promise<RawPaper[]> {
  try {
    const url = `https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=6&filter=has-abstract:true,type:journal-article&select=title,author,issued,container-title,is-referenced-by-count,DOI,URL,abstract&mailto=research@example.com`;
    const r = await fetch(url, { headers: { "User-Agent": "ScholarAgents/1.0 (mailto:research@example.com)" } });
    if (!r.ok) {
      console.warn(`Crossref ${r.status} for "${q}"`);
      return [];
    }
    const j = await r.json();
    return (j.message?.items ?? []).map((w: any) => {
      const authors = (w.author ?? []) as { given?: string; family?: string; name?: string }[];
      return {
        title: w.title?.[0] ?? "Untitled",
        authors: authors.slice(0, 3).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")).join(", ") +
          (authors.length > 3 ? " et al." : ""),
        year: w.issued?.["date-parts"]?.[0]?.[0] ?? null,
        venue: w["container-title"]?.[0] ?? "",
        citations: w["is-referenced-by-count"] ?? 0,
        url: w.DOI ? `https://doi.org/${w.DOI}` : w.URL ?? "",
        abstract: String(w.abstract ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200),
      };
    });
  } catch (e) {
    console.warn("Crossref failed", e);
    return [];
  }
}

// Agent 2: Retriever (OpenAlex, falls back to Crossref)
export const retrievePapers = createServerFn({ method: "POST" })
  .inputValidator((d: { queries: string[] }) => ({ queries: (d.queries || []).slice(0, 4).map(String) }))
  .handler(async ({ data }) => {
    const seen = new Map<string, RawPaper>();
    const add = (list: RawPaper[]) => {
      for (const p of list) {
        const k = p.title.toLowerCase().replace(/\W+/g, "");
        if (k && !seen.has(k)) seen.set(k, p);
      }
    };
    await Promise.all(
      data.queries.map(async (q) => {
        const oa = await searchOpenAlex(q);
        if (oa && oa.length) add(oa);
        else add(await searchCrossref(q));
      }),
    );
    // Still too few? Top up from Crossref.
    if (seen.size < 6) {
      const extra = await Promise.all(data.queries.map(searchCrossref));
      extra.forEach(add);
    }
    const papers: Paper[] = [...seen.values()]
      .sort((a, b) => b.citations - a.citations)
      .slice(0, 14)
      .map((p, i) => ({ ...p, id: i + 1 }));
    return { papers };
  });

const corpus = (papers: Paper[]) =>
  papers.map((p) => `[${p.id}] ${p.title} (${p.authors}, ${p.year}). ${p.abstract}`).join("\n\n");

// Agent 3: Verifier + Analyst
export const analyze = createServerFn({ method: "POST" })
  .inputValidator((d: { problem: string; papers: Paper[] }) => d)
  .handler(async ({ data }) => {
    const out = await ai(
      `You are an evidence verification and comparative analysis agent. Only use the given papers; cite with their [n] ids. Return JSON:
{"relevant": number[] (ids truly relevant),
 "comparison": [{"paper": number, "approach": string, "strength": string, "limitation": string, "evidence": "strong"|"moderate"|"weak"}],
 "gaps": [{"gap": string, "why": string, "cites": number[]}]}`,
      `Problem: ${data.problem}\n\nPapers:\n${corpus(data.papers)}`,
      true,
    );
    return parseJson<{
      relevant: number[];
      comparison: { paper: number; approach: string; strength: string; limitation: string; evidence: string }[];
      gaps: { gap: string; why: string; cites: number[] }[];
    }>(out);
  });

// Agent 4: Writer
export const writeReport = createServerFn({ method: "POST" })
  .inputValidator((d: { problem: string; papers: Paper[]; analysis: unknown }) => d)
  .handler(async ({ data }) => {
    const report = await ai(
      "You are a scientific writing agent. Write a concise literature review in Markdown with sections: ## Summary, ## Landscape of Approaches, ## Comparative Findings, ## Research Gaps, ## Recommended Directions. Cite every claim with [n] matching paper ids. Never invent sources. Do not include a references list.",
      `Problem: ${data.problem}\n\nAnalysis: ${JSON.stringify(data.analysis)}\n\nPapers:\n${corpus(data.papers)}`,
    );
    return { report };
  });
