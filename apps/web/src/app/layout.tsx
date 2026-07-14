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
		<html className="dark" dir="ltr" lang="en" suppressHydrationWarning>
			<body
				className={`${geistSans.variable} ${geistMono.variable} select-none bg-[linear-gradient(#141414_1px,transparent_1px),linear-gradient(90deg,#141414_1px,transparent_1px)] bg-background bg-size-[8px_8px] antialiased`}
			>
				<Providers initialToken={token}>
					<div className="h-svh font-mono">{children}</div>
				</Providers>
			</body>
		</html>
	);
}
