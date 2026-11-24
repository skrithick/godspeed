import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/fraunces/standard-italic.css";
import { preferenceKeys } from "@/workspace/identity";
import "./globals.css";

export const metadata: Metadata = {
  title: "Godspeed — Your thinking space",
  description: "A local-first workspace for ideas, plans, and the work that connects them.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: `try{var [current,previous]=${JSON.stringify(preferenceKeys.theme)};var theme=localStorage.getItem(current)??localStorage.getItem(previous);document.documentElement.dataset.theme=(theme==='dark'||theme==='light')?theme:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch{}` }} /></head>
    <body>{children}</body>
  </html>;
}
