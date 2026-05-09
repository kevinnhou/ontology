import type { Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "../globals.css";

import Providers from "@/components/providers";
import { getToken } from "@/lib/auth-server";

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

export default async function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	const token = await getToken();
	return (
		<html dir="ltr" lang="en" suppressHydrationWarning>
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased`}
			>
				<Providers initialToken={token}>
					<div className="h-svh">{children}</div>
				</Providers>
			</body>
		</html>
	);
}
