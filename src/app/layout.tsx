import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JARVIS — Home Core",
  description: "Assistente local para Rock Pi. Dev em Next.js, voz PT-BR, hardware mock.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full bg-black font-sans antialiased">{children}</body>
    </html>
  );
}
