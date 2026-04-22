import Link from "next/link";
import { templates } from "@/lib/catalog";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Code2K8s — Deploy any GitHub repo to Kubernetes in one click",
  description:
    "A real Kubernetes platform in a single afternoon. Paste a repo, get a live URL. No YAML, no Helm, no lock-in — just production-grade primitives you actually understand.",
  openGraph: {
    title: "Code2K8s — your own Vercel, on your own Kubernetes",
    description:
      "25+ curated open-source templates. Click once, get a live URL. Real rolling deploys, real autoscaling, real ingress.",
    type: "website",
  },
};

export default function Landing() {
  const featured = templates.filter((t) => t.standalone).slice(0, 8);

  return (
    <>
      <section className="hero">
        <p className="eyebrow">your own Vercel — on your own Kubernetes</p>
        <h1>Deploy any GitHub repo to Kubernetes in <em>one click.</em></h1>
        <p className="lede">
          No YAML. No Helm charts. No cloud lock-in. Paste a URL, get a live public link —
          powered by the same Kubernetes primitives you'd write yourself, just without the keystrokes.
        </p>
        <div className="cta-row">
          <Link className="btn primary" href="/templates">Browse 25+ templates →</Link>
          <Link className="btn ghost" href="/deploy">Or paste your own repo</Link>
        </div>
        <p className="trust">
          Built on standard APIs — <strong>Deployment</strong> · <strong>Service</strong> ·
          <strong> Ingress</strong> · <strong>HPA</strong>. Runs unchanged on k3s, EKS, GKE, AKS.
        </p>
      </section>

      <section className="how">
        <h2>How it works</h2>
        <ol className="steps">
          <li>
            <span className="num">1</span>
            <h3>Pick a template or paste a repo</h3>
            <p>25+ curated open-source apps ready to go. Or bring any repo with a Dockerfile at root.</p>
          </li>
          <li>
            <span className="num">2</span>
            <h3>We build and deploy in-cluster</h3>
            <p>Kaniko builds your image inside Kubernetes — no Docker-in-Docker, no external CI. Manifests are rendered, applied, and rolled out.</p>
          </li>
          <li>
            <span className="num">3</span>
            <h3>You get a live URL and live logs</h3>
            <p>Server-sent-events stream build and runtime logs straight to your browser. Rolling updates, health probes, and autoscaling are set up for you.</p>
          </li>
        </ol>
      </section>

      <section className="featured">
        <div className="featured-head">
          <h2>Start with something that already works</h2>
          <Link href="/templates" className="more">See all →</Link>
        </div>
        <div className="grid">
          {featured.map((t) => (
            <Link key={t.slug} href={`/templates/${t.slug}`} className="card tile">
              <div className="tile-title">{t.title}</div>
              <p className="tile-blurb">{t.blurb}</p>
              <div className="chips">
                {t.tags.slice(0, 3).map((tag) => <span key={tag} className="chip">{tag}</span>)}
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="why">
        <h2>Why Code2K8s</h2>
        <div className="why-grid">
          <div>
            <h3>Learn Kubernetes, don't hide from it.</h3>
            <p>We generate manifests you could commit to git tomorrow and maintain by hand. The platform is transparent on purpose.</p>
          </div>
          <div>
            <h3>Production-shaped from day one.</h3>
            <p>Rolling updates with <code>maxUnavailable=0</code>. Readiness + liveness probes. HPA on CPU. Resource requests + limits. TLS via cert-manager.</p>
          </div>
          <div>
            <h3>Portable by design.</h3>
            <p>Only standard Kubernetes APIs. One ConfigMap is the single seam between clouds — flip it and the same code runs on k3s, EKS, GKE, or AKS.</p>
          </div>
          <div>
            <h3>Built for people just starting out.</h3>
            <p>If you've never written a Kubernetes Deployment, this is the fastest way to ship one and learn what good looks like. If you've written hundreds, it's the fastest way to stop.</p>
          </div>
        </div>
      </section>

      <section className="final-cta">
        <h2>Your first Kubernetes deploy is one click away.</h2>
        <Link className="btn primary big" href="/templates">Browse templates</Link>
      </section>
    </>
  );
}
