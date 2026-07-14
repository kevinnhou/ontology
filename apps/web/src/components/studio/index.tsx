"use client";

import { Suspense } from "react";

import AuthOverlay from "@/components/auth/auth-overlay";

import DropFrame from "./drop-frame";
import StudioShell from "./studio-shell";

export default function Studio() {
	return (
		<AuthOverlay>
			<StudioShell>
				<Suspense
					fallback={
						<div className="flex w-full items-center justify-center py-12">
							<p className="text-[10px] text-muted-foreground uppercase tracking-widest">
								Loading
							</p>
						</div>
					}
				>
					<DropFrame />
				</Suspense>
			</StudioShell>
		</AuthOverlay>
	);
}
