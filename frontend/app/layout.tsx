import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Code2K8s", description: "Deploy any repo to Kubernetes" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <a href="/" className="brand">code2k8s</a>
          <nav>
            <a href="/templates">Templates</a>
            <a href="/deploy">Paste a repo</a>
            <a href="/deployments">Dashboard</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
