import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Product Importer",
  description: "Paste Shopify product URLs and import them into your store.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
