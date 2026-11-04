import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "To-do",
  description: "Pipedrive activities, Slack List items and your own tasks in one list.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "To-do", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
    { media: "(prefers-color-scheme: dark)", color: "#141413" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
