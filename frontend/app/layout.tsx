import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const siteUrl = "https://resumer.aryansingh.space";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Resumer | ATS Resume Builder",
    template: "%s | Resumer",
  },
  description:
    "Build ATS-friendly, job-focused resumes from messy job descriptions and export polished PDF drafts faster.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    title: "Resumer | ATS Resume Builder",
    description:
      "Build ATS-friendly, job-focused resumes from job descriptions and export polished PDF drafts faster.",
    url: siteUrl,
    siteName: "Resumer",
    images: [
      {
        url: "/resumer-icon-512.png",
        width: 512,
        height: 512,
        alt: "Resumer Logo",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Resumer | ATS Resume Builder",
    description:
      "Build ATS-friendly, job-focused resumes from job descriptions and export polished PDF drafts faster.",
    images: ["/resumer-icon-512.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} h-full antialiased font-sans`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
