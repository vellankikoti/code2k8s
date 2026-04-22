import Link from "next/link";
import { categories, templates } from "@/lib/catalog";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Templates — one-click Kubernetes deploys | Code2K8s",
  description:
    "25+ curated open-source apps that deploy to Kubernetes in one click. Every template is validated — if it's here, the Dockerfile builds and the app boots.",
};

export default function TemplatesPage() {
  return (
    <>
      <section className="hero small">
        <p className="eyebrow">the catalog</p>
        <h1>Pick an app. Click <em>Deploy.</em> Watch it go live.</h1>
        <p className="lede">
          Every template below has a validated <code>Dockerfile</code> at the repo root and a documented container port.
          We tested them so you don't have to.
        </p>
      </section>

      {categories.map((cat) => {
        const items = templates.filter((t) => t.category === cat.key);
        if (items.length === 0) return null;
        return (
          <section key={cat.key} className="cat-section">
            <div className="cat-head">
              <h2>{cat.label}</h2>
              <p>{cat.copy}</p>
            </div>
            <div className="grid">
              {items.map((t) => (
                <Link key={t.slug} href={`/templates/${t.slug}`} className="card tile">
                  <div className="tile-title">
                    {t.title}
                    {!t.standalone && <span className="badge">needs DB</span>}
                  </div>
                  <p className="tile-blurb">{t.blurb}</p>
                  <div className="chips">
                    {t.tags.slice(0, 3).map((tag) => <span key={tag} className="chip">{tag}</span>)}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
