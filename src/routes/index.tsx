import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { planQueries, retrievePapers, analyze, writeReport, type Paper } from "@/lib/research.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Scholar Agents — Multi-Agent Research Assistant" },
      { name: "description", content: "Agents find papers, verify evidence, compare solutions, surface gaps and write a cited report." },
      { property: "og:title", content: "Scholar Agents — Multi-Agent Research Assistant" },
      { property: "og:description", content: "From problem statement to cited literature review, automatically." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const AGENTS = [
  { key: "plan", name: "Planner", desc: "Decomposes the problem into queries" },
  { key: "retrieve", name: "Retriever", desc: "Searches 250M+ scholarly works" },
  { key: "analyze", name: "Verifier & Analyst", desc: "Checks evidence, compares, finds gaps" },
  { key: "write", name: "Writer", desc: "Drafts the cited report" },
] as const;

type Analysis = Awaited<ReturnType<typeof analyze>>;

function Index() {
  const [problem, setProblem] = useState("");
  const [step, setStep] = useState(-1);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<{ queries: string[]; subquestions: string[] } | null>(null);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [report, setReport] = useState("");
  const running = step >= 0 && step < 4;

  async function run() {
    if (!problem.trim()) return;
    setError(""); setPlan(null); setPapers([]); setAnalysis(null); setReport("");
    try {
      setStep(0);
      const p = await planQueries({ data: { problem } });
      setPlan(p);
      setStep(1);
      const { papers } = await retrievePapers({ data: { queries: p.queries } });
      if (!papers.length) throw new Error("No papers found. Try rephrasing the problem.");
      setPapers(papers);
      setStep(2);
      const a = await analyze({ data: { problem, papers } });
      setAnalysis(a);
      setStep(3);
      const rel = papers.filter((x) => a.relevant?.includes(x.id));
      const { report } = await writeReport({ data: { problem, papers: rel.length ? rel : papers, analysis: a } });
      setReport(report);
      setStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setStep(-1);
    }
  }

  const byId = (id: number) => papers.find((p) => p.id === id);
  const cited = papers.filter((p) => !analysis || analysis.relevant?.includes(p.id));

  function download() {
    const refs = cited.map((p) => `[${p.id}] ${p.authors} (${p.year}). ${p.title}. ${p.venue}. ${p.url}`).join("\n");
    const blob = new Blob([`# ${problem}\n\n${report}\n\n## References\n${refs}\n`], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "research-report.md";
    a.click();
  }

  return (
    <main className="min-h-screen paper-bg">
      <header className="mx-auto max-w-5xl px-6 pt-16 pb-10">
        <p className="eyebrow">Multi-Agent Research Assistant</p>
        <h1 className="font-display text-5xl md:text-6xl leading-[1.05] mt-3">
          From a question to a <em className="text-primary">cited</em> literature review.
        </h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Four agents collaborate: they plan searches, retrieve real papers, verify evidence, compare solutions,
          highlight research gaps, and write a report where every claim traces to a source.
        </p>
        <div className="mt-8 rounded-xl border bg-card p-4 shadow-soft">
          <textarea
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            rows={3}
            placeholder="e.g. How can we reduce hallucinations in large language models used for medical question answering?"
            className="w-full resize-none bg-transparent text-lg outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between pt-2 border-t">
            <span className="text-xs font-mono text-muted-foreground">Sources: OpenAlex + Crossref · Engine: Claude</span>
            <button onClick={run} disabled={running || !problem.trim()} className="btn-primary">
              {running ? "Agents working…" : "Run research"}
            </button>
          </div>
        </div>
        {error && <p className="mt-3 text-destructive text-sm">{error}</p>}
      </header>

      {step >= 0 && (
        <section className="mx-auto max-w-5xl px-6 grid gap-3 md:grid-cols-4">
          {AGENTS.map((a, i) => {
            const state = step > i ? "done" : step === i ? "active" : "idle";
            return (
              <div key={a.key} className={`agent-card agent-${state}`}>
                <div className="flex items-center gap-2">
                  <span className="agent-dot" />
                  <span className="font-mono text-xs">0{i + 1}</span>
                </div>
                <p className="font-display text-lg mt-2">{a.name}</p>
                <p className="text-xs text-muted-foreground">{a.desc}</p>
              </div>
            );
          })}
        </section>
      )}

      <div className="mx-auto max-w-5xl px-6 py-10 space-y-12">
        {plan && (
          <Block title="Research plan">
            <div className="flex flex-wrap gap-2">
              {plan.queries.map((q) => <span key={q} className="chip">{q}</span>)}
            </div>
            <ul className="mt-4 list-disc pl-5 space-y-1 text-sm">
              {plan.subquestions.map((s) => <li key={s}>{s}</li>)}
            </ul>
          </Block>
        )}

        {report && (
          <Block title="Report">
            <div className="flex justify-end -mt-10 mb-4">
              <button onClick={download} className="btn-ghost">Download .md</button>
            </div>
            <article className="prose-report">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
            </article>
          </Block>
        )}

        {analysis && (
          <>
            <Block title="Comparative analysis">
              <div className="overflow-x-auto rounded-lg border bg-card">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left">
                    <tr>{["Paper", "Approach", "Strength", "Limitation", "Evidence"].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {analysis.comparison?.map((c) => (
                      <tr key={c.paper} className="border-t align-top">
                        <td className="p-3 font-mono text-primary">[{c.paper}]<div className="font-sans text-xs text-muted-foreground max-w-40">{byId(c.paper)?.title}</div></td>
                        <td className="p-3">{c.approach}</td>
                        <td className="p-3">{c.strength}</td>
                        <td className="p-3">{c.limitation}</td>
                        <td className="p-3"><span className={`evidence evidence-${c.evidence}`}>{c.evidence}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Block>
            <Block title="Research gaps">
              <div className="grid gap-4 md:grid-cols-2">
                {analysis.gaps?.map((g, i) => (
                  <div key={i} className="rounded-lg border-l-4 border-primary bg-card p-4">
                    <p className="font-display text-lg">{g.gap}</p>
                    <p className="text-sm text-muted-foreground mt-1">{g.why}</p>
                    <p className="font-mono text-xs text-primary mt-2">{g.cites?.map((c) => `[${c}]`).join(" ")}</p>
                  </div>
                ))}
              </div>
            </Block>
          </>
        )}

        {papers.length > 0 && (
          <Block title={`References (${cited.length})`}>
            <ol className="space-y-4">
              {cited.map((p) => (
                <li key={p.id} className="flex gap-4">
                  <span className="font-mono text-primary">[{p.id}]</span>
                  <div>
                    <a href={p.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{p.title}</a>
                    <p className="text-sm text-muted-foreground">{p.authors} · {p.year} · {p.venue} · {p.citations} citations</p>
                  </div>
                </li>
              ))}
            </ol>
          </Block>
        )}
      </div>
    </main>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-3xl mb-4 border-b pb-2">{title}</h2>
      {children}
    </section>
  );
}
