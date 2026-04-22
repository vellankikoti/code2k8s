import catalog from "./catalog.json";

export interface Template {
  slug: string;
  title: string;
  blurb: string;
  category: "starter" | "debug" | "dev-tools" | "utility" | "productivity" | "dashboard" | "selfhost" | "db-required";
  standalone: boolean;
  tags: string[];
  repoUrl: string;
  branch: string;
  port: number;
}

export const templates: Template[] = catalog as Template[];

export const categories: { key: Template["category"]; label: string; copy: string }[] = [
  { key: "starter",      label: "Starters",         copy: "Proven first deploys. Boot in seconds, zero config." },
  { key: "debug",        label: "Debug & echo",     copy: "Tiny tools for proving ingress, TLS, and headers behave." },
  { key: "dev-tools",    label: "Dev tools",        copy: "Log viewers, mail catchers, browser IDEs — a builder's toolkit." },
  { key: "utility",      label: "Utilities",        copy: "Daily-driver self-hosted helpers." },
  { key: "productivity", label: "Productivity",     copy: "Whiteboards, editors, everyday apps." },
  { key: "dashboard",    label: "Dashboards",       copy: "Overview pages for your homelab or team." },
  { key: "selfhost",     label: "Self-host",        copy: "Replace a SaaS with something you own." },
  { key: "db-required",  label: "Needs a database", copy: "Works once you attach Postgres or MySQL — coming soon as a one-click add-on." },
];

export function templateBySlug(slug: string) {
  return templates.find((t) => t.slug === slug);
}
