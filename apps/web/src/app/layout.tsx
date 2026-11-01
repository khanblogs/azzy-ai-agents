import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { CREATOR_CREDIT, PRODUCT_NAME, PRODUCT_VERSION } from "@azzy/events";
import { Toasts } from "@/components/Toasts";
import "./globals.css";

const title = `${PRODUCT_NAME} ${PRODUCT_VERSION}`;

export const metadata: Metadata = {
  title: { default: title, template: `%s · ${PRODUCT_NAME}` },
  description: `${title} — a self-hosted office of five AI agents (DevOps, Developer, Security, Operations, Marketing) that work through safe tools and ask for approval before anything risky. ${CREATOR_CREDIT}.`,
  applicationName: PRODUCT_NAME,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: PRODUCT_NAME },
  openGraph: { title, siteName: PRODUCT_NAME, images: [{ url: "/brand/og.png" }], type: "website" },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#050816",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans">
        {children}
        <Toasts />
      </body>
    </html>
  );
}
