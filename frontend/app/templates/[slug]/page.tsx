import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { templates, templateBySlug } from "@/lib/catalog";

interface Params { slug: string }

export async function generateStaticParams() {
  return templates.map((t) => ({ slug: t.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const t = templateBySlug(slug);
  if (!t) return { title: "Template not found" };
  return {
    title: `${t.title} — one-click Kubernetes deploy | Code2K8s`,
    description: t.blurb,
    openGraph: { title: `Deploy ${t.title} to Kubernetes in one click`, description: t.blurb },
  };
}

export default async function TemplatePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const t = templateBySlug(slug);
  if (!t) notFound();

  const deployHref = `/deploy?repoUrl=${encodeURIComponent(t.repoUrl)}&branch=${t.branch}&port=${t.port}&slug=${t.slug}`;

  return (
    <>
      <p><Link href="/templates" style={{ color: "var(--muted)" }}>← back to templates</Link></p>
      <h1>{t.title}</h1>
      <p className="lede">{t.blurb}</p>
      <div className="chips" style={{ marginBottom: "1.5rem" }}>
        {t.tags.map((tag) => <span key={tag} className="chip">{tag}</span>)}
        {!t.standalone && <span className="badge">needs external database</span>}
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="kv"><span>Source</span><a href={t.repoUrl} target="_blank" rel="noreferrer">{t.repoUrl.replace("https://github.com/", "")}</a></div>
        <div className="kv"><span>Branch</span><code>{t.branch}</code></div>
        <div className="kv"><span>Container port</span><code>{t.port}</code></div>
        <div className="kv"><span>Category</span>{t.category}</div>
      </div>

      <Link className="btn primary big" href={deployHref}>Deploy {t.title} →</Link>

      <section style={{ marginTop: "3rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>What happens when you click Deploy</h2>
        <ol className="steps small">
          <li>We fork a record in our database and queue a build job.</li>
          <li>Kaniko clones the repo inside the cluster and builds the image.</li>
          <li>We render a Deployment + Service + Ingress + HPA, apply them, and wait for the rollout.</li>
          <li>Your URL is printed the second the first pod is Ready.</li>
        </ol>
      </section>
    </>
  );
}
