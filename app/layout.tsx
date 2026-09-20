import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stillword — A little space for the Word",
  description:
    "Read slowly. Reflect honestly. A welcoming place for Scripture, personal reflection, and thoughtful community.",
  robots: { index: false, follow: false },
};

const themeScript = `(function(){try{var t=localStorage.getItem('stillword-theme')||'system';document.documentElement.dataset.theme=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
