import type { ReactNode } from "react";

export const metadata = { title: "Next.js + Postgres + Redis demo" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", margin: 0, padding: "2rem", background: "#0b0d10", color: "#e6e6e6" }}>
        {children}
      </body>
    </html>
  );
}
