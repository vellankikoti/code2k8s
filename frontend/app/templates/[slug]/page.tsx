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

  const qs = new URLSearchParams({
    repoUrl: t.repoUrl,
    branch: t.branch,
    port: String(t.port),
    slug: t.slug,
  });
  if (t.bootstrap) {
    qs.set("bootstrap", encodeURIComponent(JSON.stringify(t.bootstrap)));
  }
  const deployHref = `/deploy?${qs.toString()}`;

  return (
    <>
      <p><Link href="/templates" style={{ color: "var(--muted)" }}>← back to templates</Link></p>
      <h1>{t.title}</h1>
      <p className="lede">{t.blurb}</p>
      <div className="chips" style={{ marginBottom: "1.5rem" }}>
        {t.tags.map((tag) => <span key={tag} className="chip">{tag}</span>)}
        {t.bootstrap?.postgres && <span className="chip" style={{ borderColor: "#2a5c3b", color: "#7cf0a0" }}>includes Postgres</span>}
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div className="kv"><span>Source</span><a href={t.repoUrl} target="_blank" rel="noreferrer">{t.repoUrl.replace("https://github.com/", "")}</a></div>
        <div className="kv"><span>Branch</span><code>{t.branch}</code></div>
        <div className="kv"><span>Container port</span><code>{t.port}</code></div>
        <div className="kv"><span>Category</span>{t.category}</div>
        {t.bootstrap?.postgres && <div className="kv"><span>Bootstrap</span>Postgres 16 + {t.bootstrap.extraEnv?.length ?? 0} pre-wired env vars</div>}
      </div>

      <Link className="btn primary big" href={deployHref}>Deploy {t.title} →</Link>

      <section style={{ marginTop: "3rem" }}>
        <h2 style={{ fontSize: "1.1rem" }}>What happens when you click Deploy</h2>
        <ol className="steps small">
          <li>We queue a Kaniko build inside the cluster.</li>
          {t.bootstrap?.postgres && <li>We provision a Postgres StatefulSet in the app&apos;s namespace and wait for it to be ready.</li>}
          <li>We render a Deployment + Service + Ingress + HPA{t.bootstrap?.postgres ? ", wired to the provisioned database," : ""} and apply them.</li>
          <li>The URL is printed the second the first pod is Ready.</li>
        </ol>
      </section>

      {t.bootstrap?.extraEnv && t.bootstrap.extraEnv.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2 style={{ fontSize: "1.1rem" }}>Auto-injected env vars</h2>
          <table>
            <thead><tr><th>Name</th><th>Source</th></tr></thead>
            <tbody>
              {t.bootstrap.extraEnv.map((e) => (
                <tr key={e.name}>
                  <td><code>{e.name}</code></td>
                  <td style={{ color: "var(--muted)" }}>
                    {"value" in e ? <>literal: <code>{e.value.length > 40 ? e.value.slice(0, 40) + "…" : e.value}</code></> :
                      <>from DB secret key <code>{e.key}</code></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
