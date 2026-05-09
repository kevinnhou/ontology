import { RootProvider } from "fumadocs-ui/provider/next";
import type { Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "./globals.css";

export const viewport: Viewport = {
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "white" },
		{ media: "(prefers-color-scheme: dark)", color: "black" },
	],
};

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export default function Layout({ children }: LayoutProps<"/">) {
	return (
		<html
			className={`${geistSans.variable} ${geistMono.variable} antialiased`}
			lang="en"
			suppressHydrationWarning
		>
			<body className="flex min-h-svh flex-col">
				<RootProvider>{children}</RootProvider>
			</body>
		</html>
	);
}
