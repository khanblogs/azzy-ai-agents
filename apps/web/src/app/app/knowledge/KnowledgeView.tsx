"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { DemoChip } from "@/components/Brand";
import { Card, CardHeader, PageHeader } from "@/components/Card";
import { EmptyState, Skeleton } from "@/components/EmptyState";
import { IconSearch, IconTrash, IconUpload } from "@/components/Icons";
import { api, ApiError } from "@/lib/api";
import { relTime } from "@/lib/format";
import type { KnowledgeDocument, SearchHit } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { can, useAzzy } from "@/store/useAzzy";

const field = "h-10 w-full rounded-xl border border-line bg-navy px-3 text-sm text-white placeholder:text-slate-600 focus:border-brand-cyan/60 focus:outline-none focus:ring-2 focus:ring-brand-cyan/20";
const label = "mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-400";

export function KnowledgeView() {
  const me = useAzzy((s) => s.me);
  const toast = useAzzy((s) => s.toast);
  const envs = useAzzy((s) => s.environments);
  const accounts = useAzzy((s) => s.awsAccounts);
  const [docs, setDocs] = useState<KnowledgeDocument[] | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [form, setForm] = useState({ title: "", content: "", tags: "", scope: "global" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow(30_000);
  const writable = can(me, "write");

  const load = () =>
    api.knowledge
      .list()
      .then(setDocs)
      .catch(() => setDocs([]));
  useEffect(() => {
    void load();
  }, []);

  // The listing omits `content`; fetch the full document the first time it is expanded.
  useEffect(() => {
    if (!openId) return;
    const current = docs?.find((d) => d.id === openId);
    if (!current || current.content !== undefined) return;
    let alive = true;
    api.knowledge
      .get(openId)
      .then((full) => alive && setDocs((list) => (list ?? []).map((d) => (d.id === full.id ? { ...d, ...full } : d))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [openId, docs]);

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) {
      setHits(null);
      return;
    }
    setSearching(true);
    try {
      setHits(await api.knowledge.search(query.trim(), scope || undefined));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Search failed", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setSearching(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
      let doc: KnowledgeDocument;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("title", form.title.trim() || file.name);
        fd.append("scope", form.scope);
        fd.append("tags", tags.join(",")); // the API reads one comma-separated "tags" field
        doc = await api.knowledge.upload(fd);
      } else {
        doc = await api.knowledge.create({ title: form.title.trim(), content: form.content, tags, scope: form.scope });
      }
      setDocs((d) => [doc, ...(d ?? [])]);
      setForm({ title: "", content: "", tags: "", scope: "global" });
      setFile(null);
      toast({ tone: "success", title: "Document added", body: doc.title });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not add document", body: err instanceof ApiError ? err.message : "Network error" });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: KnowledgeDocument) => {
    if (!window.confirm(`Delete "${d.title}"?`)) return;
    try {
      await api.knowledge.remove(d.id);
      setDocs((list) => (list ?? []).filter((x) => x.id !== d.id));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 403)) toast({ tone: "error", title: "Could not delete", body: err instanceof ApiError ? err.message : "Network error" });
    }
  };

  const scopes = useMemo(() => ["global", ...envs.map((e) => e.id), ...accounts.map((a) => a.id)], [envs, accounts]);
  const tags = useMemo(() => Array.from(new Set((docs ?? []).flatMap((d) => d.tags))).sort(), [docs]);
  const shown = useMemo(() => (docs ?? []).filter((d) => !filter || d.tags.includes(filter)), [docs, filter]);

  return (
    <div>
      <PageHeader title="Knowledge" subtitle="Runbooks and documents agents retrieve during tasks. Retrieval is permission-aware per scope; embeddings are hashed bag-of-words in DEMO." />
      <Card className="mb-4 p-3">
        <form onSubmit={search} className="flex flex-wrap items-center gap-2" role="search">
          <label htmlFor="kb-q" className="sr-only">
            Search knowledge
          </label>
          <div className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" width={16} height={16} />
            <input id="kb-q" data-testid="knowledge-search" className={clsx(field, "pl-9")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="How do I roll back an ECS service?" />
          </div>
          <select aria-label="Scope" className="h-10 rounded-xl border border-line bg-navy px-2 text-xs text-slate-200" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">All scopes</option>
            {scopes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary" loading={searching} aria-label="Search" data-testid="knowledge-search-submit">
            Search
          </Button>
        </form>
        {hits ? (
          <div className="mt-3" data-testid="knowledge-results">
            {hits.length === 0 ? <p className="text-xs text-slate-500">No matches.</p> : null}
            <ol className="space-y-2">
              {hits.map((h, i) => (
                <li key={`${h.document_id}-${i}`} className="rounded-xl border border-line bg-black/20 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <button type="button" className="font-semibold text-white hover:text-brand-cyan" onClick={() => setOpenId(h.document_id)}>
                      {h.title}
                    </button>
                    <span className="font-mono text-[10px] text-slate-500">score {h.score.toFixed(3)}</span>
                  </div>
                  <p className="mt-1 line-clamp-3 text-slate-300">{h.chunk}</p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Documents"
            subtitle={docs ? `${docs.length} total` : "loading…"}
            action={
              tags.length > 0 ? (
                <select aria-label="Filter by tag" className="h-8 rounded-lg border border-line bg-navy px-2 text-xs text-slate-200" value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="">All tags</option>
                  {tags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              ) : null
            }
          />
          <div className="px-3 pb-3">
            {docs === null ? <Skeleton className="h-32" /> : shown.length === 0 ? <EmptyState title="No documents" hint="Six runbooks are seeded in DEMO mode; add your own with the form." /> : null}
            <ul className="space-y-2">
              {shown.map((d) => (
                <li key={d.id} className="rounded-xl border border-line bg-black/20 p-3 text-xs" data-testid="knowledge-doc">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="text-sm font-semibold text-white hover:text-brand-cyan" onClick={() => setOpenId(openId === d.id ? null : d.id)} aria-expanded={openId === d.id}>
                      {d.title}
                    </button>
                    <DemoChip show={Boolean(d.demo)} />
                    <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{d.scope}</span>
                    {d.tags.map((t) => (
                      <span key={t} className="rounded bg-brand-purple/15 px-1.5 py-0.5 text-[10px] text-violet-200">
                        {t}
                      </span>
                    ))}
                    <span className="ml-auto text-[11px] text-slate-500">
                      {d.source} · {relTime(d.created_at, now)}
                      {d.created_by ? ` · ${d.created_by}` : ""}
                    </span>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${d.title}`} onClick={() => remove(d)} disabled={!writable} title={!writable ? "Read-only role" : "Delete"} icon={<IconTrash width={14} height={14} />} />
                  </div>
                  {openId === d.id ? <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-3 font-mono text-[11px] text-slate-200">{d.content ?? "Loading content…"}</pre> : null}
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-white">Add a document</h2>
          <p className="mb-3 text-xs text-slate-400">Paste text or upload .md / .txt / .pdf (≤ 5 MB). Scope controls which roles and tasks can retrieve it.</p>
          <form onSubmit={submit} className="space-y-3" data-testid="knowledge-form">
            <div>
              <label htmlFor="kb-title" className={label}>
                Title
              </label>
              <input id="kb-title" className={field} required={!file} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="ECS rollback runbook" />
            </div>
            <div>
              <label htmlFor="kb-content" className={label}>
                Content
              </label>
              <textarea id="kb-content" rows={6} className="w-full rounded-xl border border-line bg-navy px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-brand-cyan/60 focus:outline-none" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder={file ? "(text will be extracted from the file)" : "Markdown or plain text…"} disabled={Boolean(file)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="kb-tags" className={label}>
                  Tags
                </label>
                <input id="kb-tags" className={field} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="runbook, ecs" />
              </div>
              <div>
                <label htmlFor="kb-scope" className={label}>
                  Scope
                </label>
                <select id="kb-scope" className={field} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                  {scopes.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="kb-file" className={label}>
                Or upload a file
              </label>
              <input id="kb-file" type="file" accept=".md,.txt,.pdf,text/markdown,text/plain,application/pdf" className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-white" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              {file ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB {file.size > 5 * 1024 * 1024 ? "· too large" : ""}
                </p>
              ) : null}
            </div>
            <Button type="submit" variant="primary" loading={busy} disabled={!writable || (!file && (!form.title.trim() || !form.content.trim())) || (file ? file.size > 5 * 1024 * 1024 : false)} title={!writable ? "Read-only role" : undefined} icon={<IconUpload width={14} height={14} />} aria-label="Add document" data-testid="knowledge-submit">
              Add document
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
